# Native internal links

Issue: https://github.com/pa1ar/craft-cli/issues/10

## Why

Craft shipped `GET /internal-links` (experimental) and a matching MCP command `internal-links get`. It returns document pairs with reference counts and titles, or exact block references, for outgoing links and backlinks. Our backlinks are a title-search heuristic that misses renamed link text and results past the top-20 search cutoff. Our `--exhaustive` scan reads every document (2-3 min). Craft will maintain the official endpoint, so we follow it.

## How the two approaches compare

| | craft-cli today | Craft `/internal-links` |
| --- | --- | --- |
| Backlinks | search target title, filter `block://id` in hits | `toDocumentId`, indexed |
| Outgoing | parse `[text](block://id)` in fetched tree | `fromDocumentId` |
| Misses | renamed link text, >20 search hits | none known |
| Date mentions | not detected | included (target: daily note root) |
| Link text | yes | no |
| Titles | no | other endpoint's title at document level |
| Cards/blocks as target | yes (any block id) | ids must be document roots; refs to cards roll up to their document |
| Cost (1ar space) | ~5.6 s, 71 refs to 1ar-system card | ~2 s, 74 refs |
| Full-space map | not possible | 7,531 block refs in 38 pages, 75 s |

Measured 2026-11-02. Unknown ids return an empty list with HTTP 200. Conflicting filters return 400 VALIDATION_ERROR.

## Design

1. `src/lib/links.ts` (Node-safe):
   - `client.links.list(params)` wraps `/internal-links` with all params; `listAll` follows cursors.
   - `outgoing(id, opts)` and `backlinks(id, opts)` use the native endpoint.
     - Find the document root: an injected `resolveDocumentId(id)` (CLI uses local SQLite), else check `GET /documents` membership, else (API-only, card or block id) scan the whole space at block level and filter by block id. The scan is slow, so it prints a hint to pass `--doc <rootId>`.
     - If id is a document root: one document-level call (titles and counts) plus one block-level call (exact source and target blocks).
     - If id is a card or block inside document D: block-level call on D, filter `targetBlockId == id` (backlinks) or `sourceBlockId` in id's subtree (outgoing; subtree from `GET /blocks`).
   - `BlockLink` gains optional `documentTitle`, `referenceCount`, `targetDocumentId`, `targetBlockId`, `sourceBlockId`. Existing fields keep their meaning; `text` is filled for outgoing from the parsed tree when available, else empty.
   - Keep the legacy title search and exhaustive scan as `backlinksLegacy` and `backlinksExhaustive`.
2. CLI `craft links`:
   - `links out|in <id> [--level document|block] [--doc ROOT] [--include-self] [--all]`.
   - `links between <from> <to>` for A to B.
   - `links map [--level ...] [--from-date D] [--to-date D] [--limit N]` for raw access (whole space or daily notes).
   - `--legacy` uses the title search; `--text` implies legacy. `--exhaustive` keeps the old full scan, marked deprecated.
   - Default table for `in`: source doc title, source doc id, source block, count.
3. `--links` on `docs get`, `blocks get`, `cat` uses native backlinks; failures still never break the read.
4. Docs: `skill/SKILL.md`, README (commands, comparison table, "footguns" line), `craft which`, `agent-context`, `main.ts` help, AGENTS.md (spec path), CHANGELOG.
5. Integration test against the live API: `links in` on a doc root and a card, `links out`, `links map --from-date today`.
6. Release 0.11.0 (minor: additive commands, changed default behavior with legacy fallback), tag, gh release, 1ar.io update post, Craft daily log.

## Open questions

- Fall back to legacy automatically when the endpoint errors (experimental, may change)? Proposed: yes, with a stderr note.
- Is `GET /documents` membership a good enough root check, given it only covers listed locations?

## Outcome (2026-11-02)

Codex review folded in: fetch only the requested level, no silent whole-space scan (local root, then `/documents`, then `--doc`/`--scan`, else exit 4), self-links kept for card targets, CURSOR_INVALID restart with dedupe, legacy fallback only when the endpoint is unavailable, `between` dropped in favor of `links map --from --to`.

Verified live: `tests/integration/links.test.ts` (5 pass), full integration suite 33 pass, unit 233 pass. Backlinks to the SKILLS database: native 77 documents, legacy title search 1. 1ar-system card: 52 source documents (97 block refs incl. sibling cards). Whole-space scan for a card without local cache: ~1:45.
