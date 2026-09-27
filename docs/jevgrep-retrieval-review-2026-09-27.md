# Craft retrieval and document structure review — 2026-09-27

Recommendation: fix local body-search semantics first, then trial bounded semantic ranking over locally obtained candidates. Reuse Jevgrep's separation of discovery, relevance judgment and source excerpts. Do not copy its directory-pruning policy directly to notes: vague titles and daily-note containers can hide the most relevant content.

This is a research/design delivery, not a shipped search feature. No Craft documents or Desktop-owned data were changed. Existing CLI build, 220 unit tests and typecheck passed. Live API measurements were subsequently completed on mcFrakir through Tailscale SSH; see the follow-up below. Live cache measurements remain unavailable because macOS denies the SSH execution context access to Craft’s container. Existing September 19 local-cache benchmarks below remain historical evidence, not fresh measurements.

## What was established locally

1. `src/cli/commands/docs.ts` calls `searchLocalDocsSafe(pattern, {entityType: "document", spaceId})`. `LocalStore.search` filters to those rows before ranking. Document rows contain titles, whereas body text lives in block/page rows. Therefore ordinary local `docs search` misses body-only matches. A two-row in-memory fixture returned zero current-command hits versus one unrestricted content-column FTS hit for `rollback`.
2. `LocalStore.search` uses `BlockSearch MATCH ?`, so an unqualified query can match indexed metadata columns, not only `content`. FTS syntax errors are caught and turned into `[]`; the helper then returns `available: true`. A malformed `(` query produced an apparent empty success in the probe. Empty/error/unsupported must be distinct for reliable retrieval.
3. Local FTS5 query grammar and remote regex search are different. Switching source can change both searchable content and query meaning. Expose and document a literal mode, with explicit FTS/regex modes, instead of silently treating a regex as FTS.
4. Local result `documentId` is a PTS internal ID, not the API document/root-block ID. Body hits must join their internal document ID to the document row's `id`, preserving the original matched block ID separately. Never pass the internal ID to REST as if it were the public document ID.
5. `craft source --json` currently describes docs get/daily and blocks as API-required even though eligible Markdown reads are local-first. Its capability text has drifted from `getAndRender`; fix that manifest in the implementation round.

Runnable probes and raw JSON: `~/dev/play/jevgrep-evaluation/craft-search-probe.ts` and `craft-semantic-probe.py`. The latter sends only six synthetic notes to TypeSafe, never personal notes. One title-only and one body-aware request took 353/346 ms with 570/704 reported input tokens. These are observations, not latency percentiles or billing measurements.

| Synthetic note | Title-only relevance | With body |
| --- | ---: | ---: |
| Weekly planning: restore previous container after a broken release | 0.05 | 0.96 |
| Database changes: retain backward compatibility for reversal | 0.52 | 0.93 |
| Rollback discussion: rejected branding name, unrelated to releases | 0.74 | 0.02 |

Question: “How can we undo a broken software release safely?” Body context corrected the misleading title and recovered the vague one. A generic incident-response note still scored 0.80, so ranking remains judgment, not truth. Six deliberately constructed examples do not establish production precision/recall or calibrated thresholds.

## Application layers

| Layer | Best use | Constraints / next measurement |
| --- | --- | --- |
| Craft Desktop SQLite FTS5 | Fast lexical candidate search, IDs, grouping by note | Read-only; query content column; group body/page/title hits; test tokenization, punctuation, multilingual notes and stale/missing entries |
| Desktop PlainTextSearch JSON | Full Markdown, headings, tags, modified/hash fields | Resolve dual IDs; not all notes necessarily cached; rendering differs from REST; local lines are tied to this representation/version |
| Existing CLI process/helper | Profile-safe local access, bounded helper timeout, batched `cat` | Reuse one helper/store per multi-read; measure startup separately before adding a daemon |
| Optional relevance classifier | Rank ambiguous candidates; choose useful sections or relationship leads | Adds network latency/cost and sends excerpts to a provider; abstain/fallback on failure; do not discard known lexical matches solely on uncertain scores |
| Craft REST | Authoritative remote reads, exact block tree/IDs, missing local content, tasks, collections, writes | Respect scope, pagination, rate limits, Retry-After; request only required depth/metadata |
| MCP | Convenient connected tool access and discovery when CLI is unavailable | Measure tool orchestration separately from REST; does not bypass underlying space limits |
| Realm / native app / UI | Realm is Desktop's internal primary store; UI owns actual appearance | Avoid a second unofficial Realm reader or direct writes. CLI work uses supported cache/REST paths; no UI automation is required for this research |
| Agent context | One packet of selected exact snippets with source/IDs, then targeted reads | Bound the whole response, including leads; expose omitted/unknown/stale content; do not make every lead a mandatory read |

