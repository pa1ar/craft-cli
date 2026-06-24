# plan: craft skills and media analysis v1

Build demand-loaded `craft-cli` skills plus one bundled `media-analyze` skill. V1 is curated: bundled skills plus explicit local skills, OpenAI first, generic media analysis only, Craft-visible run state, useful artifacts written back under the source block.

## validation

- `bun test` — unit + existing test suite pass
- `bun run typecheck` — TypeScript clean
- `bun run build` — compiled `dist/craft` includes new command surface
- `craft --help` and `craft skills --help` — help reflects new commands

## constraints

- Work on branch `feat/craft-skills-media`.
- Keep `src/lib/client.ts` and public library exports Node/Raycast-safe; Bun-only runner/media code stays CLI-side.
- Skills execute as subprocesses, not imports.
- Skill code returns structured output; `craft-cli` owns Craft writes and journal/undo integration.
- No remote/community install flow in v1.
- No arbitrary top-level aliases; only curated alias `craft media analyze`.
- Default media cost cap: EUR 1 per run.
- Store useful artifacts in Craft: final analysis, transcript, contact sheet, metadata JSON. Raw intermediate files stay cache-local.

## context

Existing agent discovery is single-skill: repo `skill/SKILL.md`, `craft agent-context`, and `craft which`. Command handlers live in `src/cli/commands/`; CLI-only code can use Bun APIs. Craft block writes already go through `client.blocks.append/insert/update` and command-level journaling.

## tasks

### 1. skills registry and manifest validation

files:
- create: `src/cli/skills/registry.ts`, `src/cli/skills/manifest.ts`
- create: `skills/media-analyze/manifest.json`, `skills/media-analyze/SKILL.md`
- test: `tests/unit/skills-manifest.test.ts`, `tests/unit/skills-registry.test.ts`

done: manifest + registry unit tests pass

[x] define manifest shape for name, description, tags, commands, permissions, artifacts, entry script
notes: `src/cli/skills/manifest.ts`

[x] discover bundled skills from repo `skills/` and local skills from `~/.craft-cli/skills`
notes: `src/cli/skills/registry.ts`

[x] implement keyword search over manifest name, description, tags, commands
notes: manifest keyword scoring

[x] validate bundled skill requirements: `manifest.json`, `SKILL.md`, `scripts/`, `examples/`, `tests/`
notes: `validateBundledSkill`

### 2. skills command group and curated media alias

files:
- create: `src/cli/commands/skills.ts`, `src/cli/commands/media.ts`
- modify: `src/cli/main.ts`, `src/cli/commands/agent-context.ts`, `src/cli/commands/which.ts`
- test: `tests/unit/skills-command.test.ts`, `tests/unit/media-command.test.ts`

done: command routing tests pass and help output documents `skills` + `media analyze`

[x] add `craft skills ls/search/show/validate/run`
notes: `src/cli/commands/skills.ts`

[x] add `craft media analyze <blockId>` as alias for `craft skills run media-analyze analyze <blockId>`
notes: `src/cli/commands/media.ts`

[x] update command discovery via `agent-context` and `which`
notes: added skills/media entries

[x] keep human output compact and `--json` machine-readable
notes: command handlers use `jsonOutForArgs`

### 3. skill runner and Craft write-back contract

files:
- create: `src/cli/skills/runner.ts`, `src/cli/skills/writes.ts`
- modify: `src/cli/commands/skills.ts`
- test: `tests/unit/skills-runner.test.ts`

done: fake skill subprocess tests pass, including proposed writes and failure output

[x] execute skill entry as subprocess with structured JSON stdin
notes: `runSkillSubprocess`

[x] parse structured JSON stdout with status, markdown, artifacts, metrics, proposed writes
notes: `SkillRunOutput`

[x] apply proposed Craft writes in CLI layer only
notes: `applyProposedWrites`

[x] create/update Craft-visible run block for started, partial, failed, complete states
notes: `createSkillRunBlock` / `finishSkillRunBlock`

[x] enforce `--estimate` and `--max-cost`, default EUR 1 cap
notes: manifest estimate guard

### 4. bundled media-analyze skill

files:
- create: `skills/media-analyze/scripts/analyze.ts`
- create: `skills/media-analyze/examples/video.input.json`, `skills/media-analyze/examples/video.output.md`
- create: `skills/media-analyze/tests/media-analyze.test.ts`
- test: `tests/unit/media-analyze.test.ts`

done: media skill tests pass with mocked download, ffmpeg, and OpenAI calls

[x] fetch source block/doc context and extract media URLs from block JSON/markdown
notes: CLI passes context; skill extracts URLs

[x] download media into cache and collect metadata
notes: `~/.cache/craft-cli/media-analyze`

[x] for video: extract audio, transcript, sampled frames/contact sheet metadata
notes: ffmpeg/ffprobe path with partial warnings

[x] run generic OpenAI analysis
notes: OpenAI Responses API

[x] return final analysis, transcript, contact sheet, metadata JSON, model/cost metadata
notes: structured artifacts

