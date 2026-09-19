---
name: craft-cli
description: Local-first Craft Docs CLI for searching, reading, and editing Pavel's Craft vault. On macOS it uses Craft Desktop's cache for eligible reads, falls back to REST when needed, and sends all writes through the API. Triggers for Craft docs, the PKM vault, LTM, daily notes, media, tasks, collections, or "c:" / "in craft".
---

# craft-cli — Craft Docs from the shell

`craft` is the compiled Bun CLI. Locate it with `command -v craft`; source checkouts and binary install paths are setup-specific. Library exports at `@1ar/craft-cli/lib` are available for Raycast/Node reuse when that package is installed.

## Required read routing

1. On macOS with Craft Desktop installed, keep `craft source auto`. Do not add `--api` by habit or persist API-only mode for normal work.
2. In `auto`, unfiltered `craft docs ls` and simple `craft docs search` queries, plus Markdown `read`, `docs get/daily`, `blocks get`, and `cat`, use Craft's local SQLite/PlainTextSearch cache first. Successful human output is marked `(local)`.
3. `auto` falls back to REST when local data is unavailable or the query needs API-only filters. Structured/raw/depth/metadata reads, tasks, collections, backlinks, and explicit remote-state checks require the API. Strict local Markdown reads reject unsupported options.
4. All writes always use the REST API. Local Craft files are read-only inputs.
5. Before a multi-read workflow, run `craft source --json`. If it reports `api` on a Mac and the task did not explicitly require authoritative remote reads, run `craft source auto`.

## When to use this vs the Craft MCP server

- **Use `craft` CLI**: bulk scans across docs, tag renames, anything touching >5 blocks, scripted pipelines (pipe to jq, grep), cases where MCP's rate limits bite, anything you want to repeat via shell history.
- **Use the configured Craft MCP server**: single interactive read of a known block, when the CLI isn't installed, quick one-off edits.
- **Both are safe**: they hit the same API. The CLI is just faster and more scriptable.

## Setup check

```sh
command -v craft >/dev/null && craft whoami
```

If `command -v craft` fails, install or register the CLI for the current harness before configuring it. If the binary exists but `craft whoami` fails, configure a connection with `craft setup --name <PROFILE> --url <URL> --key <KEY>`. A public remote skill library can use `craft lib ... --url <URL>` without setup. Do not assume a default profile, space, or collection on another setup.

Env overrides: `CRAFT_URL`, `CRAFT_KEY`, `CRAFT_PROFILE`, `CRAFT_SOURCE` (see Source section), legacy `CRAFT_MODE`, `CRAFT_LOCAL_PATH`, `CRAFT_LOCAL_TIMEOUT_MS`.

## Command cheatsheet