The existing cache-native September 19 benchmark reported roughly 58 ms for a 15 KB cached read, 86 ms for a 240 KB read, and 59 ms for batched reading of two notes. Corresponding direct Markdown files took approximately 3–4 ms. See `docs/plans/completed/2026-09-19-cache-native-read-speed.md` and its raw paired records. Adding a 350 ms classifier to a known-ID read would make it slower. The target is fewer agent discovery steps and smaller relevant context for ambiguous queries, not faster byte retrieval.

Craft's [current API reference](https://connect.craft.do/api-docs/space) documents remote depth controls, content search, typed blocks and shared request/block budgets. These mechanisms differ from CLI `--outline`, `--lines`, `--head`, and `--budget`, which shape already-fetched Markdown. Selecting a subtree/depth can reduce remote payload; truncating the final output alone cannot.

## Proposed retrieval path

1. Resolve profile/space and source policy. Known note ID/title/date goes directly to existing reads; exact text goes to local lexical search.
2. Retrieve content-column FTS candidates across title, page and body rows. Group by API document ID and keep best matching blocks/snippets. Add exact title/tag matches. Report limits and cache coverage; an empty cache result is not proof of absence.
3. For a natural-language request, optionally classify bounded candidate excerpts. Add a bounded broader pass over document previews/tags for synonym-only queries: reranking lexical hits alone cannot recover candidates that never matched. Avoid pruning a folder, daily note or document solely from its title.
4. Expand selected notes into heading/section units. Score them using the query plus title, breadcrumb and nearby context; keep verbatim evidence and links. Include headings/parents needed to interpret a block. Do not split a table, list or toggle away from the text that explains it.
5. Return one total-budget packet with document IDs, block IDs when known, source (`local`/`api`), revision/hash provenance, selected evidence, and explicit omitted/unknown status. Local Markdown line ranges are read handles, not block edit targets.
6. Fetch API block JSON only when structure, exact edit IDs, freshness, tasks or collection data require it. Verify immediately after a write through API when remote confirmation is needed; normal local reads accept Desktop sync lag.

Start without a second full-content index or Markdown mirror; existing cache ownership is an explicit project decision. A derived classification cache can key on profile/space, document content hash, query, provider/model and prompt version. Cache only the necessary decisions; invalidate on content changes and isolate spaces. Set total request/time/input-byte limits and preserve partial evidence on timeout. Jevgrep's default 50,000-request runaway ceiling is inappropriate as a normal note-search budget.

Suggested additive interface for a future prototype: `craft docs find "question" --semantic --budget 6000`, with a plain lexical mode as the default. This command does not exist yet. Keep it opt-in until corpus evaluation shows a benefit.

## Formatting and retrieval should cooperate

| Intent | Native choice | Retrieval consequence |
| --- | --- | --- |
| Core argument or explanation | Short paragraphs under descriptive headings | Headings provide useful section boundaries and breadcrumbs |
| Parallel facts / sequence | Bullets / numbered list | Retrieve the lead-in and related items together |
| Optional supporting detail on this page | Toggle (`listStyle: "toggle"`) with correctly nested following blocks | Search hidden children; return the toggle label with a hit; collapsed UI is not an access boundary |
| Material with its own destination, reused independently | Subpage; card presentation where navigation benefits | Preserve its own identity and parent breadcrumb; expand only when relevant |
| Important qualification or decision | Callout, sparingly | Keep it alongside the claim it qualifies, not hidden as optional context |
| Small comparison | Table | Keep headers with selected rows |
| Repeated typed records needing filtering | Collection | Use schema/fields and targeted item queries, not a giant Markdown table |
| Executable action | Task; reminder only when notification is intended | Retrieve status/date through the corresponding API capability |

For human-facing pages, optimize reading and meaning rather than minimizing block count. Avoid hiding required steps or qualifications inside toggles. A small code classifier could suggest a block kind, but authorial intent and the API schema should determine the final structure; Jev need not sit in every formatting operation.

Use typed `blocks insert --file` for native styling, nested pages/cards, media and structure preservation. Markdown append is suitable for simple prose; it is not a guaranteed round-trip representation of rich blocks. `BlockInsert` deliberately permits extra fields, so TypeScript acceptance alone does not validate native layout. Consult the live schema and verify hierarchy after nontrivial structural writes. This review checked documented toggle support, not a live formatting round trip.

## Next implementation and evaluation sequence

