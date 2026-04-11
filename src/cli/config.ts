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

export type Mode = "hybrid" | "api";

export interface Config {
  default: string;
  profiles: Record<string, Profile>;
  /** read mode. absent = "hybrid" (default). "api" disables local store reads. */
  mode?: Mode;
}

export type ModeSource = "env" | "config" | "default";

export interface ResolvedMode {
  mode: Mode;
  source: ModeSource;
}

/** resolve mode with precedence: CRAFT_MODE env > cfg.mode > "hybrid".
 * per-command --api flag precedence is handled at call sites (local.ts forceApi). */
export function resolveMode(cfg: Config | null): ResolvedMode {
  const envRaw = process.env.CRAFT_MODE?.trim().toLowerCase();
  if (envRaw === "api" || envRaw === "hybrid") {
    return { mode: envRaw, source: "env" };
  }
  if (cfg?.mode === "api" || cfg?.mode === "hybrid") {
    return { mode: cfg.mode, source: "config" };
  }
  return { mode: "hybrid", source: "default" };
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
    return { url: envUrl, key: envKey, profileName: "env" };
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
  return { url: profile.url, key: profile.key, profileName: name, spaceName: profile.spaceName };
}
