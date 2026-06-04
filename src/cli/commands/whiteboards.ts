import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { readStdin } from "../args.ts";
import { err, jsonOutForArgs } from "../format.ts";

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
      const position = {
        position: (args.flags.position as any) ?? "end",
        pageId: args.flags.parent as string,
      };
      if (args.flags["dry-run"]) {
        const preview = { op: "whiteboards.create", position };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : "dry-run: would create whiteboard");
        return;
      }
      const res = await client.whiteboards.create(position);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : res.whiteboardBlockId);
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
      console.log(jsonOutForArgs(res, { ...args.flags, json: true }));
      return;
    }
    case "add": {
      const text = args.flags.file ? await Bun.file(args.flags.file as string).text() : await readStdin();
      const elements = JSON.parse(text);
      const items = Array.isArray(elements) ? elements : elements.elements;
      if (args.flags["dry-run"]) {
        const preview = { op: "whiteboards.elements.add", whiteboardId: wbId, elements: items };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would add ${items.length} whiteboard elements`);
        return;
      }
      const res = await client.whiteboards.addElements(wbId, items);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `added ${res.elements.length}`);
      return;
    }
    case "update": {
      const text = args.flags.file ? await Bun.file(args.flags.file as string).text() : await readStdin();
      const elements = JSON.parse(text);
      const items = Array.isArray(elements) ? elements : elements.elements;
      if (args.flags["dry-run"]) {
        const preview = { op: "whiteboards.elements.update", whiteboardId: wbId, elements: items };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would update ${items.length} whiteboard elements`);
        return;
      }
      const res = await client.whiteboards.updateElements(wbId, items);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : "updated");
      return;
    }
    case "rm":
    case "delete": {
      const ids = args.positional.slice(1);
      if (ids.length === 0) throw new Error("usage: craft wb el rm <wbId> <elementId>...");
      if (args.flags["dry-run"]) {
        const preview = { op: "whiteboards.elements.delete", whiteboardId: wbId, ids };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would delete ${ids.length} whiteboard elements`);
        return;
      }
      const res = await client.whiteboards.deleteElements(wbId, ids);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `deleted ${res.deletedCount}`);
      return;
    }
    default:
      throw new Error(`unknown: wb el ${sub}`);
  }
}