- First change: local body search with correct document grouping/ID mapping, explicit query grammar, error versus empty distinction, and truthful capability metadata. Add regression fixtures for body-only matches, title/body deduplication, metadata false positives, malformed FTS, missing document rows, profile isolation and no-network strict-local mode.
- Second, separate prototype: semantic ranking and section packets. Establish a labeled set of real lookup questions before tuning. Include vague titles, synonyms, multilingual terms, daily notes, nested pages/toggles, negatives and missing/stale cache cases.
- Compare current local title search, corrected lexical body search, REST search, lexical-plus-Jev and the broader preview pass. Use paired runs and distinguish cold/warm caches. Record recall, false-positive evidence, abstention, p50/p95 wall time, network requests, bytes/tokens returned, actual provider cost and agent task success.
- Test local/REST text and hierarchy fidelity separately from relevance. Measure fresh-write synchronization without assuming representation equality. Verify API depth and Markdown shaping savings independently.
- Adoption gate: useful recall gains for semantic questions without regression on exact lookups, bounded total cost/output, and reduced end-to-end agent work. Model-call speed alone is insufficient.

Tailscale SSH access is resolved: use `tailscale ssh pavel@mcfrakir` and complete its identity-check URL when prompted. The API profile works. Fresh local-cache measurements require an execution context permitted by macOS to read the Craft container. No production search behavior, Craft formatting, or external notes were changed during this review.


## Live mcFrakir follow-up

Tailscale reached mcFrakir directly in 9 ms. `tailscale ssh pavel@mcfrakir` requested a browser identity check; refreshing the existing GitHub/Tailscale sign-in completed it. Remote `id -un` returned `pavel`, and Craft API doctor passed. Installed CLI is 0.8.0 from a clean checkout at `3917bb6b8e684df881831f96a62a383f4c2a9166`; executable SHA-256 is in the raw results.

The Craft Search directory exists, but `ls` under this SSH session returned `Operation not permitted`. `craft __local probe` reported unavailable; strict-local read exited 1. This is macOS container access denial, not absent Desktop cache, invalid API credentials, or unreachable Tailscale. All sampled auto reads explicitly reported `(api)`. No privacy/security settings were changed and no local speedup is claimed.

Read-only API benchmark: fresh remote CLI processes, one excluded warm-up per case, three measured serial samples with rotated ordering. Timings exclude SSH establishment but include CLI startup and draining stdout. No note contents, IDs or credentials are retained in results; note bodies stay in process memory on mcFrakir. No user notes were sent to Jev. The small sample and network variability do not establish latency percentiles or causal speed gains.

Initial API enumeration returned 1,679 items / 179,523 bytes in 8.279 seconds (one observation). The first two listed documents were tiny, so a second exploratory set selected the two unique documents with the longest snippets returned by API search for `craft`. This is deliberate sample selection, not a representative corpus sample.

| API operation | Document A (7,294 bytes full) | Document B (4,663 bytes full) |
| --- | ---: | ---: |
| Full Markdown | 455 ms / 7,294 bytes | 698 ms / 4,663 bytes |
| Auto Markdown (served by API) | 430 ms / 7,294 bytes | 438 ms / 4,663 bytes |
| Outline | 1,089 ms / 518 bytes | 424 ms / 369 bytes |
| Budget 2,000 characters | 549 ms / 2,002 bytes | 423 ms / 2,006 bytes |
| JSON depth 0 (root only) | 694 ms / 423 bytes | 585 ms / 512 bytes |

These are medians of three successful calls. Outline output was 92.9% / 92.1% smaller than full Markdown. Budget is measured in Unicode characters, not UTF-8 bytes, so outputs slightly exceeded 2,000 bytes. Depth-0 JSON is a different representation containing only the root, not equivalent evidence to the full note. In this small run, none of the shaping modes demonstrated a consistent latency improvement.

API search for `craft` took 2.077 seconds median and returned 137,175–137,330 bytes. This supports testing compact grouped snippets and section retrieval as a context-efficiency improvement; it does not establish semantic ranking accuracy or cost savings on real notes. A classifier would add time and provider cost, so it should be evaluated against corrected lexical body search and actual agent task completion.

All measured calls exited successfully. The initial tiny-document observations remain separately recorded rather than discarded or pooled with the larger-note set. The 350 ms synthetic Jev measurements were made on the other Mac and are not a controlled same-host latency comparison with these API results.

Raw evidence: [initial listing/search/read samples](benchmarks/2026-09-27-live-craft-benchmark.json), [content-selected note samples](benchmarks/2026-09-27-live-craft-content-benchmark.json). Reproduce with `tailscale ssh pavel@mcfrakir 'python3 -' < benchmarks/live-craft-benchmark.py` or `benchmarks/live-craft-content-benchmark.py` (redirect stdout locally to save aggregate metrics). The selection may change as the user's corpus changes.

Remaining validation: fresh local-cache timings require a macOS execution context already allowed to read the Craft container, or an explicitly approved privacy-permission change. Cache/API representation fidelity, write-to-cache sync lag and live native formatting round trips were not tested by these read-only API calls.
