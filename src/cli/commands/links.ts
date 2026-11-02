import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { table, err, dim, jsonOutForArgs } from "../format.ts";
import { resolveProfile } from "../config.ts";
import { sourceFromArgs } from "../source.ts";
import { LinkScopeError, isInternalLinksUnavailable, type LinkScopeOptions } from "../../lib/links.ts";
import type { InternalLinksQuery } from "../../lib/types.ts";
import { linkRows, localRootResolver, type AnyLink } from "../links-native.ts";

const USAGE = `usage:
  craft links in  <id> [--level document|block] [--doc ROOT] [--scan] [--include-self]
  craft links out <id> [--level document|block] [--doc ROOT] [--scan] [--include-self]
  craft links map [--from ID] [--to ID] [--from-date D] [--to-date D] [--level document|block]
                  [--include-self] [--limit N] [--cursor C] [--all]
legacy (title search / tree parse):
  craft links in  <id> --legacy [--text STR] [--exhaustive [--folder ID] [--concurrency N]]
  craft links out <id> --legacy`;

export async function runLinks(argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      level: { type: "string" },
      doc: { type: "string" },
      scan: { type: "boolean" },
      "include-self": { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      "from-date": { type: "string" },
      "to-date": { type: "string" },
      limit: { type: "number" },
      cursor: { type: "string" },
      all: { type: "boolean" },
      // legacy
      legacy: { type: "boolean" },
      text: { type: "string" },
      exhaustive: { type: "boolean" },
      folder: { type: "string" },
      concurrency: { type: "number" },
    },
  });

  const level = args.flags.level as string | undefined;
  if (level !== undefined && level !== "document" && level !== "block") {
    throw new Error("--level must be document or block");
  }

  if (sub === "map") return runMap(args, level as InternalLinksQuery["level"]);

  const direction =
    sub === "out" || sub === "outgoing" ? "out"
    : sub === "in" || sub === "backlinks" || sub === "incoming" ? "in"
    : null;
  if (!direction) {
    console.error(err(`unknown: links ${sub ?? ""}`));
    console.error(USAGE);
    process.exit(1);
  }

  const id = args.positional[0];
  if (!id) throw new Error(USAGE);
  const { client } = await buildClient(args);

  // --text and --exhaustive only exist on the legacy path
  const legacy = !!(args.flags.legacy || args.flags.text || args.flags.exhaustive);
  let links: AnyLink[];
  let note = "";

  if (legacy) {
    links = await runLegacy(client, direction, id, args.flags);
    note = args.flags.exhaustive ? " (legacy exhaustive scan)" : " (legacy)";
  } else {
    const explicitProfile = typeof args.flags.profile === "string" ? args.flags.profile : undefined;
    const spaceId = (await resolveProfile(explicitProfile)).spaceId;
    const scope: LinkScopeOptions = {
      documentId: args.flags.doc as string | undefined,
      resolveDocumentId: localRootResolver(spaceId, sourceFromArgs(args)),
      scan: !!args.flags.scan,
      level: level as LinkScopeOptions["level"],
      includeSelfLinks: !!args.flags["include-self"],
    };
    try {
      const r = direction === "in"
        ? await client.links.backlinks(id, scope)
        : await client.links.outgoing(id, scope);
      links = r.items;
      if (!r.isDocument) note = r.documentId ? ` (inside document ${r.documentId})` : " (whole-space scan)";
    } catch (e) {
      if (e instanceof LinkScopeError) {
        console.error(err(e.message));
        process.exit(4);
      }
      if (!isInternalLinksUnavailable(e)) throw e;
      console.error(dim("internal-links endpoint unavailable; using legacy path (may be incomplete)"));
      links = await runLegacy(client, direction, id, args.flags);
      note = " (legacy)";
    }
  }

  if (args.flags.json) {
    console.log(jsonOutForArgs(links, args.flags));
    return;
  }
  const label = direction === "in" ? "backlinks" : "outgoing links";
  if (links.length === 0) {
    console.error(dim(`no ${label}${note}`));
    return;
  }
  console.log(table(linkRows(links, direction)));
  console.error(dim(`\n${links.length} ${label}${note}`));
}

async function runLegacy(
  client: Awaited<ReturnType<typeof buildClient>>["client"],
  direction: "in" | "out",
  id: string,
  flags: Record<string, unknown>,
): Promise<AnyLink[]> {
  if (direction === "out") return client.links.outgoingParsed(id);
  if (flags.exhaustive) {
    return client.links.backlinksExhaustive(id, {
      folderId: flags.folder as string | undefined,
      concurrency: flags.concurrency as number | undefined,
    });
  }
  return client.links.backlinksLegacy(id, {
    linkText: flags.text as string | undefined,
    includeSelf: !!flags["include-self"],
  });
}

async function runMap(
  args: ReturnType<typeof parseWithGlobals>,
  level: InternalLinksQuery["level"],
) {
  const { client } = await buildClient(args);
  const q: InternalLinksQuery = {
    level,
    fromDocumentId: args.flags.from as string | undefined,
    toDocumentId: args.flags.to as string | undefined,
    fromDate: args.flags["from-date"] as string | undefined,
    toDate: args.flags["to-date"] as string | undefined,
    includeSelfLinks: args.flags["include-self"] ? true : undefined,
    limit: args.flags.limit as number | undefined,
    cursor: args.flags.cursor as string | undefined,
  };

  if (args.flags.all) {
    const items = await client.links.all(q);
    if (args.flags.json) {
      console.log(jsonOutForArgs(items, args.flags));
      return;
    }
    if (items.length === 0) return void console.error(dim("no links"));
    console.log(table(items as unknown as Record<string, unknown>[]));
    console.error(dim(`\n${items.length} links`));
    return;
  }

  const page = await client.links.page(q);
  if (args.flags.json) {
    console.log(jsonOutForArgs(page, args.flags));
    return;
  }
  if (page.items.length === 0) return void console.error(dim("no links"));
  console.log(table(page.items as unknown as Record<string, unknown>[]));
  console.error(dim(`\n${page.items.length} links`));
  if (page.pagination?.cursor) {
    console.error(dim(`next page: --cursor ${page.pagination.cursor}  (or --all)`));
  }
}
