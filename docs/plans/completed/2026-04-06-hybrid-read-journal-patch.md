# Plan: hybrid read + journal + patch + cat

Research: `docs/retrieval-comparison.md`

3 independent tracks + 1 cross-cutting concern. Tracks can run in parallel except where noted.

---

## Track A: local SQLite read layer

Goal: instant reads from Craft's local FTS5 database, API fallback when unavailable.

### A1. Explore and document Craft's local SQLite schema
```
[x] explore local sqlite schema
notes: docs/local-sqlite-schema.md, docs/local-performance-results.md
```
- open `~/Library/Containers/com.lukilabs.lukiapp/Data/Library/Application Support/com.lukilabs.lukiapp/Search/*.sqlite`
- document all tables, columns, indexes, FTS5 tokenizer config
- check if block content includes full markdown or just plain text
- check if block parent/child relationships are stored (needed for tree reconstruction)
- check if document metadata (title, folder, location, dates) is available
- compare data completeness: what does local DB have vs what API returns?
- output: `docs/local-sqlite-schema.md` with findings + gap analysis

### A2. `src/lib/local-db.ts` - local DB reader module
```
[x] implement local-db.ts
notes: 337 lines, 28 unit tests, CRAFT_LOCAL_PATH env var, validateSchema exported
```
- discover Craft sqlite path: scan `~/Library/Containers/com.lukilabs.lukiapp*/Data/Library/Application Support/*/Search/` for .sqlite files
- support both bundle IDs: `com.lukilabs.lukiapp` (standard) and `com.lukilabs.lukiapp-setapp` (Setapp)
- open read-only (`{ readonly: true }` in bun:sqlite)
- schema validation on open: check expected tables/columns exist, return `null` if mismatch (log warning, never crash)
- expose:
  - `search(query: string): SearchResult[]` - FTS5 MATCH query
  - `getBlock(id: string): LocalBlock | null` - by block ID
  - `listDocs(): LocalDoc[]` - all documents with entityType = 'document'
  - `findBlockByContent(docId: string, text: string): LocalBlock[]` - for patch command