```sh
# identity / profiles / source
craft doctor --json                    # auth/API/local/source health check
craft agent-context                    # stable JSON manifest for agents
craft which backlinks                  # map capability words to commands
craft whoami
craft profiles list
craft source                           # show current read source (auto | api | local)
craft source api                       # persist api-only (Linux, headless, no Craft app)
craft source auto                      # persist auto (local if present, API fallback)
craft source local                     # require local for eligible list/search reads
craft mode api                         # legacy alias for source api
craft mode hybrid                      # legacy alias for source auto

# folders (tree is default)
craft folders ls
craft folders mk "New Project" --parent <folderId>
craft folders rm <id>

# documents
craft docs ls [--location unsorted|trash|templates|daily_notes] [--folder ID]
craft docs search "regex" [--folder ID] [--include] [--fetch-blocks]
craft read <id>                       # markdown, local-first; alias for docs get
craft read <id> --outline             # headings with original line numbers
craft read <id> --lines 20:60          # inclusive 1-based range
craft read <id> --head 30 --budget 4000 # bound output (Unicode characters)
craft cat <id1> <id2> --budget 8000    # one total budget across both documents
craft docs get <id>                   # compatible document read command
craft docs get <id> --raw             # keeps <page>/<content> wrappers
craft docs get <id> --json            # structured block tree with ids (API)
craft docs get <id> --depth 1         # only direct children
craft docs get <id> --links           # also fetch backlinks (API call)
craft docs get <id> --exhaustive      # use full-vault scan for backlinks (slow, catches more)
craft docs daily [DATE]               # DATE = today|yesterday|tomorrow|YYYY-MM-DD (local-first)
craft docs mk "Title" --folder <id>
craft docs mv <id> --to <folderId|unsorted|templates>
craft docs rm <id>                    # soft-delete → trash
craft docs open <id>                  # prints + opens craftdocs:// deeplink

# blocks
craft blocks get <id> [--depth N]
craft blocks search <docId> "regex" [--before 2 --after 2 --fetch]
craft blocks append <docId> --markdown "text"
craft blocks append --date today --markdown "daily note line"
echo "## piped content" | craft blocks append <docId> -
craft blocks insert <docId> --file blocks.json   # typed blocks JSON; r.craft.do URLs must be fresh (signed URLs rotate)
craft blocks update <blockId> --markdown "new text"
craft blocks mv <blockId>... --to <pageId>
craft blocks rm <blockId>...

# tasks
craft tasks                              # all tasks across the space (same as `tasks ls all`)
craft tasks ls [all|inbox|active|upcoming|logbook]
craft tasks ls document --doc <id>       # server-side document scope
craft tasks ls --state todo --document "Project" --deadline-to tomorrow
craft tasks ls --doc <id> --scheduled none --reminder no --json
craft tasks ls --date today --location daily --text "report" --limit 20
craft tasks ls --repeat yes --notification yes
craft tasks add "buy milk" --to inbox
craft tasks add "review doc" --to daily --date today --schedule tomorrow
craft tasks update <id> --state done
craft tasks update <id> --schedule none --deadline tomorrow --to doc --doc <id>
craft tasks rm <id>

# collections
craft col ls [--doc ID]
craft col schema <collectionId>       # defaults to json-schema-items (shows keys + enums)
craft col items <collectionId> [--status S] [--forai yes|no] [--byai yes|no] [--assignee TAG] \
  [--prop k=v]... [--text Q] [--limit N] [--flat] [--preview] [--json [--select F]]
# list: clean table by default (no contentPreviewMd). --json also strips previews
# unless --preview. --flat lifts properties to top-level for easy --select.
# --forai/--byai filter assignee multiSelect tags forAI/byAI; --assignee matches one tag (pa1ar).
# filters are client-side today (fetch all, filter locally). Local-DB cache TBD.
#
# business execution (use the collection configured for this setup):
#   COL=<collectionId>
#   craft col items $COL --status Todo --forai yes --flat --json --select title,1d,priority,tldr
#   Handles: property key `1d` = `1SS-n`. Relations need --preview to display cleanly.
craft col items add <id> --file items.json
craft col items update <id> --file updates.json
craft col items rm <colId> <itemId>...
craft col views <collectionId>
craft col views create <collectionId> --file view.json
craft col views update <collectionId> <viewId> --file view.json
craft col views active <collectionId> <viewId>
craft col views rm <collectionId> <viewId>
# items payload uses `title` for both reads and writes (NOT `name`). properties
# reference the schema's auto-generated keys (e.g. "Due Date" -> `dueDate`) -
# fetch `col schema` first to discover keys. null values on optional props are
# passed through verbatim; strip them in your script if the API rejects them.
# collection views are stored configuration only. they can define table/gallery/
# kanban layouts, filters, sorts, grouping, hidden fields, field order, column
# widths, calculations, and the active view, but `col views` does not execute the
# filters/sorts/groups or return filtered rows. use `col items` for item data.
# kanban views require exactly one groupBy rule. On create, use groupBy[].property
# (key/name string); reads return propertyKey/propertyId.

# links (outgoing + backlinks)
craft links out <blockId>             # outgoing: parsed from fetched markdown, zero extra API calls
craft links in  <blockId>             # backlinks: title-based vault search + local block:// filter (~1 call)
craft links in  <blockId> --text "custom label"   # when the link text isn't the target's title
craft links in  <blockId> --exhaustive            # full-vault scan (slow, ~2-3 min for 1000+ docs)

# patch — find and replace in blocks (like Edit tool for Craft)
craft patch <docId> --old "existing text" --new "replacement text"
craft patch <docId> --old "text" --new "text" --dry-run  # preview without writing
echo "old text\n---\nnew text" | craft patch <docId>     # pipe via stdin

# cat — read multiple docs at once
craft cat <id1> <id2> <id3>           # parallel fetch, --- separators

# diff — compare current state to last CLI edit
craft diff <docId|blockId>            # shows changes since last mutation

# undo — revert last CLI mutation
craft undo [docId]                    # restore pre-mutation state
craft undo --dry-run                  # preview what would be restored
craft undo --force                    # override "modified since" check

# log — mutation history
craft log [docId]                     # recent mutations
craft log --last 5                    # limit entries
craft log --since 2026-04-01          # date filter

# misc
craft upload photo.png --parent <docId>
craft comment <blockId> "nice point #by/ai"
craft wb mk --parent <docId>
craft wb el add <wbId> --file elements.json

# skills — demand-loaded automations
craft skills ls
craft skills search media
craft skills show media-analyze
craft skills validate media-analyze
craft skills run media-analyze analyze <blockId> --estimate

# curated media alias
craft media local <blockId>
craft media local <blockId> --all --json
craft media analyze <blockId>
craft media analyze <blockId> --estimate
craft media analyze <blockId> --max-cost 0.50 --json
craft media replace <blockId> edited.mov --content-type video/quicktime

# escape hatch for any endpoint the CLI doesn't cover yet
craft raw GET /connection
craft raw POST /blocks --body payload.json
```

