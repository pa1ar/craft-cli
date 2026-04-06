# Craft local data stores vs API: performance and completeness

Date: 2026-04-06
Vault: 1ar ({spaceId})
Docs in vault: ~1226 (API), ~1245 (SQLite), ~1216 (PTS JSON)

## Key finding: ID mapping

The three data sources use two different ID spaces:

| ID type | Where it appears | Example |
|---|---|---|
| Block/entity ID | API document `id`, SQLite `id` column | `AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE` |
| Internal document ID (stamp) | SQLite `documentId` column, PTS `documentId` field, PTS filename | `11111111-2222-3333-4444-555555555555` |

To look up a PTS file from an API ID, you must first resolve the internal ID via SQLite:
`SELECT documentId FROM BlockSearch WHERE id = ? AND entityType = 'document'`

## Experiment 1: Sync timing

After writing a marker block via API (`craft blocks append --date today`):

| Store | Time to update | Notes |
|---|---|---|
| API write latency | ~2600ms | round-trip to Craft cloud |
| SQLite FTS5 mtime | 1s | updated almost immediately |
| SQLite FTS5 content | 1s | marker found in FTS within same second |
| PlainTextSearch JSON | 1s | file content updated within same second |

Both local stores update within ~1 second of an API write, with Craft app running in background. The sync appears to be push-based from the cloud - the local app receives the change and updates both stores near-simultaneously.

Craft app must be running (was PID 96473 during test). Did not test with app closed.

FTS tokenization note: the unicode61 tokenizer splits `SYNC_TEST` into tokens `sync` + `test`. Underscores are treated as word separators.

## Experiment 2: Performance comparison

5 iterations per test, wall-clock time in milliseconds.

### Summary table

| Operation | API (avg) | SQLite FTS5 (avg) | PTS JSON (avg) | Fastest local vs API |
|---|---|---|---|---|
| Search "typescript" | 2271ms | 1.3ms | 293ms | 1687x (SQLite) |
| Search "SYNC_TEST" | 1403ms | 0.5ms | 199ms | 2576x (SQLite) |
| Get doc by ID | 4561ms | n/a | 0.7ms | 6309x (JSON) |
| List all docs | 1489ms | 26.7ms | 241ms | 56x (SQLite) |
| Check doc changed | 3247ms | n/a | 0.5ms | 6645x (JSON) |

### Detailed results

#### Search common term ("typescript")
- API: avg 2271ms, min 1275ms, max 2979ms - returned 25 results
- SQLite: avg 1.3ms, min 0.9ms, max 2.4ms - returned 15 unique docs
- JSON grep: avg 293ms, min 275ms, max 309ms - returned 16 docs

API returns more results because it searches additional metadata and runs server-side relevance scoring. SQLite FTS5 is 1700x faster. JSON grep (reading all 1216 files) is still 8x faster than API.

#### Search rare term ("SYNC_TEST")
- API: avg 1403ms, min 884ms, max 1943ms - returned 0 results (API search may not index very recent writes)
- SQLite: avg 0.5ms - found 1 doc
- JSON grep: avg 199ms - found 1 doc

API search failed to find the just-written marker despite the content being accessible via `docs get`. Local stores had it indexed within 1 second.

#### Get document by ID
- API: avg 4561ms, min 3027ms, max 7180ms
- JSON: avg 0.7ms (direct file read via internal ID lookup)

6300x speedup. JSON read requires knowing the internal ID mapping.

#### List all documents
- API: avg 1489ms (1226 docs)
- SQLite: avg 26.7ms (1245 docs, includes 19 not in API)
- JSON: avg 241ms (1216 files, reads each file)

SQLite is 56x faster. JSON is still 6x faster than API despite reading 1216 files.

#### Check if document changed
- API: avg 3247ms (must fetch full content, no hash-only endpoint)
- JSON: avg 0.5ms (read `contentHash` field from PTS file)

6600x speedup. PTS JSON has a `contentHash` field (MD5) that enables instant change detection without fetching content.

## Experiment 3: Data completeness

### Document coverage