[x] handle missing OpenAI key, missing ffmpeg/ffprobe, unsupported media, and oversized/cost-capped runs
notes: missing key/media fail; ffmpeg warnings partial; cap enforced

### 5. docs, skill reference, and release hygiene

files:
- modify: `README.md`, `skill/SKILL.md`, `CHANGELOG.md`
- modify: `src/cli/main.ts`
- test: existing suite

done: docs updated and full validation passes

[x] update README command reference and AI install/discovery notes
notes: skills section added

[x] update repo `skill/SKILL.md` with skills/media usage
notes: skill runtime contract added

[x] update help text and changelog
notes: `src/cli/main.ts`, `CHANGELOG.md`

[x] run `bun test`, `bun run typecheck`, `bun run build`
notes: pass with `PATH=/Users/pavel/.bun/bin:$PATH`

[x] inspect final diff for unrelated changes
notes: no `src/lib/index.ts` / `src/lib/client.ts` changes; temp test dirs removed

## appendix: raw input

not implementation spec. preserved for intent/history. do not rewrite.

### initial request

````text
PLEASE IMPLEMENT THIS PLAN:
# Craft CLI Skills + Media Analysis V1

## Summary

Build `craft-cli` “skills” as a demand-loaded, file-first automation layer, plus one bundled `media-analyze` skill. V1 is for reviewed bundled skills and explicit local skills only. It uses OpenAI first, generic media analysis only, writes results/artifacts back to Craft under the source block, and protects runs with estimate + €1 default cap.

## Key Changes

- Add `craft skills` command group:
  - `craft skills ls`
  - `craft skills search <query>`
  - `craft skills show <name>`
  - `craft skills validate <path|name>`
  - `craft skills run <name> <command> [...args]`
- Add curated alias:
  - `craft media analyze <blockId>`
  - Equivalent to bundled `media-analyze` skill.
- Skill discovery:
  - Bundled skills live in repo.
  - Local skills live in `~/.craft-cli/skills`.
  - Search is manifest keyword search over name, description, commands, and tags.
- Skill structure:
  - `SKILL.md` = agent-facing usage and policy.
  - `manifest.json` = machine-readable commands, permissions, inputs, outputs.
  - `scripts/` = runnable automation.
  - `examples/` and `tests/` required for bundled skills.
- Runtime:
  - Execute skills as subprocesses, not imports.
  - CLI passes structured JSON context to stdin.
  - Skill returns structured JSON result.
  - Craft writes are performed by `craft-cli`, not directly by arbitrary skill code.

## Media Analyze Behavior

- `craft media analyze <blockId>`:
  - Fetches source Craft block/doc.
  - Finds Craft-hosted or externally embedded media.
  - Downloads media to temp/cache.
  - For video: extract metadata, audio, transcript, sampled frames/contact sheet.
  - Runs generic OpenAI-backed analysis.
  - Writes a Craft-visible run block under the source block before expensive work starts.
  - Updates the run block with status, final analysis, transcript, contact sheet, metadata JSON, model/cost metadata, and failure/partial status if needed.
- Artifact policy:
  - Store useful artifacts in Craft: final analysis, transcript, contact sheet, metadata JSON.
  - Keep raw intermediate files local unless a later flag adds raw uploads.
- Cost policy:
  - Default per-run cap: €1.
  - Add `--estimate`, `--max-cost <amount>`, and clear failure if estimated/actual work would exceed cap.
- Output:
  - Generic analysis only in v1.
  - No boxing/meeting/etc. profiles yet.

## Tests

- Unit tests:
  - Skill manifest validation.
  - Bundled + local skill discovery.
  - Keyword search ranking basics.
  - Command routing for `craft skills run` and `craft media analyze`.
  - Permission/manifest errors.
  - Cost cap rejection.
- Skill runner tests:
  - Fake skill subprocess receives expected JSON context.
  - Proposed Craft writes are applied by CLI layer.
  - Failed skill produces partial/failure run block.
- Media skill tests:
  - Mock media download/ffmpeg/OpenAI calls.
  - Verify output includes analysis, transcript, contact sheet reference, metadata JSON.
- Existing gates:
  - `bun test`
  - `bun run typecheck`
  - `bun run build`
  - Update `README.md`, `skill/SKILL.md`, help text, and `CHANGELOG.md`.

## Assumptions And Defaults

- Work in `/Users/pavel/dev/tools/craft-cli`; create branch `feat/craft-skills-media` before edits.
- Public name is `skills`, not extensions.
- V1 ecosystem stance: curated bundled skills first, explicit local skills allowed, no remote/community install flow.
- OpenAI is the only AI provider for v1; provider abstraction deferred.
- Craft-visible run block is the run ledger for v1; no local run DB yet.
- No semantic search in v1; manifest keyword search is enough.
- No arbitrary top-level aliases; only curated aliases owned by core CLI.
````

### brainstorm notes

````text
create doc for that plan, and launch a thread for implementation in craft-cli project 
````