Global flags on every command: `--json` (machine output), `--select id,title` (project JSON fields), `--profile NAME`, `--quiet`, `--source auto|api|local`, `--api` (legacy shortcut for `--source api`), `--dry-run` on write commands.

## Skills

For a remote Craft skill collection, configure or receive an explicit connection and collection ID. Use `craft lib list --collection ID --profile NAME --json`, match the task against validated `name`/`description` metadata, then fetch only the selected item with `craft lib get <name|itemId> --collection ID --profile NAME`. These reads always use the API and strip catalog body previews. Normal discovery requires `kind=skill`, `status=published`, a stable `name`, and a nonempty `description`; do not automatically include drafts or legacy rows. `craft lib export <name> --collection ID --profile NAME --out DIR` writes a new single-file skill directory without overwriting existing skills. For profile-based commands, `CRAFT_URL` plus `CRAFT_KEY` overrides `--profile`; public `--url` is unauthenticated and bypasses setup. Register the complete bundled `skill/` folder, including `references/`, in the user's declared canonical skill location first, otherwise the target harness's supported user-skill location. This command does not install or execute skills and does not claim universal harness compatibility. See [remote library contract](references/skill-library.md) for the exact collection schema, authoring workflow, migration switches, export limits, and loader guidance.

Author item bodies without frontmatter. The exporter generates `name` and `description` frontmatter from validated properties. Prepare collection rows with `craft col schema ID --format json-schema-items`, add them as `{ "title": string, "properties": { ... } }`, keep new rows `status: "draft"`, review with `craft lib list --include-drafts`, and publish with `craft col items update` only after review. The detailed portable examples and rejection semantics are in the linked contract.

`craft skills` discovers bundled repo skills and explicit local skills from `~/.craft-cli/skills`. V1 has no remote/community install flow. Search is manifest keyword search over name, description, tags, and command descriptions.

Skill runtime contract:

