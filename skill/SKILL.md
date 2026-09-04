---
name: craft-cli
description: Fast CLI wrapper over the Craft Docs "API for All Docs" for reading, searching, and editing Pavel's Craft vault from the shell. Triggers when the user mentions craft docs, the PKM vault, LTM, daily notes, searching or editing craft content, or says "c:" / "in craft". Prefer this CLI over the Craft MCP server for bulk scans, multi-doc edits, scripting, or anything repetitive. Use the MCP server for small interactive one-offs when the CLI is absent.
---

# craft-cli — Craft Docs from the shell

`craft` is a compiled Bun binary at `~/.local/bin/craft`. Source: `~/dev/tools/craft-cli/`. Library exports at `@1ar/craft-cli/lib` for Raycast/Node reuse.

## When to use this vs the Craft MCP server

- **Use `craft` CLI**: bulk scans across docs, tag renames, anything touching >5 blocks, scripted pipelines (pipe to jq, grep), cases where MCP's rate limits bite, anything you want to repeat via shell history.
- **Use Craft MCP (`mcp__claude_ai_Craft__*`)**: single interactive read of a known block, when the CLI isn't installed, quick one-off edits.
- **Both are safe**: they hit the same API. The CLI is just faster and more scriptable.

## Setup check

```sh
command -v craft >/dev/null && craft whoami
```

If that fails → `craft setup --url <URL> --key <KEY>`. Credentials live at `~/.config/craft-cli/config.json` (0600). Main profile is already configured for the 1ar space.

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
craft source local                     # force local-only; fail if unavailable
craft mode api                         # legacy alias for source api
craft mode hybrid                      # legacy alias for source auto

# folders (tree is default)
craft folders ls
craft folders mk "New Project" --parent <folderId>
craft folders rm <id>

# documents
craft docs ls [--location unsorted|trash|templates|daily_notes] [--folder ID]
craft docs search "regex" [--folder ID] [--include] [--fetch-blocks]
craft docs get <id>                   # renders stripped markdown + appends "## Backlinks" section
craft docs get <id> --raw             # keeps <page>/<content> wrappers
craft docs get <id> --json            # structured, adds `backlinks: [...]` at top level
craft docs get <id> --depth 1         # only direct children
craft docs get <id> --no-links        # skip backlink fetch (saves ~1-2s per call)
craft docs get <id> --exhaustive      # use full-vault scan for backlinks (slow, catches more)
craft docs daily [DATE]               # DATE = today|yesterday|tomorrow|YYYY-MM-DD, also shows backlinks
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
craft col items <collectionId>
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
# kanban views require exactly one groupBy rule.

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

On Mac with Craft app installed, the CLI reads from Craft's local SQLite FTS5 database for `docs ls` and `docs search` (1700x faster than API). All writes always go through the API.

**Three sources:**

- **auto** (default): try local first with a bounded helper-process probe; fall back to API. Use on Mac with Craft installed.
- **api**: never touch local, every read hits the API. Use on Linux, Docker containers, or any host where Craft is not installed. Slower reads but identical behavior; journal (undo/log/diff) keeps working.
- **local**: local-only. Fails clearly if Craft Desktop data is unavailable or the query needs API-only filters. Use for debugging local cache behavior.

**How to set it (agent workflow):**

```sh
craft source              # check current source; emits a status block to relay to the user
craft source api          # persist api-only in config.json; survives shell restarts
craft source auto         # persist local-first with API fallback
craft source local        # persist local-only
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

## Top recipes

### 1. Fetch a specific doc by title

```sh
id=$(craft docs search "^LTM$" --json | jq -r '.items[0].documentId')
craft docs get "$id"
```

Or for a fuzzy title → use `--include` mode (case-insensitive phrase match):

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

Or reuse the old `rename-tag.ts` (it's still in `~/dev/craft-docs/craft-do-api/`).

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

## Caveats (from real trials — see `~/dev/craft-docs/craft-do-api/trials/CAVEATS.md`)

1. **`docs search` defaults to `regexps` mode.** The API's `include` mode silently misses tokens with underscores. Use `--include` only for phrase/word matching, stick with the default for anything else.
2. **Regex is RE2.** Escape backslashes for the shell: `craft docs search 'tag_\w+'`.
3. **`docs get` strips the `<page>/<pageTitle>/<content>` wrapper by default.** Pass `--raw` if you need the original, or `--json` for structured blocks.
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
    - **`docs get` / `blocks get` / `docs daily` include backlinks by default.** In markdown mode they append a `## Backlinks` section; in JSON mode they add a top-level `backlinks` array. Pass `--no-links` to skip when you only need content and want to save ~1-2s.
14. **`clickableLink` lives at `metadata.clickableLink`** on GET /blocks responses when `fetchMetadata=true`, and at the top level on list/create responses.
15. **Search freshness lag**: newly created child pages may appear in parent reads (`docs get <parentId> --depth N`) before they show up in `docs search`. If search misses something recent, fetch the parent with depth as a fallback: `craft docs get <parentId> --depth 2` or `craft docs daily --depth 2`.
16. **Typed block insert fidelity**: `craft blocks insert --file blocks.json` accepts every native block variant (`text`, `page`, `richUrl`, `video`, `image`, `file`, `line`, `code`, `table`) with its native fields (`url`, `title`, `description`, `listStyle`, `textStyle`, `color`, `decorations`, nested `content`, etc.). Use this — not `blocks append --markdown` — when copying blocks between docs, because `append` goes through markdown parsing and loses native types (video/richUrl/image collapse to text).
17. **r.craft.do URLs are signed and time-limited** — they rotate on each `GET /blocks` fetch. When cloning `video`/`image`/`file` blocks between docs, always fetch the source LIVE right before inserting and pass the fresh URL; omit `uploaded` so the API re-fetches and re-signs. If you pass a stale URL with `uploaded: true`, the block will be created but the asset will display "not available" when the signature expires. `normalizeCraftMediaBlocks` is available as an opt-in helper for the rare case where you want to force-store an as-is URL.
18. **Media replacement creates a new block ID.** The REST API can update media layout/metadata but not its asset URL. `craft media replace` therefore uploads before the old block, verifies the replacement, and deletes the old block only after verification. Direct links to the old block do not migrate.

## Library usage (Raycast / Node scripts)

```ts
import { CraftClient } from "@1ar/craft-cli/lib";

const c = new CraftClient({ url: process.env.CRAFT_URL!, key: process.env.CRAFT_KEY! });
const hits = await c.documents.search({ regexps: "LTM|memory" });
const fullDoc = await c.blocks.get(hits.items[0]!.documentId, { format: "markdown" });
```

## Files

- CLI source: `~/dev/tools/craft-cli/`
- Compiled binary: `~/dev/tools/craft-cli/dist/craft` → symlinked to `~/.local/bin/craft`
- Config: `~/.config/craft-cli/config.json` (mode 0600)
- API docs: `~/dev/craft-docs/craft-do-api/craft-do-api-docs.md`
- OpenAPI spec: `~/dev/craft-docs/craft-do-api/craft-do-openapi.json`
- Trial fixtures + caveats: `~/dev/craft-docs/craft-do-api/trials/`
- Rebuild: `cd ~/dev/tools/craft-cli && bun run build`
- Tests: `bun test` (unit), `bun test tests/integration` (gated on CRAFT_URL+CRAFT_KEY)
