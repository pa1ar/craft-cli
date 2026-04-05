import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { table, err } from "../format.ts";
import type { TaskScope, TaskLocation } from "../../lib/types.ts";

export async function runTasks(argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      doc: { type: "string" },
      to: { type: "string" }, // inbox | daily | doc
      date: { type: "string" },
      schedule: { type: "string" },
      deadline: { type: "string" },
      state: { type: "string" },
      markdown: { type: "string" },
    },
  });
  const { client } = await buildClient(args);

  switch (sub) {
    case "ls":
    case "list": {
      const scope = args.positional[0] as TaskScope | undefined;
      if (!scope) throw new Error("usage: craft tasks ls <inbox|active|upcoming|logbook|document> [--doc ID]");
      const res = await client.tasks.list(scope, args.flags.doc);
      if (args.flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log(
        table(
          res.items.map((t) => ({
            id: t.id,
            state: t.taskInfo?.state ?? "",
            schedule: t.taskInfo?.scheduleDate ?? "",
            task: t.markdown,
          }))
        )
      );
      return;
    }

    case "add": {
      const md = args.positional.join(" ");
      if (!md) throw new Error("usage: craft tasks add <markdown> --to inbox|daily|doc [--doc ID] [--date D]");
      const to = args.flags.to as string;
      let location: TaskLocation;
      if (to === "inbox") location = { type: "inbox" };
      else if (to === "daily") location = { type: "dailyNote", date: (args.flags.date as string) ?? "today" };
      else if (to === "doc") {
        if (!args.flags.doc) throw new Error("--to doc requires --doc ID");
        location = { type: "document", documentId: args.flags.doc as string };
      } else throw new Error("--to inbox|daily|doc required");

      const res = await client.tasks.add([
        {
          markdown: md,
          location,
          taskInfo: {
            scheduleDate: args.flags.schedule as any,
            deadlineDate: args.flags.deadline as any,
          },
        },
      ]);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `added ${res.items[0]?.id}`);
      return;
    }

    case "update": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft tasks update <id> [--state ...] [--markdown STR] [--schedule D]");
      const res = await client.tasks.update([
        {
          id,
          markdown: args.flags.markdown,
          taskInfo: {
            state: args.flags.state as any,
            scheduleDate: args.flags.schedule as any,
            deadlineDate: args.flags.deadline as any,
          },
        },
      ]);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : "updated");
      return;
    }

    case "rm":
    case "delete": {
      if (args.positional.length === 0) throw new Error("usage: craft tasks rm <id>...");
      const res = await client.tasks.delete(args.positional);
      console.log(args.flags.json ? JSON.stringify(res, null, 2) : `deleted ${res.items.length}`);
      return;
    }

    default:
      console.error(err(`unknown: tasks ${sub}`));
      process.exit(1);
  }
}