| Source | Count | Gap vs API |
|---|---|---|
| API | 1226 | - |
| SQLite FTS5 | 1245 | 19 extra (deleted/archived docs still in index?), 0 missing |
| PTS JSON | 1216 | 10 missing from API (likely recently created), 0 extra |

All PTS files mapped to valid API docs (0 unmapped). SQLite has 19 entries not in API - likely stale/deleted docs that haven't been purged from the FTS index.

### Content comparison (5 random docs)

| Document | API chars | PTS chars | Similarity |
|---|---|---|---|
| 2026.03.31 (daily note) | 3262 | 3403 | 94% length ratio |
| cloudflare configs | 11355 | 11891 | ~100% length ratio |
| why we train/fight | 168 | 124 | 74% length ratio |
| x community notes analysis | 192 | 140 | 73% length ratio |
| Zero to One | 1931 | 2016 | 98% length ratio |

Content is similar but not identical. Differences come from:
- PTS markdown includes the `# title` heading line; API may strip it
- PTS includes tag lines (`#hub #on/brain2`) that API may render differently
- Formatting differences in tables, links, and special characters
- PTS may lag behind API for recently edited docs

### Search completeness ("typescript")

| Source | Docs found |
|---|---|
| API | 25 |
| SQLite FTS5 | 15 |
| PTS JSON grep | 16 |

API found more because it searches:
- Block content (same as local)
- Possibly document titles, tags, and metadata fields not in FTS content column
- Server-side stemming/fuzzy matching

The 1 doc found by PTS but not SQLite suggests FTS content column doesn't contain all text that PTS markdownContent has.

## PTS JSON schema

Each `document_<internalId>.json` contains:

```json
{
  "blockCount": 8,
  "contentHash": "17C02ACC1100E14A4682BF356331549D",
  "documentId": "{documentId}",
  "isDailyNote": false,
  "lastViewed": 795611447.428167,
  "markdownContent": "# title\n\ncontent...",
  "modified": 795611491.249674,
  "plainTextContent": "stripped text...",
  "stamp": "E04B239C-9FA4-4687-A803-B15D2101C493",
  "tagSearchContent": "text with tags preserved...",
  "tags": ["hub", "type/app"],
  "title": "toolset"
}
```

Useful fields for CLI integration:
- `contentHash` - instant change detection without reading content
- `isDailyNote` - filter daily notes without parsing title
- `tags` - pre-parsed tag array
- `modified` - Core Data timestamp (seconds since 2001-01-01)
- `markdownContent` - full markdown, similar to API output

## SQLite FTS5 schema

```sql
CREATE VIRTUAL TABLE "BlockSearch" USING fts5(
  id, content, type, entityType, customRank,
  isTodo, isTodoChecked, documentId,
  stamp UNINDEXED, exactMatchContent,
  tokenize='unicode61'
);
```

`entityType` values: `document`, `block`, `page`
`documentId` is UNINDEXED stamp column linking to PTS files.

## Recommendations

1. **For search**: use SQLite FTS5. 1700x faster than API, covers all entity types. Use `SELECT DISTINCT documentId` to get unique documents.

2. **For single doc read**: use PTS JSON via internal ID. 6300x faster. Requires one-time SQLite lookup to resolve API ID -> internal ID.

3. **For change detection**: use PTS `contentHash`. 6600x faster than API full fetch. Can poll this field to detect changes without reading content.

4. **For doc listing**: use SQLite. 56x faster, slightly more docs than API (includes stale entries).

5. **ID mapping cache**: build a cache of API ID -> internal ID from SQLite at startup. This mapping is stable (IDs don't change for existing docs).

6. **Hybrid approach**: use local stores for read operations, API for writes. Both local stores update within 1 second of API writes.

7. **Caveat**: PTS has 10 fewer docs than API. For completeness-critical operations, fall back to API.

## Test artifacts

- Script: `tests/experiments/perf-comparison.ts` (re-runnable with `bun run tests/experiments/perf-comparison.ts`)
- Raw JSON: `tests/experiments/perf-results.json`
- Sync timing: `tests/experiments/sync-timing.sh`
