import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { table, err, dim } from "../format.ts";

export async function runLinks(argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      text: { type: "string" }, // override link text for backlinks
      exhaustive: { type: "boolean" },
      "include-self": { type: "boolean" },
      folder: { type: "string" },
      concurrency: { type: "number" },
    },
  });
  const { client } = await buildClient(args);
  const id = args.positional[0];
  if (!id) throw new Error("usage: craft links {out|in} <blockId>");

  switch (sub) {
    case "out":
    case "outgoing": {
      const links = await client.links.outgoing(id);
      if (args.flags.json) {
        console.log(JSON.stringify(links, null, 2));
        return;
      }
      if (links.length === 0) {
        console.error(dim("no outgoing links"));
        return;
      }
      console.log(
        table(
          links.map((l) => ({
            target: l.blockId,
            text: l.text,
            from: l.inBlockId,
          }))
        )
      );
      console.error(dim(`\n${links.length} outgoing links`));
      return;
    }

    case "in":
    case "backlinks":
    case "incoming": {
      const links = args.flags.exhaustive
        ? await client.links.backlinksExhaustive(id, {
            folderId: args.flags.folder,
            concurrency: args.flags.concurrency,
          })
        : await client.links.backlinks(id, {
            linkText: args.flags.text,
            includeSelf: args.flags["include-self"],
          });

      if (args.flags.json) {
        console.log(JSON.stringify(links, null, 2));
        return;
      }
      if (links.length === 0) {
        console.error(dim("no backlinks"));
        return;
      }
      console.log(
        table(
          links.map((l) => ({
            source_doc: l.inDocumentId,
            source_block: l.inBlockId,
            text: l.text,
          }))
        )
      );
      console.error(
        dim(`\n${links.length} backlinks${args.flags.exhaustive ? " (exhaustive scan)" : ""}`)
      );
      return;
    }

    default:
      console.error(err(`unknown: links ${sub}`));
      console.error("usage: craft links out <blockId>           # outgoing links from a block");
      console.error("       craft links in <blockId> [--text STR] [--exhaustive]");
      process.exit(1);
  }
}
