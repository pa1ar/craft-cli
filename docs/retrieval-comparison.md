# Craft content retrieval & editing: CLI vs API vs MCP vs local MD

Comparison from the perspective of an AI agent (Claude Code) working alongside a user who edits in the Craft app. The CLI is complementary - Craft app is primary, API is source of truth, CLI bridges the gap for AI/automation.

## Comparison table

| Dimension | Local MD (Obsidian) | Raw Craft API | Craft MCP | craft-cli |
|---|---|---|---|---|
| **Read latency** | <1ms (disk) | 150ms-3.4s | 150ms-3.4s + MCP hop | 150ms-3.4s (same API) |
| **Write latency** | <1ms (disk) | 200-800ms | 200-800ms + MCP hop | 200-800ms (same API) |
| **Surgical edit** | open file, find line, edit | GET block id, PUT partial update | blocks_get + blocks_update | `blocks update <id> --markdown` |
| **Find-then-edit** | grep + sed in one pass | 2+ calls: search -> get id -> PUT | 2+ calls: documents_search -> blocks_update | `docs search` + `blocks update` (same 2+ calls) |
| **Full-text search** | instant grep/rg across vault | GET /documents/search (RE2, vault-wide) | documents_search (RE2, paginated, 20/page) | `docs search` (RE2, all results, no pagination) |
| **In-doc search** | grep in file | GET /blocks/search (per-doc) | document_search (per-doc, context lines) | `blocks search <docId> <pattern>` (context lines) |
| **Batch read** | glob + cat, trivially parallel | manual parallel fetches | one call per doc | one call per doc (parallel under the hood for links) |
| **Change detection** | git diff / fs watch | no API support (no timestamps on blocks, no webhooks) | no support | no support |
| **Version history** | git log | none (API has no history) | blocks_revert (single undo, stamp-based) | no revert support |
| **Rich content** | markdown only (no cards, toggles, styled blocks) | full block model (13 types, styles, colors, nesting) | full block model | full block model via --json, markdown for text |
| **Backlinks** | [[wikilinks]], instant grep | not supported natively | not supported | faked via title search + UUID filter (1 call or exhaustive scan) |
| **AI-native interface** | Read/Edit/Grep tools - zero friction | needs HTTP client, error handling, caveat knowledge | tool descriptions embedded, auto-discoverable | CLI output is text/JSON, pipe-friendly |
| **Error handling** | none needed (FS ops) | 5+ error shapes, silent footguns, position trap | MCP server abstracts some, but error messages pass through | normalized errors, position guards, retry on 429/5xx |
| **Offline** | fully offline | no | no | no |
| **Sync to Craft app** | none (separate system) | instant (API = source of truth) | instant | instant |
| **Tasks/collections** | YAML frontmatter or custom syntax | full API (inbox, scheduling, repeats) | full API | full CLI surface |
| **Concurrency safety** | file locks / git merge | no locking, last-write-wins | cursor invalidation (CURSOR_INVALID) | no locking, last-write-wins |
| **Setup cost** | mkdir + git init | auth token + HTTP knowledge + caveat awareness | MCP connection + auth | `craft setup --url --key` (one time) |
| **Context window cost** | file content only | raw JSON (verbose) | JSON (verbose, huge tool schemas) | markdown (compact) or --json when needed |

## Where each approach wins

**Local MD**: read speed, offline, grep, git history, zero-friction AI editing (Read/Edit/Grep tools are instant and native). Gold standard for "AI reviews and edits content".

**Raw API**: maximum flexibility, direct control, no abstraction tax. Good for one-off scripts or when CLI doesn't cover a use case yet.

**Craft MCP**: AI auto-discovery (tool schemas describe themselves), blocks_revert for safety, cursor-based pagination for large docs. Best when the AI is the primary actor and needs to self-navigate the vault.

**craft-cli**: caveat handling (position guards, error normalization, retry), backlinks, scriptability (pipes, unix composition), compact markdown output for AI context windows. Best for the "user works in Craft, AI assists via terminal" workflow.

## The real gap: CLI vs local MD for AI workflows

The fundamental disadvantage of any API-backed system vs local files:

1. **Every read is a network call.** Reading a 50-line doc that would take <1ms locally takes 1-2s via API.
2. **No diff.** Can't see "what changed since last time I looked". With local files, `git diff` is instant.
3. **No atomic multi-block edit.** Updating 5 blocks in a doc = 5 API calls (or 1 PUT with array, but still one network round-trip). With local files, one Edit tool call.
4. **Search then context is two hops.** `docs search` finds the doc, then `blocks get` fetches content. With local files, grep gives you the match AND context in one pass.
5. **No filesystem watch.** Can't react to changes. The API has no webhooks, no change feed, no timestamps on individual blocks.

## Research findings (2026-04-06)

### blocks_revert: MCP-only, not available via REST API

The MCP's `blocks_revert` uses internal "stamps" that the REST API never returns. Mutation responses contain only `{items: [{id, type, markdown}]}` - no version info. The MCP server tracks stamps server-side.

Implication: can't replicate MCP revert via API. Must build our own undo via read-before-write snapshots.

### Craft's local SQLite database (from community Raycast extension)

The community Raycast Craft extension (github.com/raycast/extensions craftdocs) reads Craft's local FTS5 database:
```
~/Library/Containers/com.lukilabs.lukiapp/Data/Library/Application Support/com.lukilabs.lukiapp/Search/{spaceID}*.sqlite
```

Table: `BlockSearch` with columns `id, content, type, entityType, documentId, customRank`. Queried via FTS5 full-text search - instant, no API call. Read-only.

