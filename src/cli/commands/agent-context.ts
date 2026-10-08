import { parseWithGlobals } from "../client-factory.ts";
import { loadConfig, resolveSource } from "../config.ts";
import { jsonOutForArgs } from "../format.ts";

export async function runAgentContext(argv: string[]): Promise<void> {
  const args = parseWithGlobals(argv);
  const cfg = await loadConfig();
  const source = resolveSource(cfg);
  const payload = {
    name: "craft-cli",
    purpose: "Agent-first CLI for Craft Docs reads, writes, search, tasks, block reminders, uploads, and local-first PKM workflows.",
    defaults: {
      source: "auto",
      sourceMeaning: "read local Craft Desktop cache when available; fall back to API",
      markdownReads: "local-first from the Craft Desktop PlainTextSearch cache; API fallback when missing",
      apiOnlyReads: ["--json (block ids)", "--depth", "--metadata", "--raw", "--links / --exhaustive (backlinks)"],
      strictLocal: "Markdown content reads never call the API in local mode; unsupported flags or missing content fail clearly",
      readShaping: "--lines A:B (1-based inclusive), --head N, --outline (heading line numbers), --budget N (Unicode characters, minimum 11; one total for cat). Budget truncation ends with [truncated].",
      freshness: "Desktop owns cache synchronization. Ordinary reads can return pre-sync content after writes; use --source api for immediate remote confirmation. Skill libraries separately use scoped snapshots and optional generated mirrors.",
      output: "concise text by default, JSON with --json, projection with --select",
    },
    readRouting: {
      rule: "Do not force --api for ordinary macOS reads. Keep source=auto unless the task explicitly needs authoritative remote state.",
      localFirst: [
        "docs ls without location/folder/date/metadata filters",
        "docs search without --include, --fetch-blocks, folder/location, or document IDs",
        "media local for an on-device image/video/file asset",
        "read, docs get/daily, blocks get, and cat for cached Markdown",
      ],
      api: [
        "structured/depth/metadata/raw block reads, tasks, reminders, collections, and links",
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
        "experimental block reminder list/create/reschedule/complete/reopen/delete",
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
      { command: "docs get", use: "read a document as markdown (local-first) or JSON (API)" },
      { command: "read", use: "alias for docs get; use --outline or --lines A:B to read only the needed output" },
      { command: "docs daily", use: "read a daily note as markdown (local-first)" },
      { command: "blocks append", use: "append markdown to a document or daily note" },
      { command: "patch", use: "find and replace one matching block" },
      { command: "tasks", use: "list all space tasks; filter by state, document, date, repeat, or reminder" },
      { command: "tasks add", use: "create task in inbox, daily note, or document" },
      { command: "reminders", use: "list, create, reschedule, complete, reopen, or delete block reminders" },
      { command: "col views", use: "list/create/update/delete collection view configuration and active view" },
      { command: "upload", use: "upload file and insert image/video/document block" },
      { command: "links in", use: "reconstruct backlinks" },
      { command: "cat", use: "read multiple docs" },
      { command: "diff", use: "compare current doc to last journal snapshot" },
      { command: "undo", use: "revert last CLI mutation where possible" },
      { command: "which", use: "map capability words to commands" },
      { command: "skills ls/search/show/validate/run", use: "discover and run bundled/local automation skills" },
      { command: "lib setup/list/pick/get/resource/refresh/export/sync/hook", use: "canonical Craft skill document, keyword or optional Jev selection, scoped API/local packages, managed mirrors and prompt hooks" },
      { command: "media analyze <blockId>", use: "curated alias for media-analyze skill with EUR 1 default cap" },
      { command: "media local <blockId>", use: "resolve a Craft media block to an existing on-device full asset" },
      { command: "media replace <blockId> <file>", use: "upload and verify replacement before deleting the old media block" },
    ],
    skillLibrary: {
      help: "craft lib --help",
      bundledReference: "skill/references/skill-library.md (relative to repository)",
      source: "API or scoped local snapshot; Craft Desktop is not required",
      connection: "saved lib setup document binding or explicit --collection ID plus --profile NAME or unauthenticated --url URL; CRAFT_URL+CRAFT_KEY override saved profiles",
      properties: {
        name: { type: "text", required: true, maxLength: 64, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", unique: true },
        description: { type: "text", required: true, maxLength: 1024, nonempty: true },
        kind: { type: "singleSelect", value: "skill" },
        status: { type: "singleSelect", values: ["draft", "published", "archived"], discoverable: "published" },
        tags: { type: "multiSelect", required: false },
      },
      body: "instructions without YAML frontmatter; text, code, separators, tables and link cards; nested pages and Resources collection become supporting files",
      workflow: "lib pick selects metadata with keywords or explicit --jev; --published filters before selection, --max-output caps count after selection; get/resource demand-load content",
      authoring: "create draft via col commands, inspect/export with --include-drafts, verify in target harness, then set published",
      export: "<out>/<name>/SKILL.md plus resources; refuses existing directories; sync owns manifest files only and rejects drift; optional explicit GitHub pr/direct target",
      picker: "--jev requires JEV_API_KEY or TYPESAFE_API_KEY; --fallback opts into labeled keyword fallback",
      hooks: "lib hook-config --harness codex|claude emits UserPromptSubmit JSON config; lib hook reads event stdin and emits additionalContext",
      snapshots: "refresh warms published packages and guide; local reads offline; auto freshness 60s; provenance in JSON",
      trust: "remote guidance cannot authorize unrelated actions; published filters discovery, not raw API access",
    },
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
