# craft-cli: agent-first, blazing-fast Craft I/O

Date: 2026-09-18
Status: proposed
Owner: craft-cli

## Outcome

Make Craft reads and writes as cheap as local markdown for an agent: same or
fewer tool calls, local latency for content, and no network round trips on the
hot path.

## Evidence baseline

Measured 2026-09-18 on the 1ar space (1670 docs, `cin OP` = 2010 blocks,
239,486 chars of markdown) and the LTM space (5 docs, `STM`).

| Operation | Current | Local ceiling | Gap |
|---|---|---|---|
| `docs get <id> --no-links` | 6.4s, 2 REST calls | 27ms (PTS markdown) | 237x |
| `docs get <id>` (default) | 10.0s, 3 REST calls | 27ms | 370x, 3 to 0 network calls |
| `docs search "cin"` | 0 results locally, 3.7s via API | 1.3ms (FTS5) | broken |
| `docs ls` | 0.30s local, 1.5s API | 27ms | acceptable |
| Vault-wide grep with line numbers | not implemented | ~250ms over 1632 PTS files | missing |
| `patch` (find text, replace) | 2 REST calls, 4 agent calls | 1 agent call | 4x |
| Batch write, N hunks | N calls | 1 call | Nx |

Supporting numbers from `docs/local-performance-results.md`: search 2271ms API
vs 1.3ms FTS5, get doc 4561ms API vs 0.7ms PTS, list all docs 1489ms API vs
26.7ms SQLite. Local stores update within about one second of an API write while
the Craft app runs.

## Root causes

1. `docs get` is API-only even though the local PlainTextSearch JSON already
   holds full markdown for 1632 of 1670 docs in the 1ar space (97.7 percent).
2. `src/cli/render.ts` fetches the block twice: JSON first to infer the title for
   backlinks, then markdown with a second accept header. With backlinks that is
   three REST calls per default read.
3. `LocalStore.search` in `src/lib/local-db.ts` applies `LIMIT 150` in SQL with
   no `ORDER BY`, then filters `entityType` in JavaScript. Popular terms fill all
   150 rows with block hits, so zero documents survive: `cin`, `film`, and `dog`
   all return 0 document matches while FTS5 has 1987, 267, and 19 rows.
4. `BlockSearch.content` is tokenized plain text with punctuation stripped, for
   example `App ID Prefix Team ID RJFBXYA3QK`. `findBlockByContent` uses
   `LIKE '%markdown%'`, so exact-text block lookup fails and cannot drive a local
   patch.
5. There is no vault-wide grep, no line-number addressing, no range read, no
   multi-doc read budget, and no batch write surface.

## Design

### 1. Local-first content reads

Serve full markdown from PlainTextSearch when available and fall back to the API
otherwise. Keep `docs get` as a compatible alias.

- Normalize PTS output: `markdownContent` omits the document title, which lives
  in a separate `title` field in lowercase. Render `# {title}` then the body.
- PTS uses `craftdocs://open?spaceId=...&blockId=...` deeplinks, which already
  fixes the `invalid:out_of_scope` problem seen on `cin OP` cross-space links.
  Keep them.
- Freshness: compare PTS `modified`, file mtime, and `contentHash`. Add `--fresh`
  and keep `--source api` as the authoritative escape hatch.
- Remove the double fetch in `render.ts`: render markdown from the JSON tree
  locally, or skip the JSON fetch when backlinks are not requested.

### 2. Vault-wide grep

`craft grep <pattern>` with ripgrep-shaped output: `docRef:line:match`, plus
`-C` context, `-n` line numbers, `--glob`, and `--limit`.

- Backed by a PTS text scan with a persistent line index for instant repeats.
- FTS5 remains the fast path for keyword-only queries.
- One agent call replaces `rg` plus `sed` plus `docs get`. This is the largest
  single tool-call saving.

### 3. Stable document handles

Derive a stable slug per document (`cin-op`, `labs-issues`) and addressable paths
for nested sections (`cin-op/architecture`), with a local name index.

