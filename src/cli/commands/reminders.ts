import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { dim, err, jsonOutForArgs, table } from "../format.ts";
import type { BlockReminderUpdate, ReminderStatus } from "../../lib/reminders.ts";

const STATUSES = new Set<ReminderStatus>(["incomplete", "completed", "upcoming", "all"]);

const REMINDERS_HELP = `craft reminders — manage experimental block reminders

Usage
  craft reminders [ls] [--status S] [--limit N] [--cursor C]
  craft reminders add <blockId>... [--at ISO8601]
  craft reminders reschedule <reminderId>... --at ISO8601|none
  craft reminders complete <reminderId>...
  craft reminders reopen <reminderId>...
  craft reminders rm <reminderId>...

Status: incomplete (default) | completed | upcoming | all
Omit --at when adding to Save for later without a notification.
Use --at none when rescheduling to clear the notification time.
Times must include Z or a UTC offset, for example 2030-01-15T10:00:00+01:00.

Availability: OAuth connections work in single-user and multi-user spaces. Link-based
connections support reminders only when the link creator is the space's sole active participant.`;

export async function runReminders(argv: string[]) {
  if (argv[0] === "help" || argv.includes("--help") || argv.includes("-h")) {
    console.log(REMINDERS_HELP);
    return;
  }

  const first = argv[0];
  const sub = !first || first.startsWith("-") ? "ls" : first;
  const rest = sub === "ls" && sub !== first ? argv : argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      status: { type: "string" },
      limit: { type: "number" },
      cursor: { type: "string" },
      at: { type: "string" },
    },
  });

  switch (sub) {
    case "ls":
    case "list": {
      if (args.positional.length > 0) throw new Error("usage: craft reminders ls [--status S] [--limit N] [--cursor C]");
      const status = parseStatus(args.flags.status);
      const limit = parseLimit(args.flags.limit);
      const { client } = await buildClient(args);
      const res = await client.reminders.list({
        status,
        limit,
        cursor: args.flags.cursor as string | undefined,
      });
      if (args.flags.json) {
        console.log(jsonOutForArgs(res, args.flags));
        return;
      }
      console.log(table(res.items.map((reminder) => ({
        id: reminder.id,
        state: reminder.isCompleted ? "completed" : "incomplete",
        remindAt: reminder.remindAt ?? "save for later",
        blockId: reminder.blockId,
        title: reminder.title,
      }))));
      if (res.pagination?.cursor) console.error(dim(`next cursor: ${res.pagination.cursor}`));
      return;
    }

    case "add":
    case "create": {
      requireIds(args.positional, "usage: craft reminders add <blockId>... [--at ISO8601]");
      const remindAt = parseRemindAt(args.flags.at);
      const reminders = args.positional.map((blockId) => ({ blockId, remindAt }));
      if (args.flags["dry-run"]) {
        const preview = { op: "reminders.create", reminders };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would create ${reminders.length} reminders`);
        return;
      }
      const { client } = await buildClient(args);
      const res = await client.reminders.create(reminders);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `created ${res.items.length} reminders`);
      return;
    }

    case "reschedule": {
      requireIds(args.positional, "usage: craft reminders reschedule <reminderId>... --at ISO8601|none");
      if (args.flags.at === undefined) throw new Error("reminders reschedule requires --at ISO8601|none");
      const remindAt = parseRemindAt(args.flags.at);
      const updates = args.positional.map((id) => ({ id, remindAt }));
      await updateReminders(args, updates, "reschedule", "rescheduled");
      return;
    }

    case "complete": {
      requireIds(args.positional, "usage: craft reminders complete <reminderId>...");
      await updateReminders(args, args.positional.map((id) => ({ id, isCompleted: true })), "complete", "completed");
      return;
    }

    case "reopen": {
      requireIds(args.positional, "usage: craft reminders reopen <reminderId>...");
      await updateReminders(args, args.positional.map((id) => ({ id, isCompleted: false })), "reopen", "reopened");
      return;
    }

    case "rm":
    case "delete": {
      requireIds(args.positional, "usage: craft reminders rm <reminderId>...");
      if (args.flags["dry-run"]) {
        const preview = { op: "reminders.delete", idsToDelete: args.positional };
        console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would delete ${args.positional.length} reminders`);
        return;
      }
      const { client } = await buildClient(args);
      const res = await client.reminders.delete(args.positional);
      console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `deleted ${res.items.length} reminders`);
      return;
    }

    default:
      console.error(err(`unknown: reminders ${sub}`));
      process.exit(1);
  }
}

async function updateReminders(
  args: ReturnType<typeof parseWithGlobals>,
  remindersToUpdate: BlockReminderUpdate[],
  action: string,
  pastTense: string
) {
  if (args.flags["dry-run"]) {
    const preview = { op: "reminders.update", remindersToUpdate };
    console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would ${action} ${remindersToUpdate.length} reminders`);
    return;
  }
  const { client } = await buildClient(args);
  const res = await client.reminders.update(remindersToUpdate);
  console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `${pastTense} ${res.items.length} reminders`);
}

function parseStatus(value: unknown): ReminderStatus | undefined {
  if (value === undefined) return undefined;
  const status = String(value).toLowerCase() as ReminderStatus;
  if (!STATUSES.has(status)) throw new Error("--status must be incomplete|completed|upcoming|all");
  return status;
}

function parseLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("--limit must be an integer from 1 to 200");
  return limit;
}

function parseRemindAt(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const remindAt = String(value).trim();
  if (["none", "null", "clear", "later"].includes(remindAt.toLowerCase())) return null;
  if (Number.isNaN(Date.parse(remindAt)) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(remindAt)) {
    throw new Error("--at must be an ISO 8601 timestamp with Z or a UTC offset, or none");
  }
  return remindAt;
}

function requireIds(ids: string[], usage: string): void {
  if (ids.length === 0) throw new Error(usage);
}