Write mechanism: the community extension writes via **URL scheme** (`craftdocs://createblock?parentBlockId=...&content=...`), not SQLite. The Craft app handles the URL and creates the block. SQLite is truly read-only from outside.

Risks: undocumented internal format, can change anytime, Mac-only, requires Craft app installed and synced.

Potential: **hybrid read/write architecture** - reads from local SQLite (instant), writes via API (reliable, server-validated). This is the default approach on Mac, with full API fallback for non-Mac or when local DB is absent. Changes the diff story: Craft's app syncs changes to the local DB, so we can detect what changed without our own snapshots.

### AI discoverability: skill + tiered help

MCP's advantage: tool schemas auto-discovered by AI. CLI can match this via:
- craft-cli skill = preloaded context (front-loads cheatsheet, no --help call needed)
- `craft --help` = compact overview (command names + one-liners, like MCP tool list)
- `craft <cmd> --help` = detailed (flags, examples, caveats, like MCP tool description)

These already roughly exist. Optimization: make help output more structured/greppable for AI consumption. Skill and help are complementary - skill is "eager load", help is "on-demand reference".

## Refined suggestions

### 1. Hybrid read architecture (highest infrastructure impact)

**Default on Mac:** read from Craft's local SQLite FTS5 DB, write via API.
**Fallback:** full API for non-Mac or when local DB absent.

This changes everything downstream:
- Search becomes instant (<1ms FTS5 vs 300ms-3.4s API)
- Diff becomes trivial (query local DB at two points in time, compare)
- Patch gets faster (find target block via local DB, then single API PUT)
- Doc listing is instant (no need for separate TTL cache)

Implementation: `src/lib/local-db.ts` module. Discovers Craft's SQLite path via bundle ID. Opens read-only. Validates schema (check BlockSearch table exists with expected columns). Exposes `search(query)`, `getBlock(id)`, `listDocs()`. Falls back to API methods if local DB unavailable.

Bun has native `bun:sqlite` - zero dependencies, fastest possible.

Schema validation on open: if columns don't match expectations, log warning and fall back to API. Never crash on schema mismatch.

### 2. Journal system (SQLite-based) - undo, diff, history

Single SQLite database at `~/.cache/craft-cli/journal.db`. Storage format: binary SQLite (not human-readable, compact, indexed). Uses `bun:sqlite`.

```sql
CREATE TABLE mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  op TEXT NOT NULL,           -- 'update' | 'insert' | 'delete' | 'append' | 'move'
  doc_id TEXT NOT NULL,
  block_ids TEXT NOT NULL,    -- JSON array of affected block IDs
  pre TEXT,                   -- JSON: block snapshots before mutation
  post TEXT                   -- JSON: block snapshots after mutation
);
CREATE INDEX idx_mutations_doc ON mutations(doc_id, ts);

CREATE TABLE doc_cache (
  doc_id TEXT PRIMARY KEY,
  title TEXT,
  folder_id TEXT,
  location TEXT,
  cached_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

Commands it enables:
- `craft diff <docId>` - if hybrid mode: compare current local DB state to last journal entry. if API-only: fetch current, compare to last journal entry. show added/changed/removed blocks
- `craft undo [docId]` - read-before-write: fetch current state, compare to `post` in last journal entry. if match: PUT `pre` data back. if mismatch: warn "doc modified since your edit" + show diff. never blindly overwrite
- `craft log [docId]` - list mutations from journal. `--last N` for recent. `--since DATE` for range

Auto-prune: `DELETE FROM mutations WHERE ts < datetime('now', '-7 days')` on every write. Keeps journal small.

Every write command automatically journals. Pre-mutation snapshot captured via read-before-write (local DB or API GET depending on mode).

### 3. `craft patch` - Edit-tool equivalent

```
craft patch <docId> --old "existing text" --new "replacement text"
```

How it works:
1. Find block containing --old text (local DB in hybrid mode, API GET in API-only mode)
2. Validate: exactly 1 match (0 = error, 2+ = "ambiguous, N matches")
3. Journal: snapshot pre-mutation state
4. API PUT with replaced markdown
5. Journal: record post-mutation state

Hybrid mode advantage: step 1 is instant (local SQLite query) instead of full API block tree fetch.

Also support `--file` / stdin for multi-line patches.

### 4. Enhanced search (leverage hybrid mode)

In hybrid mode, `docs search` hits local FTS5 - instant results with block IDs. No separate grep command needed.

In API-only mode, enhance `docs search --fetch-blocks` to include block-level context around matches. Output: `docTitle > blockId: matched line`.

Either way, existing command surface is sufficient. Hybrid mode just makes it fast.

### 5. `craft cat <id> [id...]` - multi-doc read

Parallel fetch (API), concat markdown output with --- separators. In hybrid mode, could read from local DB for even faster output (but API markdown format is richer). Keep API as default for cat, local DB for search.

### 6. Help optimization for AI discoverability

Tracked separately - update skill + help output as features land. Add to project CLAUDE.md as standing rule.

### What NOT to do

- **Don't mirror the vault to local markdown files.** Craft's block model doesn't map cleanly to flat markdown. The Obsidian trap.
- **Don't write to Craft's local SQLite.** It's the app's internal state. Writes go through API only.
- **Don't try to replicate MCP's stamp-based revert.** Our journal-based undo is more transparent and robust.
- **Don't make hybrid mode required.** API-only must always work. Hybrid is an acceleration layer.

### Design principles

> 1. Reads are local when possible, writes are always API. The Craft app is the source of truth for content; the API is the source of truth for mutations.
> 2. Journal is an audit trail first, undo mechanism second. Always read-before-write.
> 3. Hybrid mode is "best-effort acceleration" - graceful degradation to API-only. Never crash on local DB absence or schema mismatch.
