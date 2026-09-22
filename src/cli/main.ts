#!/usr/bin/env bun
// craft — entry point, subcommand dispatcher.
import { CraftError } from "../lib/errors.ts";
import { err } from "./format.ts";
import { closeJournal } from "./journal-singleton.ts";
import { loadConfig, resolveSource } from "./config.ts";
import { setSourceOverride } from "./local.ts";

const HELP = `craft — Craft Docs CLI
Repo: https://github.com/pa1ar/craft-cli

AI agents: use the user's canonical craft-cli skill when configured. Otherwise register the bundled skill/ folder as craft-cli in your harness's supported skill location (keep its references/ folder).
Remote Agent Skills: craft lib --help explains connection setup, collection schema and export.

Usage: craft <command> [args]

Quick start (fresh machine)
  1. craft setup --url <URL> --key <KEY>    (get from Craft → Settings → Developer)
  2. craft source auto                       on macOS with Craft Desktop (local-first)
     craft source api                        only on Linux / headless / no Craft app
  3. craft doctor --json                     verify API and local availability

Setup
  setup --url URL --key KEY [--name PROFILE]   store credentials (verified)
  doctor [--json]                               verify auth, API, source, local store
  whoami                                        show active profile + space
  profiles {list|use|rm}                        manage profiles
  source [auto|api|local]                       show or set read source (auto default)
  mode [api|hybrid]                             legacy alias for source auto|api

Read routing (important)
  Keep source=auto on macOS. Do not pass --api for ordinary reads.
  auto uses the local Craft cache for unfiltered docs ls and simple docs search,
  then falls back to REST when unavailable or when filters require the API.
  Markdown read/get/daily/cat also use local cache first. Structured/raw reads,
  tasks, reminders, collections, links, and every write use REST.
  media local reads Craft's on-device asset cache. Local files are read-only.

Read
  read <id> [--lines A:B | --head N | --outline] [--budget N]
                                               read Markdown; alias for docs get
  folders ls [--tree] [--json]                  list folders
  docs ls [--location L] [--folder ID] [--json] list documents
  docs search <pattern> [--include] [--folder] [--fetch-blocks] [--json]
  docs get <id> [--json] [--depth N] [--metadata] [--raw] [--links] [--exhaustive]
  docs daily [DATE] [--json] [--raw] [--links]       fetch daily note
  cat <id> [id...]                                   read multiple docs, concat output
  # read shaping also works on docs get/daily, blocks get, and cat.
  # --lines is 1-based/inclusive; --budget counts Unicode characters (min 11)
  # across all cat output, including separators. Truncation ends with [truncated].
  diff <docId>                                       compare to last known state
  blocks get <id> [--json] [--depth N] [--links]
  # markdown reads are local-first: the Craft Desktop cache serves them when
  # present; missing cache content falls back to API.
  # "(local)" or "(api)" is printed to stderr. --depth, --metadata, --raw and
  # --json use the API. Strict --source local rejects unsupported content reads.
  # backlinks need the API, so they are opt-in via --links.
  blocks search <docId> <pattern> [--before N] [--after N] [--fetch]
  tasks [ls [all|inbox|active|upcoming|logbook|document]] [filters] [--json]
    filters: --state S --doc ID --document TEXT --date D --scheduled D --deadline D
             --location L --text TEXT --priority P --repeat yes|no --reminder yes|no --overdue
    run 'craft tasks --help' for date ranges, notification alias, and all filters
  reminders [ls] [--status incomplete|completed|upcoming|all] [--limit N] [--cursor C]
    run 'craft reminders --help' for create, reschedule, complete, reopen, and delete

Write
  folders mk <name> [--parent ID]
  folders mv <id>... --to root|ID
  folders rm <id>...
  docs mk <title>... [--folder ID | --location L]
  docs mv <id>... --to folder|unsorted|templates|ID
  docs rm <id>...                                (soft-delete → trash)
  blocks append <docId|--date DATE> --markdown STR   (or --file F | -)
  blocks insert <parentId|--date DATE> --file FILE   (typed block JSON; pass live r.craft.do URLs, API re-signs them)
  blocks update <id> --markdown STR
  blocks rm <id>...
  patch <docId> --old STR --new STR       find and replace in blocks (or pipe old\\n---\\nnew)
  blocks mv <id>... --to pageId|--date DATE
  tasks add <markdown> --to inbox|daily|doc [--doc ID] [--date D] [--schedule D]
  tasks update <id> [--state todo|done|canceled] [--markdown STR] [--schedule D] [--deadline D] [--to inbox|daily|doc]
  tasks rm <id>...
  reminders add <blockId>... [--at ISO8601]       (omit --at to Save for later)
  reminders reschedule <id>... --at ISO8601|none
  reminders complete|reopen|rm <id>...
  undo [docId] [--force] [--dry-run]      revert last mutation

Collections
  col ls [--doc ID]
  col schema <id> [--format schema|json-schema-items]
  col items <id> [--status S] [--forai yes|no] [--byai yes|no] [--assignee TAG]
             [--prop k=v] [--text Q] [--limit N] [--flat] [--preview] [--json [--select F]]
  col items add <id> --file F
  col items update <id> --file F
  col items rm <id> <itemId>...
  # list defaults to a clean table (no content previews). --json drops previews
  # unless --preview. --flat lifts properties.* to top level for easy --select.
  # --forai/--byai filter assignee multiSelect (forAI/byAI); --assignee matches one tag.
  # filters are client-side (API returns all items; local collection cache TBD).
  col views <id>
  col views create <id> --file F
  col views update <id> <viewId> --file F
  col views active <id> <viewId>
  col views rm <id> <viewId>
  col mk --file F
  col rm <id>                                    (deletes the collection block)

Links
  links out <blockId>                            outgoing links (free, parses fetched tree)
  links in <blockId> [--text STR] [--exhaustive] backlinks via title search (fast) or full scan

Misc
  agent-context [--json]                        emit stable JSON manifest for agents
  which <capability> [--json]                   find command for an intent
  log [docId] [--last N] [--since DATE]              mutation history
  upload <file> (--parent ID | --date D | --sibling ID) [--position start|end|before|after]
  comment <blockId> <text>
  wb mk --parent ID
  wb el {ls|add|update|rm} <wbId> [...]
  raw <METHOD> <path> [--query k=v] [--body FILE|-] [--header k:v]
  skills {ls|search|show|validate|run} [...]         demand-loaded automation skills
  lib {list|get|export} --collection ID [...]      remote skill catalog and SKILL.md retrieval
  media local <blockId> [--all]                         resolve on-device media paths
  media analyze <blockId> [--estimate] [--max-cost EUR] analyze media, preferring on-device files
  media replace <blockId> <file> [--content-type TYPE]  upload, verify, then replace media block

Global
  --profile NAME    override active profile
  --json            machine-readable output
  --source S        read source for this command: auto | api | local
  --api             shortcut for --source api
  --select FIELDS   project JSON output to comma-separated fields
  --help            show this help

Env overrides
  CRAFT_URL, CRAFT_KEY    bypass config entirely
  CRAFT_PROFILE           default profile name
  CRAFT_SOURCE            override persistent source: auto | api | local
  CRAFT_MODE              legacy override: api | hybrid
  CRAFT_LOCAL_PATH        override local Craft database location
  CRAFT_ON_DEVICE_ASSETS_PATH  override Craft OnDeviceAssets discovery
`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    console.log(HELP);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const cmd = argv[0]!;
  const rest = argv.slice(1);

  if (cmd === "__local") {
    const { runLocalWorker } = await import("./commands/local-worker.ts");
    await runLocalWorker(rest);
    return;
  }

  // resolve source once per invocation and apply to the local singleton.
  // failures loading config are non-fatal - fresh machines running `setup`
  // have no config yet, and mode falls back to "hybrid" (default).
  try {
    const cfg = await loadConfig();
    const resolved = resolveSource(cfg);
    setSourceOverride(resolved.source);
  } catch {
    // leave singleton at its default
  }

  try {
    switch (cmd) {
      case "setup":
        await (await import("./commands/setup.ts")).runSetup(rest);
        break;
      case "doctor":
        await (await import("./commands/doctor.ts")).runDoctor(rest);
        break;
      case "agent-context":
        await (await import("./commands/agent-context.ts")).runAgentContext(rest);
        break;
      case "which":
        await (await import("./commands/which.ts")).runWhich(rest);
        break;
      case "skills":
        await (await import("./commands/skills.ts")).runSkills(rest);
        break;
      case "lib":
        await (await import("./commands/lib.ts")).runLib(rest);
        break;
      case "media":
        await (await import("./commands/media.ts")).runMedia(rest);
        break;
      case "whoami":
        await (await import("./commands/whoami.ts")).runWhoami(rest);
        break;
      case "profiles":
        await (await import("./commands/profiles.ts")).runProfiles(rest);
        break;
      case "folders":
        await (await import("./commands/folders.ts")).runFolders(rest);
        break;
      case "docs":
        await (await import("./commands/docs.ts")).runDocs(rest);
        break;
      case "read":
        await (await import("./commands/docs.ts")).runDocs(["get", ...rest]);
        break;
      case "blocks":
        await (await import("./commands/blocks.ts")).runBlocks(rest);
        break;
      case "tasks":
        await (await import("./commands/tasks.ts")).runTasks(rest);
        break;
      case "reminders":
        await (await import("./commands/reminders.ts")).runReminders(rest);
        break;
      case "col":
      case "collections":
        await (await import("./commands/collections.ts")).runCollections(rest);
        break;
      case "upload":
        await (await import("./commands/upload.ts")).runUpload(rest);
        break;
      case "comment":
        await (await import("./commands/comment.ts")).runComment(rest);
        break;
      case "wb":
      case "whiteboards":
        await (await import("./commands/whiteboards.ts")).runWhiteboards(rest);
        break;
      case "raw":
        await (await import("./commands/raw.ts")).runRaw(rest);
        break;
      case "links":
        await (await import("./commands/links.ts")).runLinks(rest);
        break;
      case "cat":
        await (await import("./commands/cat.ts")).runCat(rest);
        break;
      case "log":
        await (await import("./commands/log.ts")).runLog(rest);
        break;
      case "diff":
        await (await import("./commands/diff.ts")).runDiff(rest);
        break;
      case "patch":
        await (await import("./commands/patch.ts")).runPatch(rest);
        break;
      case "undo":
        await (await import("./commands/undo.ts")).runUndo(rest);
        break;
      case "mode":
        await (await import("./commands/mode.ts")).runMode(rest);
        break;
      case "source":
        await (await import("./commands/mode.ts")).runSource(rest);
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
        // validation errors come back as an array of {code, path, message}.
        // print them as readable field-path bullets instead of raw JSON so
        // callers (especially scripts driving collections) can see which
        // field is wrong without grepping.
        if (Array.isArray(e.details)) {
          for (const d of e.details as any[]) {
            const path = Array.isArray(d?.path) ? d.path.join(".") : d?.path ?? "";
            const msg = d?.message ?? d?.code ?? JSON.stringify(d);
            console.error(err(`  - ${path ? path + ": " : ""}${msg}`));
          }
        } else {
          console.error(err(`  details: ${JSON.stringify(e.details).slice(0, 300)}`));
        }
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
