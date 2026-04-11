# craft-cli

## Update chain

```mermaid
graph LR
    A[Craft API] -->|breaks/changes| B[craft-cli]
    B -->|lib exports| C[Raycast craft extension]
```

- source of truth: Craft's OpenAPI spec at `~/dev/craft-docs/craft-do-api/craft-do-openapi.json`
- craft-cli (`~/dev/tools/craft-cli/`) - wraps raw API, handles caveats
- raycast extension (`~/dev/raycast/craft/`) - imports `@1ar/craft-cli/lib`, never calls API directly
- when Craft changes endpoints: update cli first, then raycast follows

## Module layout

- `src/lib/client.ts` - CraftClient (pure fetch, Node-compatible, used by Raycast). do NOT add bun:sqlite imports here
- `src/lib/local-db.ts` - read-only access to Craft's local SQLite FTS5 + PlainTextSearch JSON. CLI-only (bun:sqlite)
- `src/lib/journal.ts` - mutation journal at `~/.cache/craft-cli/journal.db`. CLI-only (bun:sqlite)
- `src/cli/local.ts` - singleton for local store lifecycle
- `src/cli/journal-singleton.ts` - singleton for journal lifecycle
- `src/cli/commands/` - one file per command group (docs, blocks, tasks, patch, cat, diff, undo, log, etc.)
- `src/lib/index.ts` - public exports for library consumers. must NOT export local-db or journal (bun-only)

## Non-obvious

- compiled bun binary, not ts-node. `bun run build` after changes, binary at `dist/craft`
- hybrid read architecture: `docs ls` and `docs search` read from Craft's local SQLite when available, fall back to API. all writes go through API only
- read mode precedence (highest first): per-command `--api` flag → `CRAFT_MODE` env (`api`|`hybrid`) → `config.mode` in `~/.config/craft-cli/config.json` → `hybrid` default. mode resolved once in `src/cli/main.ts` and applied to the local singleton via `setModeOverride()`. `craft mode [api|hybrid]` persists, `craft mode` (no arg) shows current state + source. journal is cross-platform and stays on in both modes
- local stores update within ~1s of API writes (Craft app must be running)
- dual ID space: API entity IDs != PlainTextSearch internal documentIds. resolve via SQLite: `SELECT documentId FROM BlockSearch WHERE id = ? AND entityType = 'document'`
- local SQLite has plain text only (no markdown). PlainTextSearch JSON has full markdown in `markdownContent`
- `listDocs()` filters out pseudo-docs (block_taskInbox, block_taskLogbook) via UUID regex
- journal auto-prunes entries older than 7 days (~1/20 chance per record call)
- undo selector skips undo entries and already-undone mutations to find the right target
- API caveats tracked at `~/dev/craft-docs/craft-do-api/trials/CAVEATS.md` - read before assuming API behavior
- backlinks: not a real API feature. faked via title-based search + `block://` URI filtering. fragile by design
- `blocks insert` requires explicit target - the API silently routes orphan inserts to daily note, cli rejects that
- search defaults to `regexps` mode (RE2). `include` mode silently drops underscored tokens. local FTS5 uses unicode61 tokenizer
- exit codes: 0 ok, 1 user error, 2 api error, 3 auth, 4 not found
- tests: `bun test` (unit, 79 tests), `bun test tests/integration` (needs CRAFT_URL+CRAFT_KEY)
- env vars: `CRAFT_URL`, `CRAFT_KEY`, `CRAFT_PROFILE` (API config), `CRAFT_LOCAL_PATH` (override local DB discovery), `CRAFT_SPACE_ID` (for experiment scripts)

## Standing rules

- after any CLI surface change (new command, changed flags, new output format): update `skill/SKILL.md` in this repo. that file is the single source of truth and is the AI's primary discovery mechanism - stale skill = broken AI workflows. on dev machines `~/.claude/skills/craft-cli` is a symlink to `skill/` (created by `install.sh`), so editing the repo file propagates automatically
- after any CLI change: rebuild binary (`bun run build`), run tests (`bun test`), typecheck (`bun run typecheck`), verify skill still accurate
- after any install-affecting change (new dependency, build step, binary location, skill layout): re-run `./install.sh` on a clean checkout or read it top-to-bottom to verify it still works end-to-end
- journal calls in command handlers must be try-caught - never prevent the main operation from completing
- local-db and journal are CLI-only modules (bun:sqlite). never import them from src/lib/index.ts or src/lib/client.ts

## Research docs

- `docs/retrieval-comparison.md` - CLI vs API vs MCP vs local MD comparison with tables
- `docs/local-sqlite-schema.md` - Craft's local data store schema (SQLite FTS5, PlainTextSearch JSON, Realm)
- `docs/local-performance-results.md` - benchmarks: local reads 1,700x-6,600x faster than API
- `docs/cli-test-report-2026-04-08.md` - real-world CLI testing report with issues found and fixed