- `craft read cin-op`, `craft grep "Clerk" cin-op`, `craft edit cin-op --old --new`.
- UUIDs stay accepted. Output prints the handle so the next call needs no lookup.
- Section paths let an agent reach one part of a 2676-line page without pulling
  the whole thing.

### 4. Read shaping for agents

- `--outline`: heading tree with line numbers and handles, no body.
- `--lines A:B`, `--head N`, `--budget N` with an explicit truncation marker.
- `--select` for JSON projection (already present).
- Default `--no-links`; backlinks stay opt-in because they are a faked
  title-based search and cost a network round trip.
- `craft cat a b c --budget 40k` for multi-document reads in one call.

### 5. One-call writes

`craft edit <ref> --old <text> --new <text>` resolves the target block inside the
CLI and spends one agent call.

- Resolution: local FTS token candidates, verify the exact block, then one
  `PUT /blocks`. The CLI absorbs the intermediate hops.
- Multiple hunks per call through a patch file, and multiple documents per call.
- `PUT /blocks` already accepts `blocks: BlockUpdate[]`, so N hunks in one
  document is one REST call. `blocks update` currently takes a single ID.
- `--expect-hash` for optimistic concurrency using the PTS `contentHash`.
- `--dry-run` available everywhere; `craft write <ref> --markdown -` for new
  content with auto-split.

### 6. Correctness fixes

- `LocalStore.search`: push the `entityType` filter into SQL, or drop the
  pre-filter `LIMIT`, and add `ORDER BY rank`.
- `findBlockByContent`: match on FTS tokens instead of `LIKE` on tokenized text.
- `render.ts`: eliminate the second block fetch.
- Deterministic ordering and consistent `--json` and `--select` behavior.

### 7. Agent contract

Update `skill/SKILL.md` and the `agent-context` manifest so agents discover
`grep`, `read`, and `edit` instead of composing `docs search` plus `docs get`
plus `blocks update`. Keep a task-to-command table in the skill so the
one-call path is the obvious one.

## Tool-call comparison

| Task | md plus fs tools | craft-cli today | craft-cli target |
|---|---|---|---|
| Find a phrase with context | `rg` (1) | `docs search` + `docs get` (2) | `craft grep` (1) |
| Read one document | `cat` (1) | `docs get` (1, 10s) | `craft read` (1, 30ms) |
| Edit one block by text | `apply_patch` (1) | search, get, blocks search, update (4) | `craft edit` (1) |
| Read 5 related documents | `cat a b c d e` (1) | 5x `docs get` (5) | `craft cat` (1) |
| Edit across 5 documents | 5x `apply_patch` (5) | 20 | `craft edit --patch-file` (1) |

## Constraints and risks

- PTS is read-only, Mac-only, and needs the Craft app running. About 2.3 percent
  of documents have no PTS file, so API fallback is required, not optional.
- PTS markdown is not byte-identical to API markdown. Normalization needs a
  fidelity test across a sample of documents before it becomes the default.
- Local text is tokenized, so it cannot reconstruct exact markdown. Writes must
  verify against the API before `PUT`.
- The Realm files hold the full block tree but are binary and undocumented.
  Depending on them is not worth the risk. A local mirror built from API reads is
  the safer path for block IDs.
- The LTM space is a shared index (`SearchIndex_<account>||<spaceId>.sqlite`),
  not a standalone space. Profile to index routing must cover composite
  namespaces, which the current exact-final-component selection already does.

## Sequencing

1. Correctness plus the largest win: fix local search, make `docs get`
   local-first via PTS, drop the double fetch.
2. Tool-call saver: `craft grep` and stable handles.
3. Write collapse: `craft edit` with multi-hunk and batch `PUT`.
4. Polish: outline, budget, and range flags, then skill and `agent-context`
   updates, then record benchmarks in `docs/`.

Each phase follows the repo standing rules: rebuild the binary, run `bun test`,
`bun run typecheck`, and update `skill/SKILL.md` on any surface change.