- skills execute as subprocesses with structured JSON stdin/stdout.
- `craft-cli` fetches Craft context for commands that declare a source block.
- skill code may propose writes, but `craft-cli` performs Craft writes and journal records.
- default max cost is EUR 1 unless `--max-cost` is passed.
- `--estimate` returns the manifest estimate without running expensive work.

Local media and bundled analysis:

```sh
craft media local <blockId>
craft media analyze <blockId>
craft media replace <blockId> <file>
```

`media local` resolves an existing full on-device asset through Craft's `OnDeviceAssets/index.json`, falling back to a preview only when necessary. Treat the returned path as read-only and copy it before editing. `media analyze` prefers that local file, falls back to the fresh signed URL, uses OpenAI for generic analysis/transcription, and writes a Craft-visible run block under the source block. `media replace` uploads before the old block, verifies the same media type, then deletes the old block; the replacement has a new block ID and blocks with children or comments are refused. Analysis requires `OPENAI_API_KEY`; video/audio extraction needs `ffmpeg`/`ffprobe`.

`craft doctor` and `craft whoami` use short health-check retries/timeouts. If Craft's `/connection` endpoint stalls, they should fail quickly with a clear timeout instead of hanging through normal API retry windows.

## Read source: auto vs api vs local

On Mac with Craft app installed, the CLI reads from Craft's local data first: the SQLite FTS5 index for `docs ls` and `docs search` , and the PlainTextSearch cache for full markdown in `docs get`, `docs daily`, `blocks get`, and `cat` . All writes always go through the API.

**Local-first markdown reads.** `docs get`, `docs daily`, `blocks get`, and `cat` serve markdown from the local Craft Desktop cache when it has the document, and fall back to the API when it is missing. Each read prints `(local)` or `(api)` to stderr; stdout stays clean for piping. `craft cat` prints one summary line such as `3 documents (local)`.

Local reads are also better behaved than the API on cross-space links: the cache renders `craftdocs://open?...` deeplinks where the API returns `invalid:out_of_scope`.

These stay on the API by design:

- `--json` — needs real block ids for surgical edits
- `--depth N` — block-tree depth is an API semantic
- `--metadata`
- `--raw` — preserves the API transport wrapper
- `--links` / `--exhaustive` — backlinks are a faked title search on Craft's side

`--source api` forces reads through the API. For Markdown content commands, `--source local` never calls the API: it rejects missing content and API-only flags. Backlinks via `--links` or `--exhaustive` need `auto` or `api`.

**Read-after-write.** Craft Desktop owns cache synchronization. Ordinary `auto` and `local` reads use its available content, including briefly older content while Desktop syncs after a write. Use `--source api` for immediate remote confirmation. The CLI neither modifies Desktop cache files nor maintains a second content cache.

**Bounded reads.** `read`, `docs get/daily`, `blocks get`, and `cat` accept `--lines A:B` (inclusive, 1-based), `--head N`, `--outline` (ATX headings with original line numbers, excluding fenced code), and `--budget N` (Unicode characters, minimum 11). Choose one of lines/head/outline; budget may be combined with any of them. Budget includes output separators and backlinks, and truncation ends with `[truncated]`. Shaping cannot be combined with `--json` or `--raw`. Ranges refer to the selected source's Markdown; local/API formatting may differ. Shaping bounds agent output, not the server response size.

**Three sources:**

- **auto** (default): try local first with a bounded helper-process probe; fall back to API. Use on Mac with Craft installed.
- **api**: never touch local, every read hits the API. Use on Linux, Docker containers, or any host where Craft is not installed. Slower reads but identical behavior; journal (undo/log/diff) keeps working.
- **local**: require the local store for local-capable listing/search commands. API-required commands still use REST. Use this source for debugging local cache behavior.

Local-capable commands include unfiltered `docs ls`, simple `docs search`, cached Markdown reads, and `media local`. Structured document trees, tasks, collections, filtered searches, and writes use REST. Keep `auto` so the CLI makes that routing decision instead of forcing every read over the network.