- types: `LocalBlock`, `LocalDoc` - minimal, only what the local DB provides
- important: this module uses `bun:sqlite` which is bun-only. the `src/lib/client.ts` stays pure fetch for Node/Raycast compatibility. local-db is CLI-only
- tests: unit tests with a fixture .sqlite file (copy a small one from Craft's data, anonymize if needed)

### A3. Integrate local DB into CLI commands
```
[x] wire local-db into search and listing commands
notes: docs ls/search use local when no filters, --api flag, lazy client construction, cat command added
```
- `src/cli/local.ts` - singleton that initializes local-db on first use, caches the connection
- add `--api` flag to force API-only mode (bypass local DB)
- commands to integrate:
  - `docs search` - use local FTS5 when available, fall back to API
  - `docs ls` - use local DB for listing when no filters that require API
- log which mode is active when `--quiet` is not set: `(local)` or `(api)` prefix on first output line
- if local DB returns results but user needs full block tree (--depth, --json with nested content), still fetch via API for that doc - local DB is for discovery, API for full content

### A4. Test hybrid mode end-to-end
```
[ ] integration tests for hybrid mode
notes: depends on A3
```
- test: local DB available + search returns results
- test: local DB absent + graceful fallback to API
- test: local DB schema mismatch + fallback
- test: `--api` flag forces API mode
- test: local DB search results match API search results (sanity check)

---

## Track B: journal system

Goal: SQLite-based mutation journal for diff, undo, log.

### B1. `src/lib/journal.ts` - journal database module
```
[x] implement journal.ts
notes: 169 lines, 13 unit tests, WAL mode, ISO timestamp format
```
- create/open `~/.cache/craft-cli/journal.db` using `bun:sqlite`
- auto-create tables on first open:
```sql
CREATE TABLE IF NOT EXISTS mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  op TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  block_ids TEXT NOT NULL,
  pre TEXT,
  post TEXT
);
CREATE INDEX IF NOT EXISTS idx_mutations_doc ON mutations(doc_id, ts);
```
- expose:
  - `record(op, docId, blockIds, pre, post)` - insert mutation
  - `lastMutation(docId): Mutation | null` - most recent for a doc
  - `listMutations(docId?, opts?): Mutation[]` - with --last N, --since DATE
  - `prune(daysToKeep = 7)` - delete old entries
- auto-prune on every `record()` call (cheap: single DELETE with indexed ts)
- pre/post stored as JSON strings (block arrays)
- bun-only module (like local-db)
- tests: unit tests - record, retrieve, prune, empty journal edge cases

### B2. Wire journal into existing write commands
```
[x] add journaling to all mutation commands
notes: blocks append/insert/update/rm/mv + tasks add/update/rm, all try-caught
```
- commands that need journaling:
  - `blocks update` - pre: GET affected blocks before PUT. post: the updated content
  - `blocks append` / `blocks insert` - pre: null (new content). post: returned block IDs + content
  - `blocks rm` - pre: GET blocks before DELETE. post: null
  - `blocks mv` - pre: block positions before move. post: new positions
  - `tasks add/update/rm` - similar pattern
- integration point: in each command handler, wrap the mutation call:
  1. read-before-write (GET affected blocks)
  2. perform mutation (POST/PUT/DELETE)
  3. journal.record(op, docId, blockIds, pre, post)
- keep this lightweight - don't add journal calls inside `src/lib/` (keeps lib pure). add in `src/cli/commands/` handlers only

### B3. `craft diff` command
```
[x] implement diff command
notes: compares current block tree to last journal entry, text + json output
```
- `craft diff <docId>` - compare current state to last journal entry for that doc
- flow:
  1. get last mutation from journal for docId
  2. fetch current block tree (local DB or API)
  3. diff: compare block-by-block (by ID). report: added blocks, removed blocks, changed blocks (show old vs new markdown)
- output format: similar to unified diff but block-oriented
  ```
  ~ blockId  (changed)
  - old content
  + new content
  
  + blockId  (added)
  + new content
  
  - blockId  (removed)
  - old content
  ```
- if no journal entries for doc: "no previous state recorded"
- `--json` flag for machine-readable diff

### B4. `craft undo` command
```
[x] implement undo command
notes: handles update/patch (restore pre), append/insert (delete blocks), warns on delete/move
```
- `craft undo [docId]` - revert last CLI mutation
- flow:
  1. get last mutation from journal
  2. fetch current state of affected blocks (read-before-write)
  3. compare current state to `post` in journal entry
  4. if match: safe to undo. PUT `pre` data back via API
  5. if mismatch: warn "blocks modified since your edit" + show what changed. ask for `--force` to override
  6. if `pre` is null (was an insert): DELETE the inserted blocks
  7. if `post` is null (was a delete): cannot undo deletes (API has no undelete for blocks). warn user
- `--dry-run` flag: show what would be undone without doing it
- after successful undo: record the undo itself as a journal entry (so you can undo the undo)

### B5. `craft log` command
```
[x] implement log command
notes: table or json output, --last N, --since DATE filters
```
- `craft log [docId]` - show mutation history
- `craft log` (no args) - all recent mutations across all docs
- `craft log <docId>` - mutations for specific doc
- flags: `--last N` (default 10), `--since DATE`, `--json`
- output: table format with ts, op, doc_id, block count

---

## Track C: patch + cat

Goal: Edit-tool equivalent for Craft blocks + multi-doc read.

### C1. `craft patch` command
```
[x] implement patch command
notes: --old/--new, stdin (old\n---\nnew), --dry-run, journal pre/post, exit 4 not found / exit 1 ambiguous
```
- `craft patch <docId> --old "text" --new "text"`
- flow:
  1. find block containing --old text:
     - hybrid mode: query local DB `findBlockByContent(docId, oldText)`
     - API mode: GET full block tree, walk blocks, find match
  2. validate: exactly 1 block matches. 0 = exit 4 "not found". 2+ = exit 1 "ambiguous: N blocks match, provide more context"
  3. journal: snapshot matched block (pre)
  4. replace old with new in block's markdown
  5. API PUT to update block
  6. journal: record post state
- multi-line support: `--file` reads old/new from stdin as `---OLD---\n...\n---NEW---\n...` or similar delimiter
- also support pipe: `echo "old\nnew" | craft patch <docId> --from-stdin`
- `--dry-run` flag: show what would change without writing

### C2. `craft cat` command
```
[x] implement cat command
notes: parallel fetch, --- separators, supports --json/--depth/--raw/--no-links
```
- `craft cat <id> [id...]` - read one or more docs, concat output
- parallel fetch via existing `parallel()` helper
- output: markdown with `--- docTitle (id) ---` separators between docs
- supports existing flags: `--json`, `--depth`, `--no-links`, `--raw`
- essentially a thin wrapper: loop over IDs, call `getAndRender()` for each

---

## Track D: cross-cutting - help + skill

### D1. Optimize help output for AI
```
[x] improve help text structure
notes: help updated in main.ts with all new commands, --api flag, CRAFT_LOCAL_PATH
```
- `craft --help` - compact: one line per command, no wrapping. format: `command  description`
- `craft <cmd> --help` - structured: synopsis, flags table, examples, caveats. greppable
- add examples that show common AI workflows (search -> patch, diff -> undo)

### D2. Update craft-cli skill
```
[x] update skill to reflect new commands
notes: added patch/cat/diff/undo/log, hybrid mode section, new recipes, --api flag
```
- update `~/.claude/skills/craft-cli/` with new commands: patch, diff, undo, log, cat
- document hybrid mode: when it's active, what --api does
- add workflow recipes: "review changes" (diff), "surgical edit" (patch), "oops" (undo)

---

## Dependency graph

```
A1 -> A2 -> A3 -> A4
B1 -> B2 -> B3
            B2 -> B4
      B1 -> B5
B1 -> C1
      C2 (independent)
A3 + C1 + C2 -> D1 -> D2
```

Parallel execution:
- A1, B1, C2 can all start simultaneously
- A2 and B5 can run in parallel (A2 waits on A1, B5 waits on B1)
- B2 and A3 can run in parallel once their deps are met
- B3, B4, C1 can run once B2 is done
- D1 and D2 are last

## Build + test after each task

- `bun run build` after every code change
- `bun test` after every code change
- rebuild binary is required for CLI testing (compiled bun binary)

## Resolved questions

- A1: SQLite has plain text only, PlainTextSearch JSON has full markdown. patch uses API block tree for exact matching
- A1: both local stores update within 1 second of API writes (Craft app must be running)
- A1: subpages represented with entityType=page, but no parent-child info in SQLite (flat)
- B4: undo for deletes = warn-only with pre-deletion content shown. re-insert creates new IDs/loses position
- C1: stdin delimiter = `\n---\n` between old and new text
