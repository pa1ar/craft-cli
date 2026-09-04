# Local Craft media workflows

Craft issue: 1SS-623

## Outcome

Make Craft-hosted images, videos, and files usable as local inputs, prefer local originals for analysis, and replace media safely through the supported upload API.

## Scope

- Resolve a media block through Craft's `OnDeviceAssets/index.json`, preferring an existing full asset over previews.
- Add `craft media local <blockId> [--all]` with human and JSON output.
- Make `craft media analyze <blockId>` pass the local full asset to the bundled analyzer when present, otherwise retain the signed-URL fallback.
- Add `craft media replace <blockId> <file>`: validate the source media block, upload before it, fetch and verify the new block, then delete the old block. Never edit Craft-managed files in place.
- Align public block types and wording with the already-synced 2026-09-04 Craft OpenAPI/product snapshot where directly relevant.
- Update CLI help, bundled skill, tests, and changelog.

## Verification

- Passed 163 unit tests with 28 credential-gated integration tests skipped.
- Passed `bun run typecheck`, `bun run build`, and bundled skill validation.
- Resolved known local image and video blocks to their full on-device files.
- Replaced an image in a disposable Craft document through the live API, verified the new block and removal of the old block, then moved the document to Trash.

## Ownership

Unrelated collection-item work is already present in `src/cli/main.ts`, `src/lib/index.ts`, `src/cli/commands/collections.ts`, `skill/SKILL.md`, and associated new files. Preserve it and stage only media/API-alignment hunks owned by 1SS-623.
