// `craft mode [api|hybrid]` - show or persist the read mode.
// precedence (documented in status output): --api flag > CRAFT_MODE env > config.mode > hybrid
import { parseWithGlobals } from "../client-factory.ts";
import { loadConfig, saveConfig, resolveMode, type Mode, type ResolvedMode } from "../config.ts";
import { getLocalStore, setModeOverride } from "../local.ts";
import { bold, dim, err } from "../format.ts";

const VALID: readonly Mode[] = ["api", "hybrid"];

function isMode(v: string | undefined): v is Mode {
  return v === "api" || v === "hybrid";
}

interface StatusPayload {
  mode: Mode;
  source: ResolvedMode["source"];
  /** true only if a local Craft store is actually reachable right now.
   * in hybrid mode on a host without Craft installed this is false, even
   * though the mode permits local reads — the CLI falls through to API. */
  readsLocal: boolean;
  reads: string;
  writes: string;
  override: string;
}

function buildStatus(resolved: ResolvedMode): StatusPayload {
  const isApi = resolved.mode === "api";
  // in hybrid mode, probe for an actual local store so the report reflects
  // what will really happen on the next read command. in api mode, skip the
  // probe entirely — getLocalStore() would short-circuit to null anyway.
  const localAvailable = !isApi && getLocalStore() !== null;
  let reads: string;
  if (isApi) {
    reads = "API only - local Craft store is not consulted";
  } else if (localAvailable) {
    reads = "local Craft store (hybrid, local store detected)";
  } else {
    reads = "API (hybrid, but no local Craft store found on this host)";
  }
  return {
    mode: resolved.mode,
    source: resolved.source,
    readsLocal: localAvailable,
    reads,
    writes: "API (journal at ~/.cache/craft-cli/journal.db still records for undo/log/diff)",
    override: isApi
      ? "CRAFT_MODE=hybrid <cmd>  (runtime override)"
      : "CRAFT_MODE=api <cmd>  or  --api flag on individual read commands",
  };
}

function printStatus(payload: StatusPayload, headline?: string): void {
  if (headline) console.log(headline);
  console.log(`${bold("mode")}     ${payload.mode}  ${dim(`(source: ${payload.source})`)}`);
  console.log(`${bold("reads")}    ${payload.reads}`);
  console.log(`${bold("writes")}   ${payload.writes}`);
  console.log(`${bold("override")} ${payload.override}`);
}

export async function runMode(argv: string[]): Promise<void> {
  const args = parseWithGlobals(argv);
  const target = args.positional[0];

  // no arg -> show current effective mode
  if (!target) {
    const cfg = await loadConfig();
    const resolved = resolveMode(cfg);
    const payload = buildStatus(resolved);
    if (args.flags.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    printStatus(payload);
    return;
  }

  if (!isMode(target)) {
    console.error(err(`unknown mode: ${target}`));
    console.error(`usage: craft mode [${VALID.join("|")}]`);
    process.exit(1);
  }

  // persist to config
  const cfg = await loadConfig();
  if (!cfg) {
    console.error(err(`no config. run: craft setup --url URL --key KEY first`));
    process.exit(1);
  }

  cfg.mode = target;
  saveConfig(cfg);

  // report the effective mode after write. env var still wins, so
  // resolveMode may disagree with what we just persisted - surface that honestly.
  const resolved = resolveMode(cfg);
  // main.ts seeded the singleton from the OLD config before dispatch. sync it
  // to the newly-resolved mode so buildStatus()'s getLocalStore() probe reflects
  // the state the user just set, not the state they just replaced.
  setModeOverride(resolved.mode);
  const payload = buildStatus(resolved);

  if (args.flags.json) {
    console.log(JSON.stringify({ ...payload, persisted: target }, null, 2));
    return;
  }

  if (resolved.source === "env" && resolved.mode !== target) {
    printStatus(
      payload,
      `persisted config.mode = ${target}, but CRAFT_MODE env overrides to ${resolved.mode}:`
    );
    return;
  }
  printStatus(payload, `mode set to ${bold(target)}`);
}
