# craft-cli: explicit API-only mode (Linux support)

## Context

craft-cli today has a hybrid read architecture: `docs ls` and `docs search` read from Craft's local SQLite/PlainTextSearch stores when available and fall back to the API. Local discovery is macOS-only by default (paths inside `~/Library/Containers/com.lukilabs.lukiapp*`) but `getLocalStore()` already returns `null` gracefully when discovery fails — so on Linux the CLI *technically* works today via fallback.

Why add an explicit mode anyway:
- Skip discovery attempts entirely on machines where Craft is not installed (clarity + tiny perf).
- Avoid binding to a stale local store if a Linux user has leftover files / a weird `CRAFT_LOCAL_PATH` override.
- Give AI agents a one-shot switch they can set once per environment instead of remembering `--api` on every read.
- Leave room for future divergence (e.g., different journal behavior in api-only contexts).

Hybrid stays the default. The journal (`~/.cache/craft-cli/journal.db`) is already cross-platform and keeps working in either mode — `undo`, `log`, `diff` are unaffected.

## Architecture decisions

**Mode is top-level config, not per-profile.** Rationale: mode is a machine property ("does this host have Craft installed?"), not a credentials property. A user won't realistically want different modes across profiles on the same machine. Keeps the schema flat.

**Precedence (highest wins):**
1. `--api` flag on individual command (already exists on `docs ls`/`docs search`)
2. `CRAFT_MODE=api|hybrid` env var (runtime override, useful for CI/Docker)
3. `config.mode` field (persisted default)
4. `hybrid` (hard default when nothing is set)

**Surgical surface.** Only two files hold behavior: `src/cli/config.ts` (schema + getter) and `src/cli/local.ts` (`getLocalStore` honors mode). No per-command edits needed — `docs ls`/`docs search` already route through `getLocalStore()` and handle `null` correctly.

**Command shape:** `craft mode [api|hybrid]` — no arg prints current state + source (config/env/default). Matches the shape of `craft profiles use`.

## Files to modify

