import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { table, err, dim, jsonOutForArgs } from "../format.ts";
import { getJournal } from "../journal-singleton.ts";
import type { Task, TaskScope, TaskLocation } from "../../lib/types.ts";
import {
  filterTasks,
  getTaskPriority,
  parseTaskLocation,
  parseTaskState,
  parseYesNo,
  type TaskFilters,
} from "../task-filters.ts";

const TASK_SCOPES = new Set<TaskScope>(["all", "inbox", "active", "upcoming", "logbook", "document"]);

const TASK_HELP = `craft tasks — explore and manage Craft tasks

Usage
  craft tasks [filters]                         list all tasks across the space
  craft tasks ls [scope] [filters]              scope: all|inbox|active|upcoming|logbook|document
  craft tasks ls document --doc ID              tasks in one document
  craft tasks add <markdown> --to inbox|daily|doc
  craft tasks update <id> [--state S] [--markdown STR] [--schedule D] [--deadline D] [--to ...]
  craft tasks rm <id>...

List filters
  --state todo|done|canceled
  --doc ID                     exact document ID
  --document TEXT              document-title substring
  --location inbox|document|daily
  --text TEXT                  task-content substring
  --date D                     schedule, deadline, or daily-note date
  --date-from D --date-to D
  --scheduled D|none           exact schedule date or unscheduled tasks
  --scheduled-from D --scheduled-to D
  --deadline D|none            exact deadline or tasks without a deadline
  --deadline-from D --deadline-to D
  --overdue                    open tasks with a deadline before today
  --repeat yes|no
  --reminder yes|no            --notification is an alias
  --priority VALUE|none        native priority when Craft exposes it
  --limit N

Dates: YYYY-MM-DD | today | yesterday | tomorrow
Output: --json for structured items + counts; --select FIELDS projects JSON fields`;

