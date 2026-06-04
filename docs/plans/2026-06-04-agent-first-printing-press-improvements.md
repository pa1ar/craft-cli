# craft-cli: agent-first Printing Press improvements

## Outcome

Make craft-cli more agent-native while keeping local-first Craft Desktop reads.

## Tasks

[x] source model
notes: canonical `source auto|api|local`; keep `mode`/`--api` compat; default auto = local if available, API fallback.

[x] doctor
notes: `craft doctor [--json]`; auth source, profile, API reachability, local status, source, journal/config paths.

[x] agent context
notes: `craft agent-context`; stable JSON manifest for commands, capabilities, env, source/auth state.

[x] capability router
notes: `craft which <capability>`; map common intents to commands.

[x] agent-efficient output
notes: add global `--select` for JSON projection; keep default output concise and parseable.

[x] write previews
notes: extend `--dry-run` beyond patch/undo where cheap and safe.

[x] docs/tests
notes: update skill, help, tests; run build/typecheck/test.

## Questions

- none
