# Local-first agent reads review

> Historical record: the subsequent cache-native round intentionally replaces freshness gating with Desktop-owned synchronization. See [the completion record](plans/completed/2026-09-19-cache-native-read-speed.md).

Reviewed the uncommitted changes over c4befb8 on 2026-09-19. Review only; implementation preserved.

Verdict: useful first phase, with correctness fixes needed before shipping.

Follow-up: the findings below were addressed in the [completed improvement round](plans/completed/2026-09-19-read-correctness-and-shaping.md). This review is retained as the original evidence; see the completion record for current verification and limits.

## Findings

- P2: `src/lib/local-db.ts:77` strips Markdown hard-break spaces and collapses blank lines inside fenced code. Directly reproduced with `normalizePtsMarkdown`. Preserve body bytes except verified transport wrappers; add fidelity fixtures.
- P1: `src/cli/journal-singleton.ts:28` equates recent journal entries with all writes. Document and collection mutation handlers do not record journal entries, so their immediate subsequent reads can use stale cache. The fixed five-second expiry also cannot establish that Desktop has synced. Track invalidation for every successful mutation and retain it until freshness is established.
- P2: `src/cli/render.ts:65` only enforces strict local mode inside the eligible-local branch. Missing spaceId, explicit depth/JSON/metadata, or a recent mutation bypass that branch and make API calls. Mock reproduction with source=local and missing spaceId or depth=1 returns servedBy=api. Reject unsupported strict-local reads before API dispatch; explicit links also need a clear source contract.
- P2: `src/cli/render.ts:59` ignores exhaustive=true unless withLinks=true. The documented standalone --exhaustive command returns no backlinks. Reproduced using a stub client. Make exhaustive imply links or reject the combination explicitly.
- P2: `src/cli/render.ts:49` accepts overflowing calendar dates and line 51 maps invalid date strings to today. A typo can select an unrelated cached daily note while the API receives the original invalid input. Validate once and use the same canonical date for both paths.

## Verification

- `bun test`: 186 pass, 28 skip, zero failures. Credential-gated integration tests were skipped.
- `bun run typecheck`: passed.
- `bun run build`: passed, including macOS signature and executable launch checks.
- Rebuilt binary successfully read the same LTM document with explicit local and API sources. Outputs differ in formatting and links; this is a smoke check, not broad fidelity proof.
- Live remote writes and non-macOS runtime behavior were not exercised.

## Fit to the intended workflow

Additional interface inconsistencies: the local path ignores `--raw` while the API path preserves its transport wrapper; a missing cached document in strict-local mode can report `local Craft store unavailable (available)`.

Local content retrieval, SQL-side search filtering, and skipping unnecessary API/backlink requests are useful improvements. The implementation remains phase one of the proposed plan: grep, readable handles, outline/range/budget reads, and batch text edits are absent. Collection filtering adds convenient commands but hardcodes LABS-specific properties into a general-purpose table. The canonical installed craft-cli skill still describes document reads as API-only, unlike the bundled updated skill.

Prioritize source fidelity and consistent source/freshness contracts, then add grep and bounded reads before expanding the command surface further.
