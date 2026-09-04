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
      sourceMeaning: "keep auto on macOS: eligible reads use Craft Desktop's cache first, then fall back to API",
      output: "concise text by default, JSON with --json, projection with --select",
    },
    readRouting: {
      rule: "Do not force --api for ordinary macOS reads. Keep source=auto unless the task explicitly needs authoritative remote state.",
      localFirst: [
        "docs ls without location/folder/date/metadata filters",
        "docs search without --include, --fetch-blocks, folder/location, or document IDs",
        "media local for an on-device image/video/file asset",
      ],
      api: [
        "docs get, docs daily, blocks, tasks, collections, and links",
        "filtered or fetch-blocks document queries",
        "all writes",
      ],
      fallback: "source=auto falls back to API when a local read is unavailable or ineligible",
      verify: "craft source --json; craft doctor --json reports local availability",
    },
    currentApiCoverage: {
      supported: [
        "collection view CRUD and active view",
        "space-wide tasks with scope=all",
        "page styling and separator block fields",
        "typed media upload, local resolution, analysis, and safe replacement",
      ],
      appOnlyWithoutDocumentedRest: [
        "editable inline tags",
        "arbitrary custom colors",
        "Daily Notes range export",
      ],
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
      CRAFT_ON_DEVICE_ASSETS_PATH: "override Craft OnDeviceAssets discovery",
    },
    commands: [
      { command: "doctor", use: "verify auth, API, source, and local store status" },
      { command: "source", use: "show or set read source: auto|api|local" },
      { command: "docs search", use: "vault-wide document search" },
      { command: "docs get", use: "fetch a document as markdown or JSON" },
      { command: "docs daily", use: "fetch daily note" },
      { command: "blocks append", use: "append markdown to a document or daily note" },
      { command: "patch", use: "find and replace one matching block" },
      { command: "tasks", use: "list all space tasks; filter by state, document, date, repeat, or reminder" },
      { command: "tasks add", use: "create task in inbox, daily note, or document" },
      { command: "col views", use: "list/create/update/delete collection view configuration and active view" },
      { command: "upload", use: "upload file and insert image/video/document block" },
      { command: "links in", use: "reconstruct backlinks" },
      { command: "cat", use: "read multiple docs" },
      { command: "diff", use: "compare current doc to last journal snapshot" },
      { command: "undo", use: "revert last CLI mutation where possible" },
      { command: "which", use: "map capability words to commands" },
      { command: "skills ls/search/show/validate/run", use: "discover and run bundled/local automation skills" },
      { command: "media analyze <blockId>", use: "curated alias for media-analyze skill with EUR 1 default cap" },
      { command: "media local <blockId>", use: "resolve a Craft media block to an existing on-device full asset" },
      { command: "media replace <blockId> <file>", use: "upload and verify replacement before deleting the old media block" },
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
