import { parseWithGlobals } from "../client-factory.ts";
import { err, jsonOutForArgs, table } from "../format.ts";

const CAPABILITIES = [
  { keys: ["health", "doctor", "auth", "debug"], command: "craft doctor --json", why: "verify auth, API, source, local store" },
  { keys: ["source", "mode", "local", "api", "linux"], command: "craft source [auto|api|local]", why: "control local-first vs API reads" },
  { keys: ["search", "find", "grep"], command: "craft docs search <pattern>", why: "vault-wide document search" },
  { keys: ["read", "get", "document", "doc"], command: "craft docs get <id>", why: "fetch document content" },
  { keys: ["daily", "today", "journal"], command: "craft docs daily [date]", why: "fetch daily note" },
  { keys: ["append", "write", "markdown"], command: "craft blocks append <docId|--date DATE> --markdown STR", why: "append markdown content" },
  { keys: ["edit", "replace", "patch"], command: "craft patch <docId> --old STR --new STR", why: "surgical block edit" },
  { keys: ["task", "tasks", "todo", "find task", "reminder", "deadline", "overdue"], command: "craft tasks --state todo --json", why: "list and filter all tasks across the space" },
  { keys: ["add task", "create task", "task inbox"], command: "craft tasks add <markdown> --to inbox|daily|doc", why: "create task" },
  { keys: ["collection", "collections", "database", "kanban", "gallery", "view", "views", "board"], command: "craft col views <collectionId>", why: "manage collection view configuration and active view" },
  { keys: ["upload", "image", "file", "media"], command: "craft upload <file> (--parent ID | --date D)", why: "upload and insert media" },
  { keys: ["skills", "skill", "automation", "extension"], command: "craft skills search <query>", why: "discover bundled/local automation skills" },
  { keys: ["analyze", "analysis", "video", "audio", "transcript", "media"], command: "craft media analyze <blockId>", why: "analyze a Craft media block with OpenAI-backed bundled skill" },
  { keys: ["backlink", "backlinks", "incoming", "links"], command: "craft links in <blockId>", why: "find backlinks" },
  { keys: ["undo", "revert"], command: "craft undo [docId] --dry-run", why: "preview or revert last mutation" },
  { keys: ["history", "log", "journal"], command: "craft log [docId]", why: "show mutation journal" },
  { keys: ["multi", "cat", "batch"], command: "craft cat <id> [id...]", why: "read multiple docs" },
];

export async function runWhich(argv: string[]): Promise<void> {
  const args = parseWithGlobals(argv);
  const query = args.positional.join(" ").toLowerCase();
  if (!query) throw new Error("usage: craft which <capability>");
  const matches = CAPABILITIES.filter((item) =>
    item.keys.some((key) => query.includes(key) || key.includes(query))
  ).map(({ command, why, keys }) => ({ command, why, matches: keys.join(",") }));

  if (matches.length === 0) {
    console.error(err(`no command found for capability: ${query}`));
    process.exit(4);
  }
  if (args.flags.json) {
    console.log(jsonOutForArgs({ items: matches }, args.flags));
    return;
  }
  console.log(table(matches, ["command", "why"]));
}
