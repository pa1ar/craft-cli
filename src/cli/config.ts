// config.json at ~/.config/craft-cli/config.json, mode 0600.
// bun-only (uses Bun.file + node:fs chmod).
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface Profile {
  url: string;
  key: string;
  spaceName?: string;
  spaceId?: string;
}

export type Source = "auto" | "api" | "local";
export type Mode = "hybrid" | "api";

export interface Config {
  default: string;
  profiles: Record<string, Profile>;
  /** canonical read source. absent = "auto" (local when available, else API). */
  source?: Source;
  /** legacy read mode. "hybrid" maps to source "auto". kept for existing configs. */
  mode?: Mode;
}

export type SourceSetting = "env" | "config" | "legacy-env" | "legacy-config" | "default";

export interface ResolvedSource {
  source: Source;
  setting: SourceSetting;
  legacyMode?: Mode;
}

export interface ResolvedMode {
  mode: Mode;
  source: "env" | "config" | "default";
}

export function normalizeSource(value: string | undefined): Source | undefined {
  const raw = value?.trim().toLowerCase();
  if (raw === "auto" || raw === "api" || raw === "local") return raw;
  if (raw === "hybrid") return "auto";
  if (raw === "live") return "api";
  return undefined;
}

export function sourceToLegacyMode(source: Source): Mode {
  return source === "api" ? "api" : "hybrid";
}

/** resolve source with precedence:
 * CRAFT_SOURCE env > CRAFT_MODE legacy env > cfg.source > cfg.mode legacy > "auto".
 * per-command --source/--api precedence is handled by command args. */
export function resolveSource(cfg: Config | null): ResolvedSource {
  const sourceEnv = normalizeSource(process.env.CRAFT_SOURCE);
  if (sourceEnv) {
    return { source: sourceEnv, setting: "env" };
  }
  const envRaw = process.env.CRAFT_MODE?.trim().toLowerCase();
  if (envRaw === "api" || envRaw === "hybrid") {
    return { source: normalizeSource(envRaw)!, setting: "legacy-env", legacyMode: envRaw };
  }
  const cfgSource = normalizeSource(cfg?.source);
  if (cfgSource) {
    return { source: cfgSource, setting: "config" };
  }
  if (cfg?.mode === "api" || cfg?.mode === "hybrid") {
    return { source: normalizeSource(cfg.mode)!, setting: "legacy-config", legacyMode: cfg.mode };
  }
  return { source: "auto", setting: "default" };
}

/** legacy helper kept for tests/callers that still speak `mode`. */
export function resolveMode(cfg: Config | null): ResolvedMode {
  const resolved = resolveSource(cfg);
  const mode = sourceToLegacyMode(resolved.source);
  const source = resolved.setting === "env" || resolved.setting === "legacy-env"
    ? "env"
    : resolved.setting === "config" || resolved.setting === "legacy-config"
      ? "config"
      : "default";
  return { mode, source };
}

export const CONFIG_PATH = join(homedir(), ".config", "craft-cli", "config.json");

export async function loadConfig(): Promise<Config | null> {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const text = await Bun.file(CONFIG_PATH).text();
    return JSON.parse(text) as Config;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  chmodSync(CONFIG_PATH, 0o600);
}

export interface Resolved {
  url: string;
  key: string;
  profileName: string;
  spaceName?: string;
  authSource: "env" | "config";
}

/** Resolve active profile with priority:
 * 1. explicit --profile flag name from caller
 * 2. CRAFT_URL + CRAFT_KEY env (ephemeral, no profile name)
 * 3. CRAFT_PROFILE env
 * 4. config.default
 */
export async function resolveProfile(explicit?: string): Promise<Resolved> {
  const envUrl = process.env.CRAFT_URL;
  const envKey = process.env.CRAFT_KEY;
  if (envUrl && envKey) {
    return { url: envUrl, key: envKey, profileName: "env", authSource: "env" };
  }

  const cfg = await loadConfig();
  if (!cfg) {
    throw new Error(
      `no config at ${CONFIG_PATH}. run: craft setup --url <URL> --key <KEY>`
    );
  }

  const name = explicit ?? process.env.CRAFT_PROFILE ?? cfg.default;
  const profile = cfg.profiles[name];
  if (!profile) {
    throw new Error(`profile "${name}" not found. available: ${Object.keys(cfg.profiles).join(", ")}`);
  }
  return { url: profile.url, key: profile.key, profileName: name, spaceName: profile.spaceName, authSource: "config" };
}