### 1. `src/cli/config.ts`
- Extend `Config` interface with `mode?: "hybrid" | "api"` (optional for backward compat with existing configs).
- Add `export type Mode = "hybrid" | "api"`.
- Add helper: `export function resolveMode(cfg: Config | null): { mode: Mode; source: "flag" | "env" | "config" | "default" }` that reads `CRAFT_MODE` env and `cfg.mode`. (Flag precedence handled at call site since it's per-command.)

### 2. `src/cli/local.ts`
- `getLocalStore({ forceApi })` currently short-circuits on `forceApi`. Extend the short-circuit to also trigger when env or config says api-only.
- Read env + config once at module init (avoid per-call `loadConfig`). Since `loadConfig` is async and `getLocalStore` is sync, read `CRAFT_MODE` env synchronously and accept an already-resolved config mode passed through `getLocalStore({ forceApi, modeFromConfig })`. Simpler alternative: have `main.ts` resolve mode once at startup and export a module-level setter — see note below.

  **Chosen approach:** add a sync `setModeOverride(mode: Mode)` to `src/cli/local.ts`, called once by `main.ts` after it resolves mode from config + env. Avoids plumbing the mode through every command handler.

### 3. `src/cli/main.ts`
- Before dispatching subcommands, resolve effective mode:
  - If `CRAFT_MODE` set → use it.
  - Else load config (already cheap; `whoami`/`setup` already do it) and read `cfg.mode`.
  - Else hybrid.
- Call `setModeOverride(resolved)` on the local singleton.
- Add `mode` to the command switch → `runMode(rest)`.
- Update the `HELP` block:
  - Add `mode [api|hybrid]` under Setup section.
  - Add `CRAFT_MODE` to env overrides section.
  - Tweak `--api` description to mention it overrides the persistent mode.

Config load must not error for commands that don't need it (e.g., fresh machine running `craft setup`). Wrap in try/catch — on failure treat as no-config, mode=default.

### 4. `src/cli/commands/mode.ts` (NEW)
Mirror `profiles.ts` shape:
```
craft mode                  # show current mode + source + what it means
craft mode api              # set to api-only, persist to config
craft mode hybrid           # set to hybrid, persist to config
craft mode --json           # machine-readable current state
```
- No arg → print:
  ```
  mode     api  (source: config)
  reads    API only — local Craft store is not consulted
  writes   API (journal at ~/.cache/craft-cli/journal.db still records for undo/log/diff)
  override CRAFT_MODE=hybrid  or  --api flag on individual commands
  ```
- `api` / `hybrid` → `loadConfig()`, set `cfg.mode`, `saveConfig(cfg)`, print confirmation + the same status block.
- If no config exists, print clear error: `"no config. run: craft setup --url URL --key KEY first"` and exit 1. (Config file is where we persist mode — setup has to run first.)
- `--json` outputs `{ mode, source, readsLocal: boolean }`.

The non-interactive response format is important — this is what the agent relays to the user. Design the output so a single `craft mode api` call tells the agent (a) the new state, (b) that it's persisted, (c) that journal still works, (d) how to temporarily override.

### 5. `src/cli/commands/docs.ts`
No changes. The existing `getLocalStore({ forceApi: !!args.flags.api })` call will now internally also respect the mode override set by `main.ts`. The `--api` flag still works as a per-command override (forceApi wins over everything).

### 6. `README.md` + `CLAUDE.md`
- README: new "Mode" section under Setup explaining hybrid vs api-only, when to use which, env var.
- Project CLAUDE.md: add one line to the non-obvious list about the mode flag precedence.

### 7. `~/.claude/skills/craft-cli/SKILL.md`
Per the standing rule ("after any CLI surface change: update the craft-cli skill"). Add:
- `craft mode` to the command reference.
- Note about `CRAFT_MODE` env var.
- Note that on Linux or non-Craft machines, agents should run `craft mode api` once after `craft setup`.

## Tests

All unit tests, no integration tests (integration already uses API-only commands).

### `tests/unit/config.test.ts` (extend if exists, else new)
- Round-trip `Config` with `mode: "api"` through save/load.
- Existing config without `mode` field still loads (backward compat).

### `tests/unit/local.test.ts` (new)
- `getLocalStore({ forceApi: true })` → `null`. (Already implicit, make explicit.)
- After `setModeOverride("api")`, `getLocalStore()` → `null` without calling `discoverLocalStore`. Mock or stub discovery and assert it is not invoked.
- After `setModeOverride("hybrid")`, normal discovery runs.
- `setModeOverride` can be called multiple times (for test isolation).
- `CRAFT_MODE=api` env var is NOT read inside `local.ts` itself — it's read in `main.ts` and passed in. Test that the override mechanism is the single source of truth inside `local.ts` to keep it simple.

### `tests/unit/mode-command.test.ts` (new)
- `runMode(["api"])` writes `mode: "api"` to a temp config path (mock `CONFIG_PATH` via env or dependency injection — check existing pattern in `config.test.ts`).
- `runMode([])` prints the current state to stdout; capture and assert on format.
- `runMode(["--json"])` emits valid JSON with `mode`, `source`, `readsLocal`.
- Exit 1 with clear message when no config exists.
- Invalid mode arg (e.g., `craft mode offline`) exits 1 with usage string.

### Main dispatch
- `tests/unit/main.test.ts` if it exists — verify `mode` is registered. Otherwise rely on integration smoke via `bun run build && dist/craft mode`.

## Backward compatibility

- Existing configs without `mode` field → treated as `hybrid` (current behavior). No migration needed.
- Raycast extension consumes `src/lib/index.ts` only, which doesn't touch mode/local/journal. No lib changes → Raycast unaffected.
- `--api` flag keeps its current semantics and precedence.

## Verification

1. **Build + static checks**
   ```
   bun run build
   bun run typecheck
   bun test
   ```

2. **Happy path on macOS (hybrid default stays intact)**
   ```
   dist/craft mode                    # -> hybrid (source: default)
   dist/craft docs ls                 # -> "(local)" tag in dim output
   dist/craft docs search foo         # -> "(local)" tag
   ```

3. **Persist api mode**
   ```
   dist/craft mode api                # -> confirmation + status block
   dist/craft mode                    # -> api (source: config)
   dist/craft docs ls                 # -> no "(local)" tag, API path
   dist/craft docs search foo         # -> no "(local)" tag
   cat ~/.config/craft-cli/config.json  # -> "mode": "api"
   ```

4. **Env override**
   ```
   CRAFT_MODE=hybrid dist/craft mode  # -> hybrid (source: env)
   CRAFT_MODE=hybrid dist/craft docs ls  # -> (local) tag back
   dist/craft mode                    # -> api (still persisted)
   ```

5. **Journal still works in api mode**
   ```
   dist/craft mode api
   dist/craft blocks append <doc> --markdown "test"
   dist/craft log                     # -> shows the append
   dist/craft undo --dry-run          # -> shows planned reversal
   ```

6. **Reset**
   ```
   dist/craft mode hybrid
   ```

7. **Linux smoke (if a box is available)** — `CRAFT_URL=... CRAFT_KEY=... dist/craft mode api && dist/craft docs ls` completes without touching any macOS paths. Otherwise simulate by unsetting `CRAFT_LOCAL_PATH` and renaming Containers dir temporarily (skip — too risky; rely on unit test that stubs discovery).

8. **Skill sanity check** — open `~/.claude/skills/craft-cli/SKILL.md`, grep for `mode`, confirm the new command is documented with example output.

## Out of scope

- Per-profile mode. (Deferred until someone actually has multiple profiles with mixed mode needs on one machine.)
- Auto-detect "Craft not installed, switch to api-only silently." Keep hybrid default; don't surprise users.
- Adding `--api` to commands that don't have local paths. It's a no-op on API-only commands; not worth the noise.
- Refactoring the journal to be mode-aware. Journal stays always-on.