**How to set it (agent workflow):**

```sh
craft source              # check current source; emits a status block to relay to the user
craft source api          # persist api-only in config.json; survives shell restarts
craft source auto         # persist local-first with API fallback
craft source local        # require local for eligible list/search reads
craft source --json       # machine-readable status for scripting
```

`craft source api` prints a status block the agent should relay to the user — it confirms the persisted state, tells the user journal still works, and shows how to temporarily flip the source.

**Precedence (highest wins):**
1. Per-command `--source auto|api|local`
2. Per-command `--api` shortcut for `--source api`
3. `CRAFT_SOURCE=auto|api|local` env var
4. legacy `CRAFT_MODE=api|hybrid` env var (`hybrid` maps to `auto`)
5. persisted `config.source` set via `craft source <source>`
6. legacy `config.mode`
7. `auto` default when nothing is configured

**When to run `craft source api`:**
- Linux hosts, Docker containers, any headless box without the Craft desktop app
- Mac machines where the Craft app is installed but not running / not syncing (prevents stale local reads)
- CI / scripted environments where you want deterministic API-only behavior

The journal at `~/.cache/craft-cli/journal.db` is cross-platform and always on — `undo`, `log`, and `diff` work with every source.

Hybrid local reads are bounded by `CRAFT_LOCAL_TIMEOUT_MS` (default 1500ms). If local discovery/list/search times out or errors, read commands fall back to the API without printing local document content to logs.

## Current Craft API coverage

The 2026-09-04 API alignment includes collection-view CRUD and active-view selection, space-wide tasks through documented `scope=all`, page styling and separator fields, typed media upload/insert, local media resolution, and safe media replacement. Use `craft raw` for a newly published endpoint before a dedicated wrapper exists.

Craft app 3.6 features such as editable inline tags, arbitrary custom colors, and Daily Notes range export do not currently have documented REST operations. Do not imply CLI support for an app-only feature.

## Top recipes

### 1. Fetch a specific doc by title

```sh
id=$(craft docs search "^LTM$" --source api --json | jq -r '.items[0].documentId')
craft docs get "$id"
```

Exact regular-expression matching is an API query. For a fuzzy phrase match, use `--include` mode:

```sh
craft docs search "LTM" --include --json | jq -r '.items[].documentId'
```

### 2. Read today's daily note

```sh
craft docs daily
```

With structured content: `craft docs daily --json --depth 1`

### 3. Append to today's daily note

```sh
craft blocks append --date today --markdown "15:42 #by/ai idea: …"
```

### 4. Rename a tag across the entire vault

```sh
# find every block containing the old tag
craft docs search '#type/idea' --fetch-blocks --json |
  jq -r '.items[].blocks[] | select(.markdown | contains("#type/idea")) | .id' |
  while read -r blockId; do
    old=$(craft blocks get "$blockId" --json | jq -r '.markdown')
    new=${old//#type\/idea/#idea}
    craft blocks update "$blockId" --markdown "$new"
  done
```

Or reuse the legacy `rename-tag.ts` script if it is present in the source checkout.

### 5. Explore tasks across the space

```sh
craft tasks --state todo --json | jq '.items[] | {id, state: .taskInfo.state, location, task: .markdown}'
craft tasks ls --document "Project" --deadline-to tomorrow --reminder yes --json
```

Task list filters compose locally after one API call:

- content/location: `--text TEXT`, `--doc ID`, `--document TITLE`, `--location inbox|document|daily`
- state/date: `--state todo|done|canceled`, `--date`, `--date-from`, `--date-to`, `--scheduled`, `--scheduled-from`, `--scheduled-to`, `--deadline`, `--deadline-from`, `--deadline-to`, `--overdue`
- task configuration: `--repeat yes|no`, `--reminder yes|no` (`--notification` alias), `--priority VALUE`, `--limit N`
- dates accept `YYYY-MM-DD`, `today`, `yesterday`, or `tomorrow`; `--scheduled none` and `--deadline none` select tasks without those dates
- Craft currently defines practical priority through schedules and deadlines and does not expose a native task-priority field. `--priority` is forward-compatible for API payloads that include one; `--priority none` selects tasks without one.

