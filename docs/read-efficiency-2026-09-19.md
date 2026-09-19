# Reading efficiency: Craft before/after and Markdown files

> Historical record: the subsequent cache-native round intentionally replaces freshness gating with Desktop-owned synchronization. See [the completion record](plans/completed/2026-09-19-cache-native-read-speed.md).

Measured September 19, 2026 on this Mac. The largest latency improvement comes from local-first reads introduced before the latest improvement round. The latest round primarily adds correctness and bounded agent output. Clean Craft cache hits are much faster than the original API reader, but still 26–37 times slower than direct reads of identical Markdown files.

## Latency

Median wall-clock time, including process startup and draining stdout. Medium and large documents contain 15,439 and 239,492 characters in the current local representation.

| Read path | Medium (~15 KB) | Large (~240 KB) | Normal API requests |
| --- | ---: | ---: | ---: |
| Before: default, including backlinks | 980 ms | 2,170 ms | 3 |
| Before: content only, `--no-links` | 934 ms | 1,680 ms | 2 |
| After: explicit API, content only | 502 ms | 816 ms | 1 |
| After: clean local cache | 61 ms | 93 ms | 0 |
| After: real `auto` freshness state | 419 ms | 1,017 ms | 1 |
| Identical Markdown bytes, `/bin/cat` | 2.36 ms | 2.50 ms | 0 |
| Actual Obsidian vault notes, `/bin/cat` | 2.95 ms | 3.28 ms | 0 |

Content-only API reads improved 1.86–2.06×. Clean local reads improved 15.2–18.1× relative to the original content-only API reader. Direct Markdown still avoids roughly 59–90ms of Craft command/runtime/helper overhead per read.

Request counts are derived from verified code paths, not a network capture, and assume no retries and a nonempty document title for backlink discovery. Backlinks are now opt-in, so the default rows have different functionality; content-only rows provide the closer comparison. Network variability explains why the medium `auto` sample was faster than explicit API despite doing additional local work.

### Actual freshness behavior matters

The first strict-local benchmark attempt was rejected because the real freshness state marked a test document unverified after a write. Both documents used API fallback for every measured `auto` sample. Their local and API representations did not match sufficiently to restore local trust.

Clean-local measurements therefore deliberately use an isolated empty freshness database. They represent the cache-hit case, not current automatic behavior for these two documents. The real pending-write database was not cleared or reset. In its measured state, `auto` was about 7–11× slower than a clean local hit.

This is the largest practical remaining issue for the intended workflow: preserve correct read-after-write behavior without keeping differently rendered documents on the API indefinitely. The next investigation should distinguish actual stale content from harmless representation differences using trustworthy revision evidence or a verified read-through cache; weakening validation or expiring it on a timer would recreate the review defect.

## Agent output efficiency

Characters emitted, not tokenizer counts. All Craft shaping happens after obtaining the full source Markdown.

| Output mode | Medium | Large | Reduction for large document |
| --- | ---: | ---: | ---: |
| Full local Markdown | 15,439 | 239,492 | — |
| `--head 40` | 2,807 | 1,485 | 99.38% |
| `--lines 20:60` | 2,505 | 1,288 | 99.46% |
| `--outline` | 1,070 | 7,754 | 96.76% |
| `--budget 2000` | 2,000 | 2,000 | 99.16% |

Local shaping latency remained approximately 59–94ms. It reduces the material sent to an agent, not the API response size or the amount read from the Desktop cache. The large document's 2,000-character budget emits about 120× less text than its full read, while deliberately omitting content and ending with `[truncated]`.

Plain Markdown already provides equally bounded output with `head`, `sed`, and `rg`: measured file head/range commands took 1.86–2.35ms. An agent could also pipe the old Craft output through these tools, so smaller context was possible before; native flags make it easier to discover and use consistently. One medium range differed by one trailing newline between Craft shaping and `sed`; the large range and both head outputs had matching character counts.

For a known document ID or file path, both full reads take one agent tool call. Outline then section retrieval takes two calls. Craft still lacks native grep across document bodies and stable readable handles, while Markdown files already work with file paths and `rg`.

## Which change deserves the credit?

- Exact before source: Git `c4befb8`, compiled separately without modifying the working tree. It fetches structured JSON and Markdown separately, and adds backlink search by default.
- Exact after: the current compiled working-tree binary, identified by SHA-256 in the raw measurements.
- DeepSeek's intermediate local-first implementation was uncommitted and has no separately preserved exact executable/source snapshot. A controlled immediate-before-round latency comparison cannot be claimed.
- The September 18 proposal records 6.4s/10s API reads and a 27ms direct local ceiling. Those are historical measurements under different conditions and are not used for today's speedup ratios. In particular, a direct PTS read is not the same measurement as a fresh CLI process plus its helper.

The latest round's demonstrated benefit is safer source selection and convenient bounded output. Most of the API-to-local speedup belongs to the preceding local-first change.

## Method and evidence

- Warm filesystem; one excluded warm-up per case; each measured command starts a new process. Cases rotate order and run serially.
- Five measured repetitions for network/auto cases; fifteen for local/file cases. The large baseline content-only API had an 8.59s outlier; median was 1.68s. See raw ranges rather than treating any latency as a guarantee.
- Identical-byte comparison: current local Markdown was saved to temporary `.md` fixtures on the same Mac, read with system tools, then removed. No Obsidian UI/plugin time is included.
- Actual Obsidian cross-check: two existing vault files selected by similar byte size (15,402 and 231,442 bytes), with fifteen timed `cat` reads after one excluded read. These used Python subprocess timing rather than the main benchmark's Bun runner, so they corroborate the scale rather than provide an exact controlled ratio. Neither vault files nor their content were changed or retained in the report.
- Craft local/API representations have different formatting and byte counts; the benchmark is not proof of semantic completeness or freshness. No remote writes were made.
- UI rendering, agent orchestration latency, model tokenization, and end-to-end model response time are excluded.

Reproducible harness: [benchmarks/read-efficiency.ts](../benchmarks/read-efficiency.ts). It typechecks independently and emits only aggregate/sample metrics, never document content or credentials.

Raw evidence: [Craft and identical Markdown samples](benchmarks/2026-09-19-read-efficiency.json), [actual Obsidian file samples](benchmarks/2026-09-19-obsidian-file-reads.json).
