# Reliable file-like reads

> Historical record: the subsequent cache-native round intentionally replaces freshness gating with Desktop-owned synchronization. See [the completion record](2026-09-19-cache-native-read-speed.md).

Status: completed locally, 2026-09-19

This improvement round addresses the September 19 review and adds bounded Markdown reads. It preserves the existing local-first work and concurrent changes. Grep, stable handles, and batch text editing remain later phases of the broader September 18 proposal.

## Ownership

- Luna read-correctness: lossless cache normalization, strict local source, raw/backlink routing, validated daily dates, regression tests.
- Luna read-shaping: line ranges, head, outline, total character budget for cat, command wiring and tests.
- Luna write-freshness: common successful-mutation invalidation, connection isolation, persistent freshness state and tests.
- Parent: architecture, integration, CLI discovery/help/skill/changelog, subprocess acceptance tests, build and runtime checks.

## Acceptance

- Cached Markdown preserves meaningful whitespace and code bodies.
- Explicit local content reads never make network requests; unsupported combinations fail clearly.
- API reads work with no Desktop cache; auto falls back on cache misses.
- Every successful CLI write invalidates local content reads through the common client boundary; elapsed time alone does not establish freshness.
- Range, head, outline, and budget behave consistently for local and API content. Truncation is explicit.
- Full tests, typecheck, compiled build and representative compiled local/API reads pass. Live remote write checks are kept separate from mocked write verification.

No release, push, or external publication is included.

## Delivered and verified

- All five review findings addressed, plus raw-output routing, missing-cache diagnostics, source precedence, and strict-local daily metadata handling.
- Added `craft read <id>` alias and bounded output flags across Markdown content commands. Budgets count Unicode code points, include separators/backlinks, and preserve a complete truncation marker.
- Successful mutation observer is optional and Node-compatible in the library. CLI-only SQLite freshness state hashes connection identity and contains no raw credentials or URLs. Known block/collection writes resolve document owners in a bounded helper; unresolved targets invalidate broadly. Failed observers do not retry successful writes.
- Invalidated local content is re-enabled only after a matching API comparison, bound to document fingerprint and mutation generation. Unrelated targeted writes preserve verified documents. Differences in body whitespace or links do not certify sync.
- Bundled skill, agent-context, help, capability discovery, and the existing canonical craft-cli skill/read references updated. Concurrent remote skill-library work preserved.

Final checks: `bun test` 235 pass, 28 credential-gated skips, zero failures; `bun run typecheck`, `bun run build` (including signature/launch verification), and `git diff --check` passed.

Subprocess tests verified API fallback with no Desktop cache, strict-local no-network behavior, cross-process collection-write invalidation, API verification followed by resumed local reads, and one total cat budget. Live read-only checks on the rebuilt binary verified local outline, API head, local/API 80-character bounded output, and unsupported strict-local flag rejection. Sample timings: local outline 77ms, API head 482ms, two-document local budget 73ms; these are individual observations, not a benchmark guarantee.

Live remote writes and real non-macOS execution were not tested. External writes are not tracked. When local/API representations differ, invalidated documents remain on API fallback. Shaping limits output sent to the agent, not API download size. Grep, stable handles, and batch edits remain future phases.
