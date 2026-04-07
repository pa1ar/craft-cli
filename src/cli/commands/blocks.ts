import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { parseArgs, readStdin } from "../args.ts";
import { err, dim } from "../format.ts";
import { getAndRender, renderBacklinksMarkdown, attachBacklinksJson } from "../render.ts";
import { getJournal } from "../journal-singleton.ts";
import type { Position } from "../../lib/types.ts";

export async function runBlocks(argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      depth: { type: "number" },
      metadata: { type: "boolean" },
      raw: { type: "boolean" },
      "no-links": { type: "boolean" },
      exhaustive: { type: "boolean" },
      markdown: { type: "string" },
      file: { type: "string" },
      font: { type: "string" },
      date: { type: "string" },
      parent: { type: "string" },
      position: { type: "string" }, // start|end
      sibling: { type: "string" },
      before: { type: "number" },
      after: { type: "number" },
      case: { type: "boolean" },
      fetch: { type: "boolean" },
      to: { type: "string" },
    },
  });

  const { client } = await buildClient(args);

  switch (sub) {
    case "get": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft blocks get <id>");
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
        console.log(JSON.stringify(attachBacklinksJson(payload as any, backlinks), null, 2));
      } else {
        process.stdout.write(payload as string);
        if (backlinks !== null) process.stdout.write(renderBacklinksMarkdown(backlinks));
        else process.stdout.write("\n");
      }
      return;
    }

    case "search": {
      const [docId, pattern] = args.positional;
      if (!docId || !pattern) throw new Error("usage: craft blocks search <docId> <pattern>");
      const res = await client.blocks.search({
        blockId: docId,
        pattern,
        caseSensitive: args.flags.case,
        beforeBlockCount: args.flags.before,
        afterBlockCount: args.flags.after,
        fetchBlocks: args.flags.fetch,
      });
      if (args.flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      for (const hit of res.items) {
        const path = hit.pageBlockPath?.map((p) => p.content).join(" > ") ?? "";
        console.log(`${dim(path)}`);
        for (const b of hit.beforeBlocks ?? []) console.log(`  ${dim(b.markdown)}`);
        console.log(`  ${hit.markdown}`);
        for (const b of hit.afterBlocks ?? []) console.log(`  ${dim(b.markdown)}`);
        console.log();
      }
      console.error(dim(`${res.items.length} matches`));
      return;
    }

    case "append": {
      const target = args.positional[0];
      const position = buildTarget(target, args.flags);
      const md = await readMarkdown(args.flags);
      if (!md) throw new Error("usage: craft blocks append <docId>|--date DATE --markdown STR|--file F|-");
      const res = await client.blocks.append(md, position as any);
      try {
        const journal = getJournal();
        const docId = (position as any).pageId ?? `daily:${(position as any).date}`;
        journal.record({
          op: "append",
          docId,
          blockIds: res.items.map((b: any) => b.id),
          post: res.items,
        });
      } catch (e) {
        console.error(dim(`journal warning: ${(e as Error).message}`));
      }
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `inserted ${res.items.length} blocks`);
      return;
    }

    case "insert": {
      const target = args.positional[0];
      const position = buildTarget(target, args.flags);
      if (!args.flags.file && !args.positional.includes("-")) {
        throw new Error("usage: craft blocks insert <parentId>|--date DATE --file blocks.json (or pipe to stdin with -)");
      }
      const text = args.flags.file
        ? await Bun.file(args.flags.file as string).text()
        : await readStdin();
      const blocks = JSON.parse(text);
      const res = await client.blocks.insert(
        Array.isArray(blocks) ? blocks : blocks.blocks,
        position as any
      );
      try {
        const journal = getJournal();
        const docId = (position as any).pageId ?? `daily:${(position as any).date}`;
        journal.record({
          op: "insert",
          docId,
          blockIds: res.items.map((b: any) => b.id),
          post: res.items,
        });
      } catch (e) {
        console.error(dim(`journal warning: ${(e as Error).message}`));
      }
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `inserted ${res.items.length} blocks`);
      return;
    }

    case "update": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft blocks update <id> --markdown STR");
      const markdown = await readMarkdown(args.flags);
      const font = args.flags.font;
      let priorState: any = null;
      try {
        priorState = await client.blocks.get(id, { format: "json", maxDepth: 0 });
      } catch { /* best effort */ }
      const res = await client.blocks.update([
        { id, markdown, font },
      ]);
      try {
        const journal = getJournal();
        // use parent doc/page id if available from --parent flag or positional context
        const docId = (args.flags.parent as string) ?? id;
        journal.record({
          op: "update",
          docId,
          blockIds: [id],
          pre: priorState ? [{ id, markdown: priorState.markdown }] : null,
          post: [{ id, markdown, font }],
        });
      } catch (e) {
        console.error(dim(`journal warning: ${(e as Error).message}`));
      }
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : "updated");
      return;
    }

    case "rm":
    case "delete": {
      if (args.positional.length === 0) throw new Error("usage: craft blocks rm <id>...");
      let preSnapshots: unknown[] = [];
      try {
        preSnapshots = await Promise.all(
          args.positional.map(id =>
            client.blocks.get(id, { format: "json", maxDepth: 0 }).catch(() => null)
          )
        );
      } catch { /* best effort */ }
      const res = await client.blocks.delete(args.positional);
      try {
        const journal = getJournal();
        journal.record({
          op: "delete",
          docId: args.positional[0],
          blockIds: args.positional,
          pre: preSnapshots.filter(Boolean),
        });
      } catch (e) {
        console.error(dim(`journal warning: ${(e as Error).message}`));
      }
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `deleted ${res.items.length}`);
      return;
    }

    case "mv":
    case "move": {
      if (args.positional.length === 0) throw new Error("usage: craft blocks mv <id>... --to pageId|--date DATE");
      const to = args.flags.to as string | undefined;
      const date = args.flags.date as string | undefined;
      if (!to && !date) throw new Error("--to <pageId> or --date DATE required");
      const position: Position = date
        ? { position: (args.flags.position as any) ?? "end", date }
        : { position: (args.flags.position as any) ?? "end", pageId: to! };
      const res = await client.blocks.move(args.positional, position);
      try {
        const journal = getJournal();
        const docId = (position as any).pageId ?? `daily:${(position as any).date}`;
        journal.record({
          op: "move",
          docId,
          blockIds: args.positional,
          post: position,
        });
      } catch (e) {
        console.error(dim(`journal warning: ${(e as Error).message}`));
      }
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : "moved");
      return;
    }

    default:
      console.error(err(`unknown: blocks ${sub}`));
      process.exit(1);
  }
}

function buildTarget(target: string | undefined, flags: Record<string, any>): Position {
  const date = flags.date as string | undefined;
  const position = (flags.position as any) ?? "end";
  if (target && target !== "-") {
    return { position, pageId: target };
  }
  if (date) {
    return { position, date };
  }
  throw new Error("target required: pass a pageId positional or --date DATE");
}

async function readMarkdown(flags: Record<string, any>): Promise<string> {
  if (typeof flags.markdown === "string") return flags.markdown;
  if (typeof flags.file === "string") return await Bun.file(flags.file).text();
  // read stdin
  return await readStdin();
}
