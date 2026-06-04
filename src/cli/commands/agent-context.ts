import { parseWithGlobals } from "../client-factory.ts";
import { loadConfig, resolveSource } from "../config.ts";
import { jsonOutForArgs } from "../format.ts";

export async function runAgentContext(argv: string[]): Promise<void> {
  const args = parseWithGlobals(argv);
  const cfg = await loadConfig();
  const source = resolveSource(cfg);
  const payload = {
    name: "craft-cli",
    purpose: "Agent-first CLI for Craft Docs reads, writes, search, tasks, uploads, and local-first PKM workflows.",
    defaults: {
      source: "auto",
      sourceMeaning: "read local Craft Desktop cache when available; fall back to API",
      output: "concise text by default, JSON with --json, projection with --select",
    },
    current: {
      source,
      defaultProfile: cfg?.default ?? null,
      profiles: cfg ? Object.keys(cfg.profiles) : [],
    },
    env: {
      CRAFT_URL: "with CRAFT_KEY, bypasses saved config",
      CRAFT_KEY: "with CRAFT_URL, bypasses saved config",
      CRAFT_PROFILE: "default saved profile name",
      CRAFT_SOURCE: "auto|api|local runtime source override",
      CRAFT_LOCAL_PATH: "override local Craft database discovery",
    },
    commands: [
      { command: "doctor", use: "verify auth, API, source, and local store status" },
      { command: "source", use: "show or set read source: auto|api|local" },
      { command: "docs search", use: "vault-wide document search" },
      { command: "docs get", use: "fetch a document as markdown or JSON" },
      { command: "docs daily", use: "fetch daily note" },
      { command: "blocks append", use: "append markdown to a document or daily note" },
      { command: "patch", use: "find and replace one matching block" },
      { command: "tasks add", use: "create task in inbox, daily note, or document" },
      { command: "upload", use: "upload file and insert image/video/document block" },
      { command: "links in", use: "reconstruct backlinks" },
      { command: "cat", use: "read multiple docs" },
      { command: "diff", use: "compare current doc to last journal snapshot" },
      { command: "undo", use: "revert last CLI mutation where possible" },
      { command: "which", use: "map capability words to commands" },
    ],
    exitCodes: {
      "0": "ok",
      "1": "user error",
      "2": "api error",
      "3": "auth",
      "4": "not found",
    },
  };
  console.log(jsonOutForArgs(payload, { ...args.flags, json: true }));
}
