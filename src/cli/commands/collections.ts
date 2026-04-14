import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { readStdin } from "../args.ts";
import { table, err } from "../format.ts";

export async function runCollections(argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);

  // handle nested: col items <sub>
  if (sub === "items") {
    return runItems(argv.slice(1));
  }
  if (sub === "schema") {
    return runSchema(argv.slice(1));
  }

  const args = parseWithGlobals(rest, {
    flags: {
      doc: { type: "string" },
      file: { type: "string" },
      parent: { type: "string" },
      position: { type: "string" },
    },
  });
  const { client } = await buildClient(args);

  switch (sub) {
    case "ls":
    case "list": {
      const res = await client.collections.list(args.flags.doc);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : table(res.items as any));
      return;
    }
    case "mk":
    case "create": {
      if (!args.flags.file) throw new Error("usage: craft col mk --file schema.json --parent DOCID");
      if (!args.flags.parent) throw new Error("--parent DOCID required");
      const schema = JSON.parse(await Bun.file(args.flags.file as string).text());
      const res = await client.collections.create(schema, {
        position: (args.flags.position as any) ?? "end",
        pageId: args.flags.parent as string,
      });
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `created ${res.collectionBlockId}`);
      return;
    }
    case "rm": {
      // delete collection = delete its block
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft col rm <collectionBlockId>");
      const res = await client.blocks.delete([id]);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : "deleted");
      return;
    }
    default:
      console.error(err(`unknown: col ${sub}`));
      process.exit(1);
  }
}

async function runSchema(argv: string[]) {
  // parse flags first so sub-verb detection is flag-order independent.
  // `col schema <id>` is a get. only `set` is a true sub-subcommand.
  const args = parseWithGlobals(argv, {
    flags: {
      format: { type: "string" },
      file: { type: "string" },
    },
  });
  const { client } = await buildClient(args);

  const isSet = args.positional[0] === "set";
  const id = isSet ? args.positional[1] : args.positional[0];

  if (isSet) {
    if (!id) throw new Error("usage: craft col schema set <id> --file schema.json");
    if (!args.flags.file) throw new Error("--file required");
    const schema = JSON.parse(await Bun.file(args.flags.file as string).text());
    const res = await client.collections.updateSchema(id, schema);
    console.log(args.flags.json ? JSON.stringify(res, null, 2) : "schema updated");
    return;
  }

  if (!id) throw new Error("usage: craft col schema <id> [--format schema|json-schema-items]");
  const res = await client.collections.getSchema(id, (args.flags.format as any) ?? "json-schema-items");
  console.log(JSON.stringify(res, null, 2));
}

async function runItems(argv: string[]) {
  // parse flags first so sub-verb detection is flag-order independent.
  // `col items <id>` lists. known verbs consume positional[0]; otherwise
  // positional[0] is the collection id and we default to list.
  const args = parseWithGlobals(argv, {
    flags: {
      file: { type: "string" },
      depth: { type: "number" },
    },
  });
  const { client } = await buildClient(args);

  const VERBS = new Set(["ls", "list", "add", "update", "rm", "delete"]);
  const hasVerb = args.positional[0] !== undefined && VERBS.has(args.positional[0]!);
  const sub = hasVerb ? args.positional[0] : "list";
  if (hasVerb) args.positional.shift();

  switch (sub) {
    case undefined:
    case "ls":
    case "list": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft col items <collectionId>");
      const res = await client.collections.getItems(id, args.flags.depth);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : JSON.stringify(res.items, null, 2));
      return;
    }
    case "add": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft col items add <collectionId> --file items.json");
      const text = args.flags.file ? await Bun.file(args.flags.file as string).text() : await readStdin();
      const payload = JSON.parse(text);
      const items = Array.isArray(payload) ? payload : payload.items;
      const res = await client.collections.addItems(id, items);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `added ${res.items.length} items`);
      return;
    }
    case "update": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft col items update <collectionId> --file updates.json");
      const text = args.flags.file ? await Bun.file(args.flags.file as string).text() : await readStdin();
      const payload = JSON.parse(text);
      const items = Array.isArray(payload) ? payload : payload.itemsToUpdate ?? payload.items;
      const res = await client.collections.updateItems(id, items);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `updated ${res.items.length} items`);
      return;
    }
    case "rm":
    case "delete": {
      const [colId, ...itemIds] = args.positional;
      if (!colId || itemIds.length === 0) throw new Error("usage: craft col items rm <collectionId> <itemId>...");
      const res = await client.collections.deleteItems(colId, itemIds);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `deleted ${res.items.length}`);
      return;
    }
    default:
      throw new Error(`unknown: col items ${sub}`);
  }
}
