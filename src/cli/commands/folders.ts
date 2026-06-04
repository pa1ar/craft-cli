import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { folderTree, table, err, jsonOutForArgs } from "../format.ts";

export async function runFolders(argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      table: { type: "boolean" },
      parent: { type: "string" },
      to: { type: "string" },
    },
  });

  const { client } = await buildClient(args);

  switch (sub) {
    case undefined:
    case "ls":
    case "list": {
      const res = await client.folders.list();
      if (args.flags.json) {
        console.log(jsonOutForArgs(res, args.flags));
        return;
      }
      if (args.flags.table) {
        console.log(table(res.items.map((f) => ({ id: f.id, name: f.name, count: f.documentCount ?? 0 }))));
      } else {
        console.log(folderTree(res.items as any));
      }
      return;
    }
    case "mk":
    case "create": {
      const names = args.positional;
      if (names.length === 0) throw new Error("usage: craft folders mk <name>... [--parent ID]");
      if (args.flags["dry-run"]) {
        const preview = { op: "folders.create", items: names.map((name) => ({ name, parentFolderId: args.flags.parent })) };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would create ${names.length} folders`);
        return;
      }
      const res = await client.folders.create(
        names.map((name) => ({ name, parentFolderId: args.flags.parent }))
      );
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : table(res.items as any));
      return;
    }
    case "mv":
    case "move": {
      if (args.positional.length === 0) throw new Error("usage: craft folders mv <id>... --to root|ID");
      const to = args.flags.to as string | undefined;
      if (!to) throw new Error("--to required");
      const dest = to === "root" ? "root" : { parentFolderId: to };
      if (args.flags["dry-run"]) {
        const preview = { op: "folders.move", ids: args.positional, destination: dest };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would move ${args.positional.length} folders`);
        return;
      }
      const res = await client.folders.move(args.positional, dest as any);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : "moved");
      return;
    }
    case "rm":
    case "delete": {
      if (args.positional.length === 0) throw new Error("usage: craft folders rm <id>...");
      if (args.flags["dry-run"]) {
        const preview = { op: "folders.delete", ids: args.positional };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would delete ${args.positional.length} folders`);
        return;
      }
      const res = await client.folders.delete(args.positional);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `deleted ${res.items.length}`);
      return;
    }
    default:
      console.error(err(`unknown: folders ${sub}`));
      process.exit(1);
  }
}