### 6. Add a task without leaving the terminal

```sh
craft tasks add "call the accountant about VAT" --to inbox
```

### 7. Bulk scan + extract via jq pipeline

```sh
craft docs search "#ref" --fetch-blocks --json |
  jq -r '.items[] | .markdown'
```

### 8. Find all backlinks to a document

```sh
# fast path — one search call, works when the link text is the target's title
craft links in <blockId>

# when link text is customized
craft links in <blockId> --text "the phrase used in the link"

# when you suspect the fast path missed references (rare — use sparingly)
craft links in <blockId> --exhaustive
```

### 9. Get a deeplink to open in the Craft app

```sh
craft docs open <id>
# or just
craft docs search "query" --json | jq -r '.items[0].documentId' | xargs craft docs open
```

### 10. Surgical edit (patch) — the Edit tool for Craft

```sh
craft patch <docId> --old "misspelled wrods" --new "misspelled words"
```

Finds the exact block containing the old text, replaces it, journals the change. Like Claude Code's Edit tool but for Craft blocks.

### 11. Review what changed since your last edit

```sh
craft diff <docId>
```

### 12. Oops, undo that

```sh
craft undo                  # undo most recent mutation
craft undo <docId>          # undo most recent for that doc
craft undo --dry-run        # see what would happen first
```

### 13. Read multiple docs at once

```sh
craft cat <id1> <id2> <id3>
```

## Caveats (from real trials — see the source checkout's trial `CAVEATS.md` when available)

1. **`docs search` defaults to `regexps` mode.** The API's `include` mode silently misses tokens with underscores. Use `--include` only for phrase/word matching, stick with the default for anything else.
2. **Regex is RE2.** Escape backslashes for the shell: `craft docs search 'tag_\w+'`.
3. **`docs get` strips the `<page>/<pageTitle>/<content>` wrapper by default.** Pass `--raw` if you need the original, or `--json` for structured blocks. Raw reads use the API; normal local reads add the document title and preserve body whitespace.
4. **The CLI refuses to insert blocks without an explicit target.** The API silently routes `position: end` with no pageId/date to today's daily note — a footgun. The CLI throws before sending.
5. **`maxDepth: 0` omits the `content` key entirely** (not an empty array). Use `"content" in obj` checks when parsing.
6. **Error exit codes**: 0 ok, 1 user error, 2 API error, 3 auth, 4 not found. Script accordingly.
7. **Large list latency**: `craft docs ls` with no filter takes ~3.4s via API. In `source auto` on a Mac with Craft installed, it's instant (~27ms). On Linux / headless hosts, run `craft source api` once after setup to skip local discovery entirely, or pass `--source api`/`--api` per-command, or set `CRAFT_SOURCE=api` in the environment.
8. **Rate limits**: 50 requests per 10 seconds per public IP, 100 requests per 60 seconds per Craft space, and 20,000 blocks read/written per 60 seconds per space. Respect `Retry-After`; space and block budgets may appear in `X-RateLimit-*` and `X-BlockBudget-*` headers.
9. **Tasks & collections have inconsistent payload keys** (`tasks` vs `tasksToUpdate` vs `idsToDelete`). The CLI abstracts this — you don't need to care unless you use `craft raw`. The current task API documents `scope=all`; `craft tasks` uses it by default so unscheduled document tasks are not lost.
10. **Partial block updates preserve children.** `craft blocks update <id> --markdown "new"` renames without dropping the sub-tree.
11. **Daily note auto-creates** when you append with `--date today` and no note exists yet.
12. **When the user's Craft conventions call for AI attribution, use the harness-neutral `#by/ai` tag.** User instructions to preserve source content exactly or omit attribution take precedence.
13. **Links & backlinks**:
    - **Outgoing links are free** — every `[text](block://UUID)` reference is already in the block's markdown after a normal fetch. `craft links out` just parses it.
    - **Incoming links (backlinks) are NOT natively supported.** Craft's search index strips `block://UUID` URIs — searching for a raw UUID returns zero hits. The CLI uses Pavel's trick: the visible anchor text of a link IS indexed, and Craft's default link text is the target's title, so `docs/search` for the title followed by a local `block://<id>` filter finds backlinks in one API call. Set `--text` when authors use custom labels. Fall back to `--exhaustive` only when the fast path looks suspiciously empty.
    - **Backlinks are opt-in via `--links`.** They always need an API round trip, so reads do not fetch them by default. With `--links`, markdown mode appends a `## Backlinks` section and JSON mode adds a top-level `backlinks` array. `--no-links` is still accepted and is now a no-op.
