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

Env overrides: `CRAFT_URL`, `CRAFT_KEY`, `CRAFT_PROFILE`, `CRAFT_MODE` (see Mode section), `CRAFT_LOCAL_PATH`.

## Command cheatsheet

```sh
# identity / profiles / mode
craft whoami
craft profiles list
craft mode                            # show current read mode (hybrid | api) + source
craft mode api                        # persist api-only (Linux, headless, no Craft app)
craft mode hybrid                     # persist hybrid (Mac with Craft)

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
craft blocks insert <docId> --file blocks.json
craft blocks update <blockId> --markdown "new text"
craft blocks mv <blockId>... --to <pageId>
craft blocks rm <blockId>...

# tasks
craft tasks ls inbox | active | upcoming | logbook
craft tasks ls document --doc <id>
craft tasks add "buy milk" --to inbox
craft tasks add "review doc" --to daily --date today --schedule tomorrow
craft tasks update <id> --state done
craft tasks rm <id>

# collections
craft col ls [--doc ID]
craft col schema <collectionId>       # defaults to json-schema-items (shows keys + enums)
craft col items <collectionId>
craft col items add <id> --file items.json
craft col items update <id> --file updates.json
craft col items rm <colId> <itemId>...

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
craft comment <blockId> "nice point #by/claude"
craft wb mk --parent <docId>
craft wb el add <wbId> --file elements.json

# escape hatch for any endpoint the CLI doesn't cover yet
craft raw GET /connection
craft raw POST /blocks --body payload.json
```

Global flags on every command: `--json` (machine output), `--profile NAME`, `--quiet`, `--api` (force API-only for this command, overrides mode).

## Read mode: hybrid vs api-only

On Mac with Craft app installed, the CLI reads from Craft's local SQLite FTS5 database for `docs ls` and `docs search` (1700x faster than API). All writes always go through the API.

**Two modes:**

- **hybrid** (default): try local first, API fallback. Use on Mac with the Craft app running.
- **api**: never touch local, every read hits the API. Use on Linux, Docker containers, or any host where Craft is not installed. Slower reads but identical behavior; journal (undo/log/diff) keeps working.

**How to set it (agent workflow):**

```sh
craft mode                # check current mode + source; emits a status block to relay to the user
craft mode api            # persist api-only in config.json; survives shell restarts
craft mode hybrid         # persist hybrid
craft mode --json         # machine-readable status for scripting
```

`craft mode api` prints a status block the agent should relay to the user — it confirms the persisted state, tells the user journal still works, and shows how to temporarily flip the mode.

**Precedence (highest wins):**
1. Per-command `--api` flag (hardest override, one-shot)
2. `CRAFT_MODE=api|hybrid` env var (runtime override, one invocation)
3. Persisted `config.mode` set via `craft mode <mode>`
4. `hybrid` default when nothing is configured

**When to run `craft mode api`:**
- Linux hosts, Docker containers, any headless box without the Craft desktop app
- Mac machines where the Craft app is installed but not running / not syncing (prevents stale local reads)
- CI / scripted environments where you want deterministic API-only behavior

The journal at `~/.cache/craft-cli/journal.db` is cross-platform and always on — `undo`, `log`, and `diff` work in both modes.

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
craft blocks append --date today --markdown "15:42 #by/claude idea: …"
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

### 5. Dump the task inbox

```sh
craft tasks ls inbox --json | jq '.items[] | {id, state: .taskInfo.state, task: .markdown}'
```

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
7. **Large list latency**: `craft docs ls` with no filter takes ~3.4s via API. In hybrid mode (Mac with Craft installed), it's instant (~27ms). On Linux / headless hosts, run `craft mode api` once after setup to skip local discovery entirely, or pass `--api` per-command, or set `CRAFT_MODE=api` in the environment.
8. **Rate limits**: generous. 60 parallel calls tested without 429. Default concurrency in scan pipelines can be 15+.
9. **Tasks & collections have inconsistent payload keys** (`tasks` vs `tasksToUpdate` vs `idsToDelete`). The CLI abstracts this — you don't need to care unless you use `craft raw`.
10. **Partial block updates preserve children.** `craft blocks update <id> --markdown "new"` renames without dropping the sub-tree.
11. **Daily note auto-creates** when you append with `--date today` and no note exists yet.
12. **Always tag AI-generated content with `#by/claude`** in the markdown (Pavel's global rule, see `~/.claude/CLAUDE.md`).
13. **Links & backlinks**:
    - **Outgoing links are free** — every `[text](block://UUID)` reference is already in the block's markdown after a normal fetch. `craft links out` just parses it.
    - **Incoming links (backlinks) are NOT natively supported.** Craft's search index strips `block://UUID` URIs — searching for a raw UUID returns zero hits. The CLI uses Pavel's trick: the visible anchor text of a link IS indexed, and Craft's default link text is the target's title, so `docs/search` for the title followed by a local `block://<id>` filter finds backlinks in one API call. Set `--text` when authors use custom labels. Fall back to `--exhaustive` only when the fast path looks suspiciously empty.
    - **`docs get` / `blocks get` / `docs daily` include backlinks by default.** In markdown mode they append a `## Backlinks` section; in JSON mode they add a top-level `backlinks` array. Pass `--no-links` to skip when you only need content and want to save ~1-2s.
14. **`clickableLink` lives at `metadata.clickableLink`** on GET /blocks responses when `fetchMetadata=true`, and at the top level on list/create responses.

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
