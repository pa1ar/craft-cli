#!/usr/bin/env bun
// craft — entry point, subcommand dispatcher.
import { CraftError } from "../lib/errors.ts";
import { err } from "./format.ts";
import { runSetup } from "./commands/setup.ts";
import { runWhoami } from "./commands/whoami.ts";
import { runProfiles } from "./commands/profiles.ts";
import { runFolders } from "./commands/folders.ts";
import { runDocs } from "./commands/docs.ts";
import { runBlocks } from "./commands/blocks.ts";
import { runTasks } from "./commands/tasks.ts";
import { runCollections } from "./commands/collections.ts";
import { runUpload } from "./commands/upload.ts";
import { runComment } from "./commands/comment.ts";
import { runWhiteboards } from "./commands/whiteboards.ts";
import { runRaw } from "./commands/raw.ts";
import { runLinks } from "./commands/links.ts";
import { runCat } from "./commands/cat.ts";
import { runLog } from "./commands/log.ts";
import { runDiff } from "./commands/diff.ts";
import { runPatch } from "./commands/patch.ts";
import { runUndo } from "./commands/undo.ts";
import { runMode } from "./commands/mode.ts";
import { closeJournal } from "./journal-singleton.ts";
import { loadConfig, resolveMode } from "./config.ts";
import { setModeOverride } from "./local.ts";

const HELP = `craft — Craft Docs CLI
Repo: https://github.com/pa1ar/craft-cli
Agent docs / recipes / caveats: <repo>/skill/SKILL.md

Usage: craft <command> [args]

Quick start (fresh machine)
  1. craft setup --url <URL> --key <KEY>    (get from Craft → Settings → Developer)
  2. craft mode api                          on Linux / headless / no Craft app
  3. craft whoami                            verify

Setup
  setup --url URL --key KEY [--profile NAME]   store credentials (verified)
  whoami                                        show active profile + space
  profiles {list|use|rm}                        manage profiles
  mode [api|hybrid]                             show or set read mode (hybrid default)

Read
  folders ls [--tree] [--json]                  list folders
  docs ls [--location L] [--folder ID] [--json] list documents
  docs search <pattern> [--include] [--folder] [--fetch-blocks] [--json]
  docs get <id> [--json] [--depth N] [--metadata] [--raw] [--no-links] [--exhaustive]
  docs daily [DATE] [--json] [--raw] [--no-links]   fetch daily note
  cat <id> [id...]                                   read multiple docs, concat output
  diff <docId>                                       compare to last known state
  blocks get <id> [--json] [--depth N] [--no-links]
  # backlinks are appended by default — pass --no-links to skip the extra search call
  blocks search <docId> <pattern> [--before N] [--after N] [--fetch]
  tasks ls <scope> [--doc ID] [--json]

Write
  folders mk <name> [--parent ID]
  folders mv <id>... --to root|ID
  folders rm <id>...
  docs mk <title>... [--folder ID | --location L]
  docs mv <id>... --to folder|unsorted|templates|ID
  docs rm <id>...                                (soft-delete → trash)
  blocks append <docId|--date DATE> --markdown STR   (or --file F | -)
  blocks insert <parentId|--date DATE> --json FILE
  blocks update <id> --markdown STR
  blocks rm <id>...
  patch <docId> --old STR --new STR       find and replace in blocks (or pipe old\\n---\\nnew)
  blocks mv <id>... --to pageId|--date DATE
  tasks add <markdown> --to inbox|daily|doc [--doc ID] [--date D] [--schedule D]
  tasks update <id> [--state todo|done|canceled] [--markdown STR] [--schedule D]
  tasks rm <id>...
  undo [docId] [--force] [--dry-run]      revert last mutation

Collections
  col ls [--doc ID]
  col schema <id> [--format schema|json-schema-items]
  col items <id>
  col items add <id> --file F
  col items update <id> --file F
  col items rm <id> <itemId>...
  col mk --file F
  col rm <id>                                    (deletes the collection block)

Links
  links out <blockId>                            outgoing links (free, parses fetched tree)
  links in <blockId> [--text STR] [--exhaustive] backlinks via title search (fast) or full scan

Misc
  log [docId] [--last N] [--since DATE]              mutation history
  upload <file> (--parent ID | --date D | --sibling ID) [--position start|end|before|after]
  comment <blockId> <text>
  wb mk --parent ID
  wb el {ls|add|update|rm} <wbId> [...]
  raw <METHOD> <path> [--query k=v] [--body FILE|-] [--header k:v]

Global
  --profile NAME    override active profile
  --json            machine-readable output
  --api             force API-only for this command (overrides mode + CRAFT_MODE)
  --help            show this help

Env overrides
  CRAFT_URL, CRAFT_KEY    bypass config entirely
  CRAFT_PROFILE           default profile name
  CRAFT_MODE              override persistent mode: api | hybrid
  CRAFT_LOCAL_PATH        override local Craft database location
`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    console.log(HELP);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const cmd = argv[0]!;
  const rest = argv.slice(1);

  // resolve mode once per invocation and apply to the local singleton.
  // failures loading config are non-fatal - fresh machines running `setup`
  // have no config yet, and mode falls back to "hybrid" (default).
  try {
    const cfg = await loadConfig();
    const resolved = resolveMode(cfg);
    setModeOverride(resolved.mode);
  } catch {
    // leave singleton at its default
  }

  try {
    switch (cmd) {
      case "setup":
        await runSetup(rest);
        break;
      case "whoami":
        await runWhoami(rest);
        break;
      case "profiles":
        await runProfiles(rest);
        break;
      case "folders":
        await runFolders(rest);
        break;
      case "docs":
        await runDocs(rest);
        break;
      case "blocks":
        await runBlocks(rest);
        break;
      case "tasks":
        await runTasks(rest);
        break;
      case "col":
      case "collections":
        await runCollections(rest);
        break;
      case "upload":
        await runUpload(rest);
        break;
      case "comment":
        await runComment(rest);
        break;
      case "wb":
      case "whiteboards":
        await runWhiteboards(rest);
        break;
      case "raw":
        await runRaw(rest);
        break;
      case "links":
        await runLinks(rest);
        break;
      case "cat":
        await runCat(rest);
        break;
      case "log":
        await runLog(rest);
        break;
      case "diff":
        await runDiff(rest);
        break;
      case "patch":
        await runPatch(rest);
        break;
      case "undo":
        await runUndo(rest);
        break;
      case "mode":
        await runMode(rest);
        break;
      default:
        console.error(err(`unknown command: ${cmd}`));
        console.error("run 'craft --help' for usage");
        process.exit(1);
    }
  } catch (e) {
    if (e instanceof CraftError) {
      console.error(err(`[${e.kind}] ${e.status} ${e.path}`));
      console.error(err(`  ${e.message.split(": ").slice(1).join(": ") || e.message}`));
      if (e.details) {
        console.error(err(`  details: ${JSON.stringify(e.details).slice(0, 300)}`));
      }
      process.exit(e.toExitCode());
    }
    if (e instanceof Error) {
      console.error(err(`error: ${e.message}`));
      process.exit(1);
    }
    console.error(err(`error: ${String(e)}`));
    process.exit(1);
  } finally {
    closeJournal();
  }
}

main();
