import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { readStdin } from "../args.ts";
import { err } from "../format.ts";

export async function runWhiteboards(argv: string[]) {
  const sub = argv[0];

  if (sub === "el" || sub === "elements") {
    return runElements(argv.slice(1));
  }

  const rest = argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      parent: { type: "string" },
      position: { type: "string" },
    },
  });
  const { client } = await buildClient(args);

  switch (sub) {
    case "mk":
    case "create": {
      if (!args.flags.parent) throw new Error("usage: craft wb mk --parent PAGE_ID");
      const res = await client.whiteboards.create({
        position: (args.flags.position as any) ?? "end",
        pageId: args.flags.parent as string,
      });
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : res.whiteboardBlockId);
      return;
    }
    default:
      console.error(err(`unknown: wb ${sub}`));
      console.error("usage: craft wb {mk --parent ID | el {ls|add|update|rm} <wbId>}");
      process.exit(1);
  }
}

async function runElements(argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      file: { type: "string" },
    },
  });
  const { client } = await buildClient(args);

  const wbId = args.positional[0];
  if (!wbId) throw new Error("usage: craft wb el <sub> <wbId> [...]");

  switch (sub) {
    case "ls":
    case "get": {
      const res = await client.whiteboards.getElements(wbId);
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    case "add": {
      const text = args.flags.file ? await Bun.file(args.flags.file as string).text() : await readStdin();
      const elements = JSON.parse(text);
      const res = await client.whiteboards.addElements(wbId, Array.isArray(elements) ? elements : elements.elements);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `added ${res.elements.length}`);
      return;
    }
    case "update": {
      const text = args.flags.file ? await Bun.file(args.flags.file as string).text() : await readStdin();
      const elements = JSON.parse(text);
      const res = await client.whiteboards.updateElements(wbId, Array.isArray(elements) ? elements : elements.elements);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : "updated");
      return;
    }
    case "rm":
    case "delete": {
      const ids = args.positional.slice(1);
      if (ids.length === 0) throw new Error("usage: craft wb el rm <wbId> <elementId>...");
      const res = await client.whiteboards.deleteElements(wbId, ids);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `deleted ${res.deletedCount}`);
      return;
    }
    default:
      throw new Error(`unknown: wb el ${sub}`);
  }
}
