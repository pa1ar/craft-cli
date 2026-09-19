# Remote Craft skill library

Date: 2026-09-19
Status: completed
Craft issue: 8d9b14d7-3e1a-1115-6746-176c6f37f48f

## Outcome

Implement the first delivery slice from the verified second opinion: remote metadata discovery, selected skill retrieval, and non-overwriting single-file export. Retain existing local automation commands.

## Ownership

- Luna worker: new Node-compatible library adapter and focused unit tests.
- Parent: CLI dispatch/commands, export handling, skill and agent discovery docs, integration tests and verification.
- Preserve all pre-existing dirty changes. No release, remote skill publication, collection migration, or engineering-skill overwrite.

## Contract

`craft lib list|get|export --collection ID` always reads the selected API connection. Normal catalog rows require kind=skill, status=published, a stable valid name, and a nonempty description. Explicit legacy and draft inspection switches support migration without silently publishing old prompts. Strip all body previews from catalog output. Resolve get through the same validated catalog. Reject unsupported supporting resources instead of producing incomplete portable exports. Hash exact generated SKILL.md bytes; do not call this a multi-file package version.

## Acceptance

- Mock API checks prove shallow catalog reads, field projection, catalog membership, safe rendering and export refusal on existing destinations.
- Full tests, typecheck, compiled binary build and CLI checks.
- Read-only live catalog check against the original Connect. Existing incomplete rows must be diagnosed, not modified or published.
- Update bundled skill and canonical craft-cli guidance so agents can find the new commands.
- Record runtime evidence and known limits here; archive this plan when complete.

## Verification and delivery

- One native worker completed the core adapter and six focused tests. Runtime metadata records OpenAI gpt-5.6-luna, reasoning high, session 01a0ba85-2dce-7270-8f59-eb8d60c1c08e. Parent reviewed and integrated it; worker stopped after handoff.
- Four CLI integration tests passed, covering shallow metadata output, credential isolation for public URLs, scoped get, exact export hashes, dry run, existing files/directories/symlinks, and explicit source/collection errors.
- Typecheck passed. Full `bun test` passed with 226 tests passing, 28 live-credential-gated tests skipped, and zero failures. Live integration credentials were unset to avoid unrelated API writes.
- Compiled binary built, macOS signature verified, and help/command discovery operated.
- Live compiled-binary GET requests against the original Connect: strict catalog 0 accepted/0 rejected (rows lack kind); explicit legacy inspection 0 accepted/11 rejected, all missing descriptions. No previews emitted. No Craft skill schema/content/publication or profile configuration was changed.
- Existing rows cannot yet serve as published skills. Metadata preparation and publication need a separate deliberate round; no descriptions were invented.
- Text/code/separator exports only; inline Craft markup/links preserved. Supporting files, nested pages, link rewriting, plugin archives, native installation and fresh-agent activation are not implemented or claimed.
- Updated canonical `/Users/pavel/dev/skills/craft-cli/SKILL.md` in place; preserved symlinks and existing skill ownership. Read install.sh end to end; no dependencies, installer behavior, or binary location changed.
- Concurrent read-shaping/freshness changes remained untouched. An initial typecheck error in the concurrent markdown-cli test was corrected by its owner before the passing check.
- Work left uncommitted for review because the checkout contains concurrent mixed edits. No release or push performed.
