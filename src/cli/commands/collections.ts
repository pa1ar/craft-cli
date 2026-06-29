import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { readStdin } from "../args.ts";
import { table, err, jsonOutForArgs } from "../format.ts";

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
  if (sub === "views" || sub === "view") {
    return runViews(argv.slice(1));
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
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : table(res.items as any));
      return;
    }
    case "mk":
    case "create": {
      if (!args.flags.file) throw new Error("usage: craft col mk --file schema.json --parent DOCID");
      if (!args.flags.parent) throw new Error("--parent DOCID required");
      const schema = JSON.parse(await Bun.file(args.flags.file as string).text());
      const position = {
        position: (args.flags.position as any) ?? "end",
        pageId: args.flags.parent as string,
      };
      if (args.flags["dry-run"]) {
        const preview = { op: "collections.create", schema, position };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : "dry-run: would create collection");
        return;
      }
      const res = await client.collections.create(schema, position);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `created ${res.collectionBlockId}`);
      return;
    }
    case "rm": {
      // delete collection = delete its block
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft col rm <collectionBlockId>");
      if (args.flags["dry-run"]) {
        const preview = { op: "collections.delete", ids: [id] };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would delete collection ${id}`);
        return;
      }
      const res = await client.blocks.delete([id]);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : "deleted");
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
    if (args.flags["dry-run"]) {
      const preview = { op: "collections.schema.update", id, schema };
      console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would update schema ${id}`);
      return;
    }
    const res = await client.collections.updateSchema(id, schema);
    console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : "schema updated");
    return;
  }

  if (!id) throw new Error("usage: craft col schema <id> [--format schema|json-schema-items]");
  const res = await client.collections.getSchema(id, (args.flags.format as any) ?? "json-schema-items");
  console.log(jsonOutForArgs(res, { ...args.flags, json: true }));
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
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : JSON.stringify(res.items, null, 2));
      return;
    }
    case "add": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft col items add <collectionId> --file items.json");
      const text = args.flags.file ? await Bun.file(args.flags.file as string).text() : await readStdin();
      const payload = JSON.parse(text);
      const items = Array.isArray(payload) ? payload : payload.items;
      if (args.flags["dry-run"]) {
        const preview = { op: "collections.items.add", collectionId: id, items };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would add ${items.length} collection items`);
        return;
      }
      const res = await client.collections.addItems(id, items);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `added ${res.items.length} items`);
      return;
    }
    case "update": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft col items update <collectionId> --file updates.json");
      const text = args.flags.file ? await Bun.file(args.flags.file as string).text() : await readStdin();
      const payload = JSON.parse(text);
      const items = Array.isArray(payload) ? payload : payload.itemsToUpdate ?? payload.items;
      if (args.flags["dry-run"]) {
        const preview = { op: "collections.items.update", collectionId: id, items };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would update ${items.length} collection items`);
        return;
      }
      const res = await client.collections.updateItems(id, items);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `updated ${res.items.length} items`);
      return;
    }
    case "rm":
    case "delete": {
      const [colId, ...itemIds] = args.positional;
      if (!colId || itemIds.length === 0) throw new Error("usage: craft col items rm <collectionId> <itemId>...");
      if (args.flags["dry-run"]) {
        const preview = { op: "collections.items.delete", collectionId: colId, itemIds };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would delete ${itemIds.length} collection items`);
        return;
      }
      const res = await client.collections.deleteItems(colId, itemIds);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `deleted ${res.items.length}`);
      return;
    }
    default:
      throw new Error(`unknown: col items ${sub}`);
  }
}

async function runViews(argv: string[]) {
  // `col views <id>` lists. Known verbs consume positional[0]; otherwise
  // positional[0] is the collection id and we default to list.
  const args = parseWithGlobals(argv, {
    flags: {
      file: { type: "string" },
    },
  });
  const { client } = await buildClient(args);

  const VERBS = new Set(["ls", "list", "create", "mk", "update", "set", "rm", "delete", "active", "set-active"]);
  const hasVerb = args.positional[0] !== undefined && VERBS.has(args.positional[0]!);
  const sub = hasVerb ? args.positional[0] : "list";
  if (hasVerb) args.positional.shift();

  switch (sub) {
    case undefined:
    case "ls":
    case "list": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft col views <collectionId>");
      const res = await client.collections.listViews(id);
      if (args.flags.json) {
        console.log(jsonOutForArgs(res, args.flags));
        return;
      }
      const rows = res.views.map((view) => ({
        id: view.id,
        name: view.name,
        type: view.type,
        isActive: view.isActive ? "yes" : "",
      }));
      console.log(table(rows, ["id", "name", "type", "isActive"]));
      return;
    }
    case "create":
    case "mk": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft col views create <collectionId> --file view.json");
      const view = await readViewPayload(args.flags.file);
      if (args.flags["dry-run"]) {
        const preview = { op: "collections.views.create", collectionId: id, view };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would create ${view.type ?? "collection"} view`);
        return;
      }
      const res = await client.collections.createView(id, view);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `created ${res.id ?? "view"}`);
      return;
    }
    case "update":
    case "set": {
      const [collectionId, viewId] = args.positional;
      if (!collectionId || !viewId) {
        throw new Error("usage: craft col views update <collectionId> <viewId> --file view.json");
      }
      const view = await readViewPayload(args.flags.file);
      if (args.flags["dry-run"]) {
        const preview = { op: "collections.views.update", collectionId, viewId, view };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would update view ${viewId}`);
        return;
      }
      const res = await client.collections.updateView(collectionId, viewId, view);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `updated ${res.id ?? viewId}`);
      return;
    }
    case "rm":
    case "delete": {
      const [collectionId, viewId] = args.positional;
      if (!collectionId || !viewId) throw new Error("usage: craft col views rm <collectionId> <viewId>");
      if (args.flags["dry-run"]) {
        const preview = { op: "collections.views.delete", collectionId, viewId };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would delete view ${viewId}`);
        return;
      }
      const res = await client.collections.deleteView(collectionId, viewId);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `deleted ${res.deletedViewId}`);
      return;
    }
    case "active":
    case "set-active": {
      const [collectionId, viewId] = args.positional;
      if (!collectionId || !viewId) throw new Error("usage: craft col views active <collectionId> <viewId>");
      if (args.flags["dry-run"]) {
        const preview = { op: "collections.views.active", collectionId, viewId };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would set active view ${viewId}`);
        return;
      }
      const res = await client.collections.setActiveView(collectionId, viewId);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `active ${res.id ?? viewId}`);
      return;
    }
    default:
      throw new Error(`unknown: col views ${sub}`);
  }
}

async function readViewPayload(file?: unknown): Promise<Record<string, unknown>> {
  const text = typeof file === "string" ? await Bun.file(file).text() : await readStdin();
  const payload = JSON.parse(text);
  const view = payload && typeof payload === "object" && !Array.isArray(payload) && "view" in payload
    ? payload.view
    : payload;
  if (!view || typeof view !== "object" || Array.isArray(view)) {
    throw new Error("view payload must be an object or {\"view\": object}");
  }
  return view as Record<string, unknown>;
}
