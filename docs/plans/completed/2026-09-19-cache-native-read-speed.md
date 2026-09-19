# Speed up reads around Craft's existing cache

Status: complete, verified locally; not released

Decision: Craft Desktop's read-only cache is the source for ordinary local/auto reads. Use API when cache content is unavailable or when explicitly requested. Do not create a Markdown mirror, another content cache, or change Desktop-owned files.

The previous API/Markdown equality guard caused indefinite API fallback for valid but differently rendered cache entries. Remove that CLI-owned trust gate. Desktop owns synchronization; use `--source api` when a caller needs immediate remote read-after-write confirmation before Desktop catches up.

Ownership: parent removes the freshness gate and updates read contract/tests/docs; one Luna worker owns lazy command loading in `src/cli/main.ts`; a second owns bounded batch reads for `cat`. Preserve the bounded helper timeout and concurrent skill-library work.

Acceptance: full tests, typecheck, compiled binary; cache preferred even after writes; explicit API and no-cache fallback work; helper timeout preserved. Re-measure the preceding compiled binary and the new one on the same two documents, with normal auto and clean-local scenarios separated. Record measured changes without claiming parity with plain files.


## Delivery and acceptance

Removed the persistent freshness equality gate and mutation tracking introduced in the preceding improvement round. Ordinary eligible Markdown reads now prefer Desktop cache, including after writes. No Desktop files are modified. API remains the fallback for unavailable content and the explicit source for remote confirmation. Existing unused freshness metadata is left untouched and is no longer consulted.

Commands load on demand. `cat` resolves unique local document IDs through one bounded helper/store lifetime, preserves output order and duplicate arguments, and falls back per missing document. Helper isolation and timeout remain. Budget-only output avoids splitting or allocating an array for the entire document; full source retrieval is still required.

Parent replaced the worker's mapping-only tests with a subprocess CLI regression covering real fixture cache hits, duplicate ordering, a mixed API miss, and strict-local no-network rejection. Other regression coverage verifies cache ownership after mocked writes, explicit API, no-cache fallback, Markdown fidelity, source routing, and bounded output.

Verification: `bun test` 217 pass / 28 skip / 0 fail; `bun run typecheck`; `bun run build`; compiled help and agent-context; live read-only API smoke. API mutation behavior was tested with a mock server, not live document writes. Desktop stores are opened read-only. No installation or release was performed.

## Measurements

The before executable was preserved immediately before this round. Warm filesystem, fresh compiled process per sample, one excluded warmup. Thirty paired local measurements alternate executable order. Outputs were byte-identical in every compared case.

| Local read | Before median | After median | Reduction |
| --- | ---: | ---: | ---: |
| Medium, 15 KB | 59.96 ms | 58.43 ms | 2.6% |
| Large, 240 KB | 87.83 ms | 85.63 ms | 2.5% |
| Large, budget 2000 | 91.75 ms | 84.91 ms | 7.4% |
| Two cached documents with cat | 63.62 ms | 58.85 ms | 7.5% |

The small full-read differences are modest and should not be treated as robust gains across machines. An earlier sequential run had mixed local results, motivating the paired run; both raw records are retained.

The policy change has the larger practical effect: five ordinary auto reads per document changed from API fallback at 788.55/1088.57 ms to local reads at 59.74/91.22 ms. This is a source-selection change and accepts Desktop sync lag, not a 12–13x improvement to cache parsing.

Identical temporary Markdown files read by `cat` took 3.09/4.34 ms in this run. Earlier actual Obsidian note reads took 2.95/3.28 ms. Craft still pays for CLI and helper startup, profile resolution, SQLite ID lookup, JSON decoding, normalization, and interprocess transfer. No Markdown mirror or persistent daemon was introduced to eliminate those costs.

Raw samples: [paired local comparison](../../benchmarks/2026-09-19-cache-native-paired.json), [initial source/file comparison](../../benchmarks/2026-09-19-cache-native-speed.json). No document contents or credentials are stored in these artifacts.