export async function runTasks(argv: string[]) {
  if (argv[0] === "help" || argv.includes("--help") || argv.includes("-h")) {
    console.log(TASK_HELP);
    return;
  }
  const first = argv[0];
  const sub = !first || first.startsWith("-") ? "ls" : first;
  const rest = sub === "ls" && sub !== first ? argv : argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      doc: { type: "string" },
      document: { type: "string" },
      location: { type: "string" },
      text: { type: "string" },
      to: { type: "string" }, // inbox | daily | doc
      date: { type: "string" },
      "date-from": { type: "string" },
      "date-to": { type: "string" },
      schedule: { type: "string" },
      scheduled: { type: "string" },
      "scheduled-from": { type: "string" },
      "scheduled-to": { type: "string" },
      deadline: { type: "string" },
      "deadline-from": { type: "string" },
      "deadline-to": { type: "string" },
      state: { type: "string" },
      priority: { type: "string" },
      repeat: { type: "string" },
      reminder: { type: "string" },
      notification: { type: "string" },
      overdue: { type: "boolean" },
      limit: { type: "number" },
      markdown: { type: "string" },
    },
  });
  const { client } = await buildClient(args);

  switch (sub) {
    case "ls":
    case "list": {
      const scope = (args.positional[0] ?? "all") as TaskScope;
      if (!TASK_SCOPES.has(scope)) {
        throw new Error("scope must be all|inbox|active|upcoming|logbook|document");
      }
      if (args.positional.length > 1) throw new Error("usage: craft tasks ls [scope] [filters]");
      if (scope === "document" && !args.flags.doc) throw new Error("document scope requires --doc ID");

      const reminder = parseYesNo(args.flags.reminder, "--reminder");
      const notification = parseYesNo(args.flags.notification, "--notification");
      if (reminder && notification && reminder !== notification) {
        throw new Error("--reminder and --notification cannot conflict");
      }
      const filters: TaskFilters = {
        state: parseTaskState(args.flags.state),
        documentId: args.flags.doc as string | undefined,
        documentTitle: args.flags.document as string | undefined,
        location: parseTaskLocation(args.flags.location),
        text: args.flags.text as string | undefined,
        date: args.flags.date as string | undefined,
        dateFrom: args.flags["date-from"] as string | undefined,
        dateTo: args.flags["date-to"] as string | undefined,
        scheduled: args.flags.scheduled as string | undefined,
        scheduledFrom: args.flags["scheduled-from"] as string | undefined,
        scheduledTo: args.flags["scheduled-to"] as string | undefined,
        deadline: args.flags.deadline as string | undefined,
        deadlineFrom: args.flags["deadline-from"] as string | undefined,
        deadlineTo: args.flags["deadline-to"] as string | undefined,
        priority: args.flags.priority as string | undefined,
        repeat: parseYesNo(args.flags.repeat, "--repeat"),
        reminder: reminder ?? notification,
        overdue: args.flags.overdue as boolean,
      };

      const res = await client.tasks.list(scope, args.flags.doc);
      const filtered = filterTasks(res.items, filters);
      const limit = args.flags.limit as number | undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit must be a positive integer");
      const items = limit === undefined ? filtered : filtered.slice(0, limit);
      const output = {
        items,
        meta: {
          scope,
          total: res.items.length,
          matched: filtered.length,
          returned: items.length,
          priorityAvailable: res.items.some((task) => getTaskPriority(task) !== undefined),
        },
      };
      if (args.flags.json) {
        console.log(jsonOutForArgs(output, args.flags));
        return;
      }
      console.log(
        table(
          items.map((t) => ({
            id: t.id,
            state: t.taskInfo?.state ?? "",
            schedule: t.taskInfo?.scheduleDate ?? "",
            deadline: t.taskInfo?.deadlineDate ?? "",
            location: formatTaskLocation(t),
            priority: getTaskPriority(t) ?? "",
            repeat: t.repeat?.frequency ?? "",
            reminder: (t.reminder?.enabled || t.taskInfo?.reminder?.enabled || t.repeat?.reminder?.enabled) ? "yes" : "",
            task: t.markdown,
          }))
        )
      );
      return;
    }

    case "add": {
      const md = args.positional.join(" ");
      if (!md) throw new Error("usage: craft tasks add <markdown> --to inbox|daily|doc [--doc ID] [--date D]");
      const to = args.flags.to as string | undefined;
      const location = taskLocationFromFlags(to, args.flags.doc, args.flags.date, true)!;

      if (args.flags["dry-run"]) {
        const preview = {
          op: "tasks.add",
          items: [{
            markdown: md,
            location,
            taskInfo: {
              scheduleDate: mutationDate(args.flags.schedule),
              deadlineDate: mutationDate(args.flags.deadline),
            },
          }],
        };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would add task to ${to}`);
        return;
      }
      const res = await client.tasks.add([
        {
          markdown: md,
          location,
          taskInfo: {
            scheduleDate: mutationDate(args.flags.schedule),
            deadlineDate: mutationDate(args.flags.deadline),
          },
        },
      ]);
      try {
        const journal = getJournal();
        journal.record({
          op: "task-add",
          docId: `tasks:${to}`,
          blockIds: res.items.map((t: any) => t.id),
          post: res.items,
        });
      } catch (e) {
        console.error(dim(`journal warning: ${(e as Error).message}`));
      }
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `added ${res.items[0]?.id}`);
      return;
    }

    case "update": {
      const id = args.positional[0];
      if (!id) throw new Error("usage: craft tasks update <id> [--state ...] [--markdown STR] [--schedule D]");
      if (args.flags["dry-run"]) {
        const preview = {
          op: "tasks.update",
          items: [{
            id,
            markdown: args.flags.markdown,
            location: taskLocationFromFlags(args.flags.to, args.flags.doc, args.flags.date),
            taskInfo: {
              state: parseTaskState(args.flags.state),
              scheduleDate: mutationDate(args.flags.schedule),
              deadlineDate: mutationDate(args.flags.deadline),
            },
          }],
        };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would update task ${id}`);
        return;
      }
      let priorState: unknown = null;
      try {
        const tasksRes = await client.tasks.list("all");
        priorState = tasksRes.items.find((t) => t.id === id) ?? null;
      } catch { /* best effort */ }
      const res = await client.tasks.update([
        {
          id,
          markdown: args.flags.markdown,
          location: taskLocationFromFlags(args.flags.to, args.flags.doc, args.flags.date),
          taskInfo: {
            state: parseTaskState(args.flags.state),
            scheduleDate: mutationDate(args.flags.schedule),
            deadlineDate: mutationDate(args.flags.deadline),
          },
        },
      ]);
      try {
        const journal = getJournal();
        journal.record({
          op: "task-update",
          docId: `tasks:${id}`,
          blockIds: [id],
          pre: priorState,
          post: res.items?.[0] ?? { markdown: args.flags.markdown, state: args.flags.state },
        });
      } catch (e) {
        console.error(dim(`journal warning: ${(e as Error).message}`));
      }
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : "updated");
      return;
    }

    case "rm":
    case "delete": {
      if (args.positional.length === 0) throw new Error("usage: craft tasks rm <id>...");
      if (args.flags["dry-run"]) {
        const preview = { op: "tasks.delete", ids: args.positional };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would delete ${args.positional.length} tasks`);
        return;
      }
      let preSnapshots: unknown[] = [];
      try {
        const allTasks = (await client.tasks.list("all")).items;
        preSnapshots = args.positional
          .map(id => allTasks.find((t) => t.id === id))
          .filter(Boolean);
      } catch { /* best effort */ }
      const res = await client.tasks.delete(args.positional);
      try {
        const journal = getJournal();
        journal.record({
          op: "task-delete",
          docId: `tasks:${args.positional[0]}`,
          blockIds: args.positional,
          pre: preSnapshots,
        });
      } catch (e) {
        console.error(dim(`journal warning: ${(e as Error).message}`));
      }
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `deleted ${res.items.length}`);
      return;
    }

    default:
      console.error(err(`unknown: tasks ${sub}`));
      process.exit(1);
  }
}

function mutationDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const normalized = String(value).trim();
  return ["none", "null", "clear"].includes(normalized.toLowerCase()) ? null : normalized;
}

function formatTaskLocation(task: Task): string {
  if (task.location?.type === "document") return task.location.title ?? task.location.documentId;
  if (task.location?.type === "dailyNote") return task.location.date;
  return task.location?.type ?? "";
}

function taskLocationFromFlags(
  to: unknown,
  doc: unknown,
  date: unknown,
  required = false
): TaskLocation | undefined {
  if (to === undefined) {
    if (required) throw new Error("--to inbox|daily|doc required");
    return undefined;
  }
  const target = String(to).trim().toLowerCase();
  if (target === "inbox") return { type: "inbox" };
  if (target === "daily") return { type: "dailyNote", date: date ? String(date) : "today" };
  if (target === "doc" || target === "document") {
    if (!doc) throw new Error("--to doc requires --doc ID");
    return { type: "document", documentId: String(doc) };
  }
  throw new Error("--to must be inbox|daily|doc");
}
