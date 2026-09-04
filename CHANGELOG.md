# Changelog

All notable changes to craft-cli are recorded here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

Each commit should be one change, scoped enough to land in a single line here.

## [Unreleased]

### Changed
- Agent-facing skill, README, CLI help, and `agent-context` now make local-first read routing explicit, distinguish local-capable commands from REST-only operations, and document current Craft API coverage without claiming app-only features.

## [0.6.0] - 2026-09-04

### Added
- Local Craft media workflows: `craft media local` resolves on-device full assets, analysis prefers them over downloads, and `craft media replace` performs a verified upload-before-delete swap.

### Changed
- Media uploads now infer common image, video, audio, and PDF content types.
- Public block types now include the latest Craft page styling and separator fields from the 2026-09-04 upstream OpenAPI snapshot.
- Retries now add jitter when Craft does not return `Retry-After`, matching current API guidance.

## [0.5.1] - 2026-08-27

### Changed
- Agent skill discovery now honors user-declared canonical skill locations and otherwise directs agents to register the bundled skill in their active harness; attribution guidance uses the harness-neutral `#by/ai` tag and preserves exact/source-only content when requested.

### Fixed
- macOS builds now re-sign and verify the completed Bun executable, preventing invalid Mach-O signatures from causing an immediate exit 137; the installer also refuses to link a binary that cannot launch.

## [0.5.0] - 2026-07-18

### Added
- Space-wide task exploration: `craft tasks` now uses the live `scope=all` endpoint by default and supports composable filters for state, document, location, text, dates, repeat, reminders/notifications, overdue tasks, native priority, and result limits; task updates can also move tasks and clear dates with `none`.

## [0.4.0] - 2026-06-29

### Added
- Collection view commands: `craft col views` can list, create, update, delete, and activate table/gallery/kanban view definitions.

## [0.3.0] - 2026-06-24

### Added
- MIT `LICENSE` file. `package.json` now declares `license: MIT` and adds `author`, `repository`, `homepage`, `bugs` fields - npm-publishable shape.
- Agent-first CLI improvements: `craft source`, `doctor`, `agent-context`, `which`, JSON `--select`, and broader write-command `--dry-run` previews.
- Demand-loaded `craft skills` command group plus bundled `media-analyze` skill and `craft media analyze <blockId>` alias.

### Changed
- `craft whoami` and `craft doctor` now use short health-check timeouts instead of waiting through long default API retries on stalled `/connection` calls.
- README: unaffiliated/unofficial disclaimer near the top.
- README: "For AI agents" section collapsed into a single paste-to-AI install block. Mirrored on https://1ar.io/projects/craft-cli (see CLAUDE.md "Sync with 1ar.io" rule).

## [0.2.0] - 2026-05-01

### Fixed
- `client.blocks.insert` no longer auto-marks `r.craft.do` media blocks as `uploaded: true`. Those URLs are signed and time-limited; storing them with `uploaded: true` meant the asset displayed "not available" once the signature rotated. The API now re-fetches and re-signs on insert.

### Changed
- `normalizeCraftMediaBlocks` is now an opt-in helper. It still injects `uploaded: true` + a default `mimeType` for `r.craft.do` blocks, but you only get that behavior if you call it explicitly.

### Internal
- Dropped obsolete `remotion/` entry from `.gitignore`.

## [0.1.0] - 2026-05-01

Baseline public release.

### Added
- Bun-compiled single binary CLI wrapping the Craft Docs REST API.
- Hybrid mode: local SQLite + PlainTextSearch reads, REST writes.
- API-only mode for Linux / headless / hosts without the Craft desktop app.
- Mutation journal (`~/.cache/craft-cli/journal.db`) with `craft cat`, `craft diff`, `craft log`, `craft undo`.
- `craft patch` find-and-replace at block granularity.
- Backlink reconstruction on document fetch via title-based search + `block://` URI filtering.
- TypeScript library export at `@1ar/craft-cli/lib` for Raycast and Node consumers.
- Agent skill bundle at `skill/SKILL.md`; `install.sh` symlinks to `~/.claude/skills/craft-cli` when present.
- Demo GIF in README.

[Unreleased]: https://github.com/pa1ar/craft-cli/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/pa1ar/craft-cli/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/pa1ar/craft-cli/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/pa1ar/craft-cli/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/pa1ar/craft-cli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pa1ar/craft-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pa1ar/craft-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pa1ar/craft-cli/releases/tag/v0.1.0
