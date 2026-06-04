// `craft source [auto|api|local]` - show or persist the read source.
// `craft mode [api|hybrid]` is a legacy alias.
import { parseWithGlobals } from "../client-factory.ts";
import {
  loadConfig,
  saveConfig,
  resolveSource,
  normalizeSource,
  sourceToLegacyMode,
  type Source,
  type ResolvedSource,
  type Mode,
} from "../config.ts";
import { setSourceOverride } from "../local.ts";
import { probeLocalStoreSafe, type LocalProbeStatus } from "../local-safe.ts";
import { bold, dim, err, jsonOutForArgs } from "../format.ts";

const VALID: readonly Source[] = ["auto", "api", "local"];

function isSource(v: string | undefined): v is Source {
  return v === "auto" || v === "api" || v === "local";
}

interface StatusPayload {
  source: Source;
  setting: ResolvedSource["setting"];
  legacyMode: Mode;
  /** true only if a local Craft store is actually reachable right now.
   * in auto mode on a host without Craft installed this is false, and
   * the CLI falls through to API. */
  readsLocal: boolean;
  reads: string;
  writes: string;
  override: string;
}

async function buildStatus(resolved: ResolvedSource): Promise<StatusPayload> {
  const isApi = resolved.source === "api";
  // in auto/local mode, probe from a helper process so a stuck local filesystem
  // or sqlite call cannot hang `craft source`. in api mode, skip the probe.
  const localStatus: LocalProbeStatus = isApi
    ? "unavailable"
    : (await probeLocalStoreSafe()).status;
  const localAvailable = localStatus === "available";
  let reads: string;
  if (isApi) {
    reads = "API only - local Craft store is not consulted";
  } else if (resolved.source === "local" && localAvailable) {
    reads = "local Craft store only";
  } else if (resolved.source === "local" && localStatus === "timeout") {
    reads = "local only (probe timed out; read commands fail instead of API fallback)";
  } else if (resolved.source === "local" && localStatus === "error") {
    reads = "local only (probe failed; read commands fail instead of API fallback)";
  } else if (resolved.source === "local") {
    reads = "local only (no local Craft store found; read commands fail)";
  } else if (localAvailable) {
    reads = "local Craft store (auto, local store detected)";
  } else if (localStatus === "timeout") {
    reads = "API (auto local probe timed out; reads fall back to API)";
  } else if (localStatus === "error") {
    reads = "API (auto local probe failed; reads fall back to API)";
  } else {
    reads = "API (auto, but no local Craft store found on this host)";
  }
  return {
    source: resolved.source,
    setting: resolved.setting,
    legacyMode: sourceToLegacyMode(resolved.source),
    readsLocal: localAvailable,
    reads,
    writes: "API (journal at ~/.cache/craft-cli/journal.db still records for undo/log/diff)",
    override: isApi
      ? "CRAFT_SOURCE=auto <cmd>  or  --source auto on individual read commands"
      : "CRAFT_SOURCE=api <cmd>  or  --source api / --api on individual read commands",
  };
}

function printStatus(payload: StatusPayload, headline?: string): void {
  if (headline) console.log(headline);
  console.log(`${bold("source")}   ${payload.source}  ${dim(`(setting: ${payload.setting})`)}`);
  console.log(`${bold("legacy")}   mode ${payload.legacyMode}`);
  console.log(`${bold("reads")}    ${payload.reads}`);
  console.log(`${bold("writes")}   ${payload.writes}`);
  console.log(`${bold("override")} ${payload.override}`);
}

export async function runSource(argv: string[]): Promise<void> {
  const args = parseWithGlobals(argv);
  const target = args.positional[0];

  // no arg -> show current effective source
  if (!target) {
    const cfg = await loadConfig();
    const resolved = resolveSource(cfg);
    const payload = await buildStatus(resolved);
    if (args.flags.json) {
      console.log(jsonOutForArgs(payload, args.flags));
      return;
    }
    printStatus(payload);
    return;
  }

  const source = normalizeSource(target);
  if (!isSource(source)) {
    console.error(err(`unknown source: ${target}`));
    console.error(`usage: craft source [${VALID.join("|")}]`);
    process.exit(1);
  }

  // persist to config
  const cfg = await loadConfig();
  if (!cfg) {
    console.error(err("no config. run: craft setup --url URL --key KEY first"));
    process.exit(1);
  }

  cfg.source = source;
  delete cfg.mode;
  saveConfig(cfg);

  // report the effective source after write. env var still wins, so
  // resolveSource may disagree with what we just persisted - surface that honestly.
  const resolved = resolveSource(cfg);
  setSourceOverride(resolved.source);
  const payload = await buildStatus(resolved);

  if (args.flags.json) {
    console.log(jsonOutForArgs({ ...payload, persisted: source }, args.flags));
    return;
  }

  if ((resolved.setting === "env" || resolved.setting === "legacy-env") && resolved.source !== source) {
    printStatus(
      payload,
      `persisted config.source = ${source}, but env overrides to ${resolved.source}:`
    );
    return;
  }
  printStatus(payload, `source set to ${bold(source)}`);
}

export async function runMode(argv: string[]): Promise<void> {
  const target = argv[0];
  if (!target) {
    await runSource(argv);
    return;
  }
  if (target === "api") {
    await runSource(["api", ...argv.slice(1)]);
    return;
  }
  if (target === "hybrid") {
    await runSource(["auto", ...argv.slice(1)]);
    return;
  }
  console.error(err(`unknown mode: ${target}`));
  console.error("usage: craft mode [api|hybrid]");
  process.exit(1);
}
