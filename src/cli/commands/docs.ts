import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { table, err, dim, jsonOutForArgs } from "../format.ts";
import {
  getAndRender,
  renderBacklinksMarkdown,
  attachBacklinksJson,
} from "../render.ts";
import { listLocalDocsSafe, searchLocalDocsSafe } from "../local-safe.ts";
import { shouldFallbackToApi, shouldTryLocal, sourceFromArgs } from "../source.ts";
import { $ } from "bun";

export async function runDocs(argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      location: { type: "string" },
      folder: { type: "string" },
      "fetch-blocks": { type: "boolean" },
      metadata: { type: "boolean" },
      depth: { type: "number" },
      raw: { type: "boolean" },
      "no-links": { type: "boolean" },
      exhaustive: { type: "boolean" },
      include: { type: "boolean" }, // use `include` mode instead of default `regexps`
      ids: { type: "string" },
      "modified-since": { type: "string" },
      "created-since": { type: "string" },
      to: { type: "string" },
      title: { type: "string" },
    },
  });
  const source = sourceFromArgs(args);

  // lazy client - only built when API path is needed
  let _client: Awaited<ReturnType<typeof buildClient>>["client"] | undefined;
  async function getClient() {
    if (!_client) _client = (await buildClient(args)).client;
    return _client;
  }

  switch (sub) {
    case "ls":
    case "list": {
      // try local for simple ls (no filters that require API)
      const localEligible = shouldTryLocal(source) && !args.flags.location && !args.flags.folder
        && !args.flags["modified-since"] && !args.flags["created-since"]
        && !args.flags.metadata;

      if (localEligible) {
        // enrich with PTS data only for --json (needs isDailyNote, tags)
        const local = await listLocalDocsSafe({ enrich: !!args.flags.json });
        if (local.status === "available") {
          const docs = local.docs;
          if (args.flags.json) {
            console.log(jsonOutForArgs({ items: docs.map((d) => ({ id: d.id, title: d.title, isDailyNote: d.isDailyNote, tags: d.tags })) }, args.flags));
            return;
          }
          console.log(
            table(
              docs.map((d) => ({
                id: d.id,
                title: d.title,
              }))
            )
          );
          console.error(dim(`\n${docs.length} documents (local)`));
          return;
        } else if (!shouldFallbackToApi(source)) {
          throw new Error(`local Craft store unavailable (${local.status}); use --source auto or --source api`);
        }
      } else if (!shouldFallbackToApi(source)) {
        throw new Error("this docs ls query is not supported by --source local; use --source auto or --source api");
      }

      const client = await getClient();
      const res = await client.documents.list({
        location: args.flags.location,
        folderId: args.flags.folder,
        fetchMetadata: args.flags.metadata !== false, // default on for LLM context
        lastModifiedDateGte: args.flags["modified-since"],
        createdDateGte: args.flags["created-since"],
      });
      if (args.flags.json) {
        console.log(jsonOutForArgs(res, args.flags));
        return;
      }
      console.log(
        table(
          res.items.map((d) => ({
            id: d.id,
            title: d.title,
            modified: d.lastModifiedAt?.slice(0, 10) ?? "",
          }))
        )
      );
      console.error(dim(`\n${res.items.length} documents`));
      return;
    }

    case "search": {
      const pattern = args.positional[0];
      if (!pattern) throw new Error("usage: craft docs search <pattern>");

      // try local FTS5 search for simple queries
      const localEligible = shouldTryLocal(source) && !args.flags["fetch-blocks"] && !args.flags.folder
        && !args.flags.location && !args.flags.ids && !args.flags.include;

      if (localEligible) {
        const local = await searchLocalDocsSafe(pattern, { entityType: "document" });
        if (local.status === "available") {
          const results = local.results;
          if (args.flags.json) {
            console.log(jsonOutForArgs({
              items: results.map((r) => ({
                documentId: r.id,
                markdown: r.content,
                blockIds: [r.id],
              })),
            }, args.flags));
            return;
          }
          for (const hit of results) {
            console.log(`${dim(hit.id)}  ${truncate(hit.content, 140)}`);
          }
          console.error(dim(`\n${results.length} matches (local)`));
          return;
        } else if (!shouldFallbackToApi(source)) {
          throw new Error(`local Craft store unavailable (${local.status}); use --source auto or --source api`);
        }
      } else if (!shouldFallbackToApi(source)) {
        throw new Error("this docs search query is not supported by --source local; use --source auto or --source api");
      }

      const client = await getClient();
      const res = await client.documents.search({
        // CAVEATS: regexps is preferred — include tokenizes on underscores and misses.
        ...(args.flags.include ? { include: pattern } : { regexps: pattern }),
        folderIds: args.flags.folder,
        location: args.flags.location,
        fetchBlocks: args.flags["fetch-blocks"],
        documentIds: args.flags.ids ? (args.flags.ids as string).split(",") : undefined,
      });
      if (args.flags.json) {
        console.log(jsonOutForArgs(res, args.flags));
        return;
      }
      for (const hit of res.items) {
        console.log(`${dim(hit.documentId)}  ${truncate(hit.markdown, 140)}`);
      }
      console.error(dim(`\n${res.items.length} matches`));
      return;
    }

    case "get": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft docs get <id>");
      const client = await getClient();
      const { payload, backlinks } = await getAndRender(client, {
        id,
        depth: args.flags.depth ?? -1,
        metadata: args.flags.metadata,
        format: args.flags.json ? "json" : "markdown",
        raw: args.flags.raw,
        withLinks: !args.flags["no-links"],
        exhaustive: args.flags.exhaustive,
      });
      if (args.flags.json) {
        console.log(jsonOutForArgs(attachBacklinksJson(payload as any, backlinks), args.flags));
      } else {
        process.stdout.write(payload as string);
        if (backlinks !== null) process.stdout.write(renderBacklinksMarkdown(backlinks));
        else process.stdout.write("\n");
      }
      return;
    }

    case "daily": {
      const date = args.positional[0] ?? "today";
      const client = await getClient();
      const { payload, backlinks } = await getAndRender(client, {
        date,
        depth: args.flags.depth ?? -1,
        format: args.flags.json ? "json" : "markdown",
        raw: args.flags.raw,
        withLinks: !args.flags["no-links"],
        exhaustive: args.flags.exhaustive,
      });
      if (args.flags.json) {
        console.log(jsonOutForArgs(attachBacklinksJson(payload as any, backlinks), args.flags));
      } else {
        process.stdout.write(payload as string);
        if (backlinks !== null) process.stdout.write(renderBacklinksMarkdown(backlinks));
        else process.stdout.write("\n");
      }
      return;
    }

    case "mk":
    case "create": {
      const titles = args.positional;
      if (titles.length === 0) throw new Error("usage: craft docs mk <title>... [--folder ID | --location L]");
      const destination = args.flags.folder
        ? { folderId: args.flags.folder }
        : args.flags.location
          ? { destination: args.flags.location as "unsorted" | "templates" }
          : undefined;
      if (args.flags["dry-run"]) {
        const preview = { op: "documents.create", items: titles.map((title) => ({ title })), destination };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would create ${titles.length} documents`);
        return;
      }
      const client = await getClient();
      const res = await client.documents.create(
        titles.map((title) => ({ title })),
        destination as any
      );
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : table(res.items as any));
      return;
    }

    case "mv":
    case "move": {
      if (args.positional.length === 0) throw new Error("usage: craft docs mv <id>... --to ID|unsorted|templates");
      const to = args.flags.to as string | undefined;
      if (!to) throw new Error("--to required");
      const destination =
        to === "unsorted" || to === "templates"
          ? { destination: to as "unsorted" | "templates" }
          : { folderId: to };
      if (args.flags["dry-run"]) {
        const preview = { op: "documents.move", ids: args.positional, destination };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would move ${args.positional.length} documents`);
        return;
      }
      const client = await getClient();
      const res = await client.documents.move(args.positional, destination);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : "moved");
      return;
    }

    case "rm":
    case "delete": {
      if (args.positional.length === 0) throw new Error("usage: craft docs rm <id>...");
      if (args.flags["dry-run"]) {
        const preview = { op: "documents.delete", ids: args.positional };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would delete ${args.positional.length} documents`);
        return;
      }
      const client = await getClient();
      const res = await client.documents.delete(args.positional);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `deleted ${res.items.length}`);
      return;
    }

    case "open": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft docs open <id>");
      const client = await getClient();
      const link = await client.deeplink(id);
      console.log(link);
      if (!args.flags.json) {
        try {
          await $`open ${link}`.quiet();
        } catch {}
      }
      return;
    }

    default:
      console.error(err(`unknown: docs ${sub}`));
      process.exit(1);
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
