# Craft task explorer and filters

Linear: LABS-262

## Outcome

Craft tasks are fully discoverable from the CLI. `craft tasks` and `craft tasks ls` retrieve the live space-wide `scope=all` result by default, preserve the existing API scopes, and add local filters for practical agent exploration.

## API findings

- The live Craft API accepts `GET /tasks?scope=all` even though the checked-in OpenAPI spec and public docs omit it.
- The live `1ar` response currently exposes task state, schedule date, deadline date, location, repeat configuration, and repeat reminder configuration.
- The API does not currently expose a native task priority field. Priority filtering is forward-compatible with a future `priority` field, and JSON metadata reports `priorityAvailable: false` while it is absent.

## Delivered

1. Added `all` to the public task scope and made it the default for `craft tasks`, `craft tasks ls`, and the library list method.
2. Added composable filters for state, document ID/title, location, text, schedule/deadline/date ranges, repeat, reminder/notification, overdue tasks, native priority, and result limits.
3. Kept filtering local after one API call so filters compose without depending on undocumented server query parameters.
4. Expanded human table output and structured JSON metadata.
5. Switched update/delete journal snapshots to the space-wide task result.
6. Added task moving plus `none` date clearing to `tasks update`.
7. Added unit and live integration coverage; updated help, README, skill guidance, command discovery, agent context, and Unreleased changelog.

## Filter contract

- `--state todo|done|canceled`
- `--doc ID` for an exact document ID
- `--document TEXT` for a case-insensitive document-title match
- `--location inbox|document|daily`
- `--text TEXT` for a case-insensitive task-content match
- `--date DATE`, `--date-from DATE`, `--date-to DATE` across schedule, deadline, or daily-note date
- `--scheduled DATE`, `--scheduled-from DATE`, `--scheduled-to DATE`
- `--deadline DATE`, `--deadline-from DATE`, `--deadline-to DATE`
- `--repeat yes|no`
- `--reminder yes|no` with `--notification` as an alias
- `--priority VALUE` for a native priority field when present; `none` selects tasks without one
- `--overdue` and `--limit N`

Dates accept `YYYY-MM-DD`, `today`, `yesterday`, and `tomorrow`. `--scheduled none` and `--deadline none` select tasks without those fields.

## Verification

- `bun test tests/unit`: 142 passed.
- Credentialed task library integration: live default `scope=all` passed.
- Credentialed task CLI integration: live composed filter test passed.
- Full credentialed integration: 26 passed; one unrelated document-search test remained red because Craft search did not index a newly created marker within the polling window.
- `bun run typecheck`, `bun run build`, and `git diff --check`: passed.
- Installed `~/.local/bin/craft` resolves to the rebuilt `dist/craft`; SHA-256 hashes match.
- Live `1ar` verification retrieved 1,492 tasks, including 328 open tasks, and correctly filtered document, unscheduled, reminder, priority-capability, and dry-run move cases.
