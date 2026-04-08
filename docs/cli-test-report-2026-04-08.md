# CLI test report - 2026-04-08

Tested: consolidation-style workflow (scan daily notes, search, read, patch, undo, diff, log).

## Issues found

### Issue 1: `[local]` banner prints even when local DB isn't used for the query
**Severity**: cosmetic
**Steps**: `craft docs ls --location daily_notes` - the code skips local (because `--location` is set) but the `[local] using local Craft database` banner still appears because `getLocalStore()` initializes the singleton on first call and logs.
**Fix**: move the banner into the command handler, not the singleton init. Only print it when local path is actually taken.

### Issue 2: `[local]` banner on stderr breaks JSON piping with `2>&1`
**Severity**: minor (user education)
**Steps**: `craft docs ls --json 2>&1 | jq` fails because stderr mixes with stdout.
**Fix**: already mitigated by `--quiet` flag. Could also suppress banner when `--json` is set (JSON output implies machine consumption).

### Issue 3: Local search returns fewer results than API for simple terms
**Severity**: expected, document
**Steps**: `craft docs search "LTM"` returns 1 result (local FTS5 document match), while API with `--include` returns 50 (including partial matches like "altman").
**Cause**: local search filters to `entityType: document` for `docs search`. This is correct behavior - it's searching document titles, not block content.
**Fix**: document this. For deeper search across all blocks, add `--blocks` flag or similar to search blocks too.

### Issue 4: API `regexps` search returns 0 results for short terms like "LTM"
**Severity**: API quirk, already known
**Steps**: `craft docs search "LTM" --api` returns 0 via regexps, but `--include` returns 50.
**Cause**: RE2 regex mode has different tokenization. Short uppercase terms may not match.
**Impact**: local search is actually MORE reliable than API for simple terms, which is a bonus.

### Issue 5: No journal entries from before journal was built
**Severity**: expected, not a bug
**Steps**: `craft log` shows "no mutations" even though writes happened before journal was implemented.
**Fix**: n/a - journal only tracks mutations made after it was implemented.

### Issue 6: API regexps misses results that local FTS5 finds
**Severity**: medium - means local search is better, not just faster
**Steps**: `craft docs search "LTM" --api` = 0 results. Without --api (local) = 1 result.
**Impact**: local mode is the better default for search reliability.

### Issue 7: Local `docs ls` is 685ms, not instant (reads 1245 PTS JSON files)
**Severity**: performance, minor
**Steps**: `time craft docs ls --json` = 685ms local vs 2200ms API.
**Cause**: `listDocs()` reads a PTS JSON file for each document to enrich with isDailyNote/tags/contentHash. 1245 file reads.
**Fix**: lazy-load PTS enrichment. For basic listing, only query SQLite. Read PTS only when isDailyNote/tags are actually needed (e.g., `--json` with those fields, or when filtering).

### Issue 8: Local `docs ls` includes internal pseudo-documents
**Severity**: minor data quality
**Steps**: local listing includes `block_taskInbox` and `block_taskLogbook` - internal entries that API wouldn't return.
**Fix**: filter out entries where id doesn't match UUID pattern in `listDocs()`.

### Issue 9: `craft undo` without targetId hits undo-of-undo protection
**Severity**: minor UX
**Steps**: after `undo` (creates an undo entry), a second `undo` tries the most recent entry which is the undo itself, and exits with "last mutation is already an undo" on stderr.
**Fix**: when searching for last mutation, skip entries where `op === "undo"` automatically (find the last non-undo mutation). The current behavior requires users to target by docId which is unintuitive.

## What works well

- `craft cat` - parallel multi-doc read, clean output, fast
- `craft patch --dry-run` - correctly finds blocks, shows diff, respects ambiguity (0/1/2+ matches)
- `craft patch` + `craft undo` cycle - full round-trip works correctly
- `craft log` - clean table output, correct timestamps
- `craft diff` - correctly compares current state to journal
- `craft docs daily` - fast, correct markdown output
- `craft blocks search` - works well with context lines
- `craft blocks append` + journal - writes and records correctly
- `--api` flag - correctly forces API-only mode
- `--quiet` flag - suppresses banners
- `--json` output - parseable, correct structure
- Error exit codes - 4 for not found, 1 for user error, correct behavior

## Performance

| Operation | Local | API | Speedup |
|---|---|---|---|
| `docs ls` (no filter) | 685ms | 2200ms | 3.2x |
| `docs search` | 79ms | 1650ms | 21x |
| `docs daily` | n/a (API only) | ~2s | - |
| `craft cat` (3 docs) | n/a (API only) | ~4s | - |

Note: local `docs ls` is slower than raw benchmarks (685ms vs 27ms) because it enriches each doc with PTS JSON data.
