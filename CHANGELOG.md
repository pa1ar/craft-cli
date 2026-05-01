# Changelog

All notable changes to craft-cli are recorded here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

Each commit should be one change, scoped enough to land in a single line here.

## [Unreleased]

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

[Unreleased]: https://github.com/pa1ar/craft-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pa1ar/craft-cli/releases/tag/v0.1.0
