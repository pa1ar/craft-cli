import { homedir } from "node:os";
import { join } from "node:path";
import { parseWithGlobals } from "../client-factory.ts";
import { loadConfig, resolveProfile, resolveSource, CONFIG_PATH } from "../config.ts";
import { probeLocalStoreSafe } from "../local-safe.ts";
import { bold, dim, err, jsonOutForArgs } from "../format.ts";

const JOURNAL_PATH = join(homedir(), ".cache", "craft-cli", "journal.db");

export async function runDoctor(argv: string[]): Promise<void> {
  const args = parseWithGlobals(argv);
  const cfg = await loadConfig();
  const source = resolveSource(cfg);
  const local = source.source === "api"
    ? { status: "skipped" as const, timeoutMs: 0 }
    : await probeLocalStoreSafe();

  let auth:
    | { ok: true; profile: string; source: "env" | "config"; url: string; spaceName?: string }
    | { ok: false; error: string };
  let api:
    | { ok: true; space: { id: string; name: string; timezone: string; friendlyDate?: string } }
    | { ok: false; error: string };

  try {
    const profile = await resolveProfile(typeof args.flags.profile === "string" ? args.flags.profile : undefined);
    auth = {
      ok: true,
      profile: profile.profileName,
      source: profile.authSource,
      url: profile.url,
      spaceName: profile.spaceName,
    };
    try {
      const { CraftClient } = await import("../../lib/client.ts");
      const client = new CraftClient({ url: profile.url, key: profile.key });
      const info = await client.connection();
      api = {
        ok: true,
        space: {
          id: info.space.id,
          name: info.space.name,
          timezone: info.space.timezone,
          friendlyDate: info.space.friendlyDate,
        },
      };
    } catch (e) {
      api = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } catch (e) {
    auth = { ok: false, error: e instanceof Error ? e.message : String(e) };
    api = { ok: false, error: "skipped: auth unavailable" };
  }

  const payload = {
    ok: auth.ok && api.ok && (source.source !== "local" || local.status === "available"),
    auth,
    api,
    source,
    local,
    paths: {
      config: CONFIG_PATH,
      journal: JOURNAL_PATH,
    },
    env: {
      CRAFT_URL: Boolean(process.env.CRAFT_URL),
      CRAFT_KEY: Boolean(process.env.CRAFT_KEY),
      CRAFT_PROFILE: process.env.CRAFT_PROFILE ?? null,
      CRAFT_SOURCE: process.env.CRAFT_SOURCE ?? null,
      CRAFT_MODE: process.env.CRAFT_MODE ?? null,
      CRAFT_LOCAL_PATH: process.env.CRAFT_LOCAL_PATH ?? null,
    },
  };

  if (args.flags.json) {
    console.log(jsonOutForArgs(payload, args.flags));
    if (!payload.ok) process.exitCode = 1;
    return;
  }

  console.log(`${bold("auth")}    ${auth.ok ? `ok (${auth.profile}, ${auth.source})` : err(`fail - ${auth.error}`)}`);
  console.log(`${bold("api")}     ${api.ok ? `ok (${api.space.name} / ${api.space.id})` : err(`fail - ${api.error}`)}`);
  console.log(`${bold("source")}  ${source.source} ${dim(`(${source.setting})`)}`);
  console.log(`${bold("local")}   ${local.status}`);
  console.log(`${bold("config")}  ${CONFIG_PATH}`);
  console.log(`${bold("journal")} ${JOURNAL_PATH}`);
  if (!payload.ok) process.exitCode = 1;
}
