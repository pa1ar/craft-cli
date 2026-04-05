import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { folderTree, table, err } from "../format.ts";

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
        console.log(JSON.stringify(res, null, 2));
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
      const res = await client.folders.create(
        names.map((name) => ({ name, parentFolderId: args.flags.parent }))
      );
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : table(res.items as any));
      return;
    }
    case "mv":
    case "move": {
      if (args.positional.length === 0) throw new Error("usage: craft folders mv <id>... --to root|ID");
      const to = args.flags.to as string | undefined;
      if (!to) throw new Error("--to required");
      const dest = to === "root" ? "root" : { parentFolderId: to };
      const res = await client.folders.move(args.positional, dest as any);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : "moved");
      return;
    }
    case "rm":
    case "delete": {
      if (args.positional.length === 0) throw new Error("usage: craft folders rm <id>...");
      const res = await client.folders.delete(args.positional);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `deleted ${res.items.length}`);
      return;
    }
    default:
      console.error(err(`unknown: folders ${sub}`));
      process.exit(1);
  }
}