14. **`clickableLink` lives at `metadata.clickableLink`** on GET /blocks responses when `fetchMetadata=true`, and at the top level on list/create responses.
15. **Search freshness lag**: newly created child pages may appear in parent reads (`docs get <parentId> --depth N`) before they show up in `docs search`. If search misses something recent, fetch the parent with depth as a fallback: `craft docs get <parentId> --depth 2` or `craft docs daily --depth 2`.
16. **Typed block insert fidelity**: `craft blocks insert --file blocks.json` accepts every native block variant (`text`, `page`, `richUrl`, `video`, `image`, `file`, `line`, `code`, `table`) with its native fields (`url`, `title`, `description`, `listStyle`, `textStyle`, `color`, `decorations`, nested `content`, etc.). Use this — not `blocks append --markdown` — when copying blocks between docs, because `append` goes through markdown parsing and loses native types (video/richUrl/image collapse to text).
17. **r.craft.do URLs are signed and time-limited** — they rotate on each `GET /blocks` fetch. When cloning `video`/`image`/`file` blocks between docs, always fetch the source LIVE right before inserting and pass the fresh URL; omit `uploaded` so the API re-fetches and re-signs. If you pass a stale URL with `uploaded: true`, the block will be created but the asset will display "not available" when the signature expires. `normalizeCraftMediaBlocks` is available as an opt-in helper for the rare case where you want to force-store an as-is URL.
18. **Media replacement creates a new block ID.** The REST API can update media layout/metadata but not its asset URL. `craft media replace` therefore uploads before the old block, verifies the replacement, and deletes the old block only after verification. Direct links to the old block do not migrate.
19. **Local-first reads depend on the Craft app syncing.** Craft Desktop updates its local stores about one second after an API write while the app is running. If the app is closed or not syncing, local reads can be stale and a freshly written block may be missing. Use `--source api` for a guaranteed-current read, and note that the local mirror covers roughly 98 percent of documents in a space, so a miss falls through to the API on its own.

## Library usage (Raycast / Node scripts)

```ts
import { CraftClient } from "@1ar/craft-cli/lib";

const c = new CraftClient({ url: process.env.CRAFT_URL!, key: process.env.CRAFT_KEY! });
const hits = await c.documents.search({ regexps: "LTM|memory" });
const fullDoc = await c.blocks.get(hits.items[0]!.documentId, { format: "markdown" });
```

## Files

- CLI source and compiled binary: use the checkout and install path for this setup (`command -v craft` locates the active binary).
- Config: the CLI's per-user config file (created by `craft setup` with restrictive permissions).
- API docs, OpenAPI spec, and trial caveats: consult the source checkout or the upstream Craft documentation available to this setup.
- Rebuild: run `bun run build` from the source checkout.
- Tests: `bun test` (unit), `bun test tests/integration` (gated on `CRAFT_URL` + `CRAFT_KEY`).
