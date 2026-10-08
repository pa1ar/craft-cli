import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { CraftClient } from "../../lib/client.ts";
import { renderLibraryBlock, type LibraryListResult } from "../../lib/skill-library.ts";
import { pickSkills } from "../../lib/skill-picker.ts";
import { resourcePath, hash } from "../../lib/skill-packages.ts";
import { buildClient, parseWithGlobals } from "../client-factory.ts";
import { readStdin } from "../args.ts";
import { jsonOutForArgs, table } from "../format.ts";
import { sourceFromArgs } from "../source.ts";
import { LibraryStore, readBinding, writeBinding, libraryScope, libraryStateRoot, atomicJSON, type LibraryBinding } from "../library-store.ts";
import { generation, syncLocal, syncGitHub } from "../library-sync.ts";

const HELP = `craft lib — canonical Craft skills, picker and mirrors

  lib setup --document ID [--collection ID] [--create] [--guide IDS]
            [--out DIR] [--github OWNER/REPO --branch main --repo-path skills --publish pr|direct]
  lib status [--json]
  lib list [--include-drafts] [--json]
  lib pick "request" [--published] [--max-output 5] [--jev] [--fallback]
           [--content] [--budget 24000] [--json]
  lib get <name|itemId> [--include-drafts] [--json]
  lib resource <name|itemId> <relative-path> [--json]
  lib guide [--json]
  lib refresh [--include-drafts] [--json]
  lib export <name|itemId> --out DIR [--dry-run] [--json]
  lib sync [--out DIR] [--github OWNER/REPO --branch main --repo-path skills --publish pr|direct]
           [--dry-run] [--json]
  lib hook --harness codex|claude [--jev] [--fallback] [--budget 24000]
  lib hook-config --harness codex|claude [--jev] [--fallback]

Use a saved binding or explicit --collection ID. Private: craft setup --url URL --key KEY,
then --profile NAME. Public --url URL never sends saved/environment credentials.
--url and --profile cannot combine. CRAFT_URL+CRAFT_KEY override saved profiles.
Read modes --source auto|api|local use one normalized model. auto reads a scoped
snapshot for 60s; --max-age SECONDS changes it. local is snapshot-only and reports
uncached content. refresh warms full published packages and guide for offline use.
API mode needs no Craft Desktop. Publication always re-reads complete API content.

The selected document has one skills collection and optional guide blocks outside it.
Required properties: name (unique kebab-case, <=64), description (1..1024), kind
(skill), status (draft|published|archived). tags is optional. setup --create creates
an empty schema; existing incompatible schemas require explicit col schema edits.
Instructions live in item bodies without YAML. Tables and nested reference pages
are supported. Resources collection: path, kind (text|script|file); text is a body,
script is exactly one code block, file exactly one attachment. Attachments elsewhere
become assets/<fileName>. Missing/unsupported content stops complete publication.

list/get/export stay published-only; pick without --published includes validated
published/draft/archived rows. --max-output is skill count, applied after selection.
Jev requires JEV_API_KEY or TYPESAFE_API_KEY; metadata + request go to TypeSafe.
Its key alone never enables it. --fallback explicitly permits labeled keyword fallback.
--content injects whole bodies within a character budget; overflow returns a load
command. References load with resource (JSON base64 for binary). No code is executed.

sync owns only files recorded in .craft-skills.json; local edits cause a conflict.
Local destination and GitHub target are independent. GitHub uses gh auth (contents
write, plus pull_requests write for pr mode); default pr, direct must be configured.
No-op sync creates no files or commit. Local replaced folders have recovery archives.
--dry-run does not publish. Rejected published rows stop sync, preserving prior output.
Hook reads UserPromptSubmit JSON from stdin and returns additionalContext. Configure
it using hook-config output in harness hooks.json/settings.json. Keep this library
outside native discovery paths for hook mode; native mirror mode is an alternative.
craft skills remains the separate local automation runner.
`;
const required = [
  { name: "name", key: "name", type: "text" },
  { name: "description", key: "description", type: "text" },
  { name: "kind", key: "kind", type: "singleSelect", options: [{ name: "skill", color: "gray" }] },
  { name: "status", key: "status", type: "singleSelect", options: ["draft", "published", "archived"].map(name => ({ name, color: "gray" })) },
];
function positive(value: unknown, fallback: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error("numeric limits must be non-negative integers"); return n;
}
function target(flags: Record<string, any>, binding?: LibraryBinding): LibraryBinding["github"] {
  if (!flags.github) return binding?.github;
  if (!/^[\w.-]+\/[\w.-]+$/.test(flags.github)) throw new Error("--github requires OWNER/REPO");
  const mode = flags.publish ?? "pr";
  if (mode !== "pr" && mode !== "direct") throw new Error("--publish expects pr|direct");
  if (!flags.branch) throw new Error("--github requires explicit --branch");
  const path = flags["repo-path"] ?? "skills"; if (path) resourcePath(path);
  return { repo: flags.github, branch: flags.branch, path, mode };
}
async function runLibInternal(argv: string[]): Promise<void> {
  const args = parseWithGlobals(argv, { flags: {
    collection: { type: "string" }, document: { type: "string" }, guide: { type: "string" }, url: { type: "string" }, out: { type: "string" },
    github: { type: "string" }, branch: { type: "string" }, "repo-path": { type: "string" }, publish: { type: "string" },
    harness: { type: "string" }, create: { type: "boolean" }, legacy: { type: "boolean" }, "include-drafts": { type: "boolean" },
    published: { type: "boolean" }, jev: { type: "boolean" }, fallback: { type: "boolean" }, content: { type: "boolean" },
    "max-output": { type: "number" }, budget: { type: "number" }, "max-age": { type: "number" }, help: { type: "boolean", alias: "h" },
  } });
  if (args.flags.help || !argv.length) { console.log(HELP); return; }
  const [command, reference, path, ...extra] = args.positional;
  if (!["setup", "status", "guide", "list", "ls", "pick", "get", "resource", "refresh", "export", "sync", "hook", "hook-config"].includes(command ?? "")) throw new Error("usage: craft lib (see --help)");
  if (extra.length || path && command !== "resource" || reference && !["get", "resource", "export", "pick"].includes(command!)) throw new Error("unexpected positional argument (see craft lib --help)");
  if (["get", "resource", "export", "pick"].includes(command!) && !reference) throw new Error(`lib ${command} requires a reference or request`);
  if (args.flags.url && args.flags.profile) throw new Error("use either --url or --profile, not both");
  const client = args.flags.url ? new CraftClient({ url: args.flags.url, key: "" }) : (await buildClient(args, command === "hook" ? { timeoutMs: 3000, retries: 0 } : {})).client;
  const binding = await readBinding(client);
  const executable = Bun.main.includes("$bunfs") ? process.execPath : Bun.which("craft") ?? "craft";
  const connectionArgs: string[] = args.flags.url ? ["--url", args.flags.url] : args.flags.profile ? ["--profile", args.flags.profile] : [];
  const shell = (parts: string[]) => parts.map(s => `'${s.replace(/'/g, `'"'"'`)}'`).join(" ");
  const output = (value: any) => console.log(args.flags.json ? jsonOutForArgs(value, args.flags) : JSON.stringify(value, null, 2));
  if (command === "setup") {
    if (!args.flags.document) throw new Error("setup requires --document ID");
    if (sourceFromArgs(args) === "local") throw new Error("setup requires API access");
    const doc: any = await client.blocks.get(args.flags.document, { maxDepth: 1, format: "json" });
    if (doc?.type !== "page") throw new Error("--document must reference a Craft page");
    const collections = await client.collections.list(args.flags.document);
    let collection = args.flags.collection;
    let createdHere = false;
    if (!collection) {
      if (collections.items.length === 1) collection = collections.items[0]!.id;
      else if (collections.items.length > 1) throw new Error("multiple collections: select --collection ID");
      else if (args.flags.create) {
        if (args.flags["dry-run"]) { output({ document: args.flags.document, wouldCreate: { name: "Skills", properties: required } }); return; }
        const created = await client.collections.create({ name: "Skills", contentPropDetails: { name: "Title", key: "title" }, properties: [...required, { name: "tags", key: "tags", type: "multiSelect", options: [] }] }, { pageId: args.flags.document, position: "end" });
        collection = created.collectionBlockId; createdHere = true;
      } else throw new Error("no collection found: use --create or prepare it with craft col");
    }
    if (!collections.items.some(c => c.id.toLowerCase() === collection.toLowerCase()) && !createdHere) throw new Error("collection does not belong to the selected document");
    const schema = await client.collections.getSchema(collection, "schema");
    for (const prop of required) if (!schema.properties?.some((p: any) => (p.key ?? p.name).toLowerCase() === prop.key && p.type === prop.type)) throw new Error(`collection requires ${prop.key} (${prop.type}); use craft col schema to migrate explicitly`);
    const guides = args.flags.guide ? String(args.flags.guide).split(",").map(s => s.trim()).filter(Boolean) : [];
    for (const id of guides) if (!doc.content?.some((b: any) => b.id.toLowerCase() === id.toLowerCase() && b.type !== "collection")) throw new Error("--guide IDs must be direct blocks outside the document collection");
    const same = binding?.document.toLowerCase() === args.flags.document.toLowerCase() && binding?.collection.toLowerCase() === collection.toLowerCase();
    const next: LibraryBinding = { ...(same ? binding : {}), document: args.flags.document, collection, guide: args.flags.guide ? guides : same ? binding?.guide : [], out: args.flags.out ? resolve(args.flags.out) : same ? binding?.out : undefined, github: target(args.flags, same ? binding : undefined) };
    if (!args.flags["dry-run"]) await writeBinding(client, next);
    output({ binding: next, dryRun: args.flags["dry-run"] }); return;
  }
  if (command === "status") { output({ binding: binding ?? null, scope: libraryScope(client), source: sourceFromArgs(args), freshnessSeconds: positive(args.flags["max-age"], 60) }); return; }
  const collection = args.flags.collection ?? binding?.collection;
  if (!collection) throw new Error("--collection ID is required, or bind a document with craft lib setup");
  if (command === "hook-config") {
    if (!["codex", "claude"].includes(args.flags.harness)) throw new Error("--harness expects codex|claude");
    const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
    const flags = [executable, "lib", "hook", "--harness", args.flags.harness, "--collection", collection];
    if (args.flags.url) flags.push("--url", args.flags.url); else if (args.flags.profile) flags.push("--profile", args.flags.profile);
    for (const flag of ["source", "max-age", "max-output", "budget"]) if (args.flags[flag] !== undefined) flags.push(`--${flag}`, String(args.flags[flag]));
    if (args.flags.jev) flags.push("--jev"); if (args.flags.fallback) flags.push("--fallback");
    const handler: Record<string, unknown> = { type: "command", command: flags.map(quote).join(" "), timeout: 20 };
    if (args.flags.harness === "codex") handler.additionalContextLimit = positive(args.flags.budget, 24000) + positive(args.flags["max-output"], 5) * 1200 + 2000;
    const config = { hooks: { UserPromptSubmit: [{ hooks: [handler] }] } };
    console.log(JSON.stringify(config, null, 2)); return;
  }
  if (["sync", "refresh"].includes(command!) && args.flags.source === "local") throw new Error(`${command} requires a complete API refresh; use --source api`);
  const store = new LibraryStore(client, collection, command === "sync" || command === "refresh" ? "api" : sourceFromArgs(args), positive(args.flags["max-age"], 60), Boolean(args.flags.legacy), Boolean(args.flags["include-drafts"]));
  const bound = binding?.collection.toLowerCase() === collection.toLowerCase() ? binding : undefined;
  const fullCatalog = await store.catalog(command === "refresh" || command === "sync", ["refresh", "sync", "hook"].includes(command!) ? bound : undefined);
  const all = command === "pick" && !args.flags.published || args.flags["include-drafts"];
  const catalog: LibraryListResult = { items: fullCatalog.items.filter(e => all || e.status === "published" || args.flags.legacy && e.status === "legacy"), rejected: fullCatalog.rejected.filter(e => all || e.status === "published" || !e.status || !["draft", "archived"].includes(e.status)) };
  if (command === "list" || command === "ls") {
    if (args.flags.json) output({ ...catalog, revision: store.revision(), provenance: store.provenance });
    else { console.log(table(catalog.items, ["id", "name", "description", "status"])); for (const row of catalog.rejected) console.error(`${row.id} (${row.title}): ${row.reason}`); }
    return;
  }
  if (command === "guide" || command === "refresh") {
    if (command === "guide" && !binding) throw new Error("guide requires a document binding");
    const guide = binding ? await store.guide(binding) : "";
    if (command === "guide" && !args.flags.json) console.log(guide);
    else output({ collection, items: catalog.items.length, guide, revision: store.revision(), provenance: store.provenance });
    return;
  }
  if (command === "sync") {
    if (catalog.rejected.length) throw new Error(`refusing sync: ${catalog.rejected.length} invalid skill rows; inspect lib list --json`);
    const out = args.flags.out ? resolve(args.flags.out) : binding?.out;
    const github = target(args.flags, binding);
    if (!out && !github) throw new Error("sync requires --out DIR or a configured GitHub target");
    const packages = []; for (const e of catalog.items) packages.push(await store.skill(e.id));
    const generated = generation(packages, hash(JSON.stringify([client.url, collection.toLowerCase()])));
    const result: any = { revision: hash(JSON.stringify(generated.manifest)), local: null, github: null };
    // Independent targets: each reports success; a failed second target retains retryable state.
    if (out) result.local = await syncLocal(generated, out, Boolean(args.flags["dry-run"]));
    if (github) result.github = await syncGitHub(generated, github, Boolean(args.flags["dry-run"]));
    output(result); return;
  }
  if (command === "pick" || command === "hook") {
    let event: any;
    if (command === "hook") {
      if (!["codex", "claude"].includes(args.flags.harness)) throw new Error("--harness expects codex|claude");
      const stdin = await readStdin(); if (stdin.length > 1024 * 1024) throw new Error("hook input too large");
      event = JSON.parse(stdin); if (event.hook_event_name && event.hook_event_name !== "UserPromptSubmit") throw new Error("hook expects UserPromptSubmit");
    }
    const request = command === "hook" ? event.prompt : reference;
    if (typeof request !== "string") throw new Error("hook requires a prompt string");
    const candidates = command === "hook" ? { ...catalog, items: fullCatalog.items.filter(e => e.status === "published") } : catalog;
    const result: any = await pickSkills(candidates, request, { maxOutput: positive(args.flags["max-output"], 5), jev: args.flags.jev, key: process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY, fallback: args.flags.fallback });
    result.revision = store.revision(); result.provenance = store.provenance;
    let remaining = positive(args.flags.budget, 24000);
    let guide = "";
    if (command === "hook" && binding && binding.collection.toLowerCase() === collection.toLowerCase() && binding.guide?.length) {
      let text: string;
      try { text = await store.guide(binding); } catch (error) { console.error("Craft library guide unavailable; load it with lib guide when online"); text = ""; guide = `Library guide available: ${shell([executable, "lib", "guide", ...connectionArgs])}`; }
      if (text && text.length <= remaining) { guide = text; remaining -= text.length; }
      else if (text) guide = `Library guide available: ${shell([executable, "lib", "guide", ...connectionArgs])}`;
    }
    if (args.flags.content || command === "hook") {
      for (const item of result.items) {
        const skill = await store.body(item.id); item.bodyRevision = skill.revision;
        item.load = { command: "craft lib get", reference: item.name, collection, argv: [executable, "lib", "get", item.name, "--collection", collection, ...connectionArgs, "--source", sourceFromArgs(args)] };
        if (skill.markdown.length <= remaining) { item.markdown = skill.markdown; remaining -= skill.markdown.length; }
        else item.contentDeferred = true;
      }
    }
    if (command === "hook") {
      const context = result.items.length ? `Craft skills selected (${result.selector.used}${result.selector.fallback ? "; fallback: " + result.selector.fallback : ""}). Apply relevant instructions as task guidance. Load supporting files with ${shell([executable, "lib", "resource", "NAME", "PATH", "--collection", collection, ...connectionArgs, "--source", sourceFromArgs(args)])}.\n\n` + result.items.map((e: any) => e.markdown ?? `${e.name}: ${e.description}\nLoad: ${shell(e.load.argv)}`).join("\n\n") : "";
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: [guide, context].filter(Boolean).join("\n\n") } }));
    } else if (args.flags.json) output(result);
    else console.log(result.items.map((e: any) => e.markdown ?? `${e.name}: ${e.description}`).join("\n\n"));
    return;
  }
  const entry = catalog.items.find(e => e.id.toLowerCase() === reference!.toLowerCase() || e.name === reference);
  if (!entry) throw new Error(`skill reference is not present in the validated library: ${reference}`);
  if (command === "get") { const body = await store.body(entry.id); if (args.flags.json) output({ ...body, provenance: store.provenance }); else console.log(body.markdown); return; }
  if (command === "resource") {
    if (!path) throw new Error("resource requires a relative path"); resourcePath(path);
    const bytes = await store.resource(entry.id, path);
    if (args.flags.json) output({ name: entry.name, path, encoding: "base64", content: bytes, revision: hash(Buffer.from(bytes, "base64")), sha256: hash(Buffer.from(bytes, "base64")) });
    else process.stdout.write(Buffer.from(bytes, "base64")); return;
  }
  const skill = await store.skill(entry.id);
  if (!args.flags.out) throw new Error("export requires --out DIR; existing skill directories are never overwritten");
  const directory = resolve(args.flags.out, entry.name);
  if (!args.flags["dry-run"]) {
    await mkdir(resolve(args.flags.out), { recursive: true }); await mkdir(directory);
    try { for (const [path, bytes] of Object.entries(skill.files)) { if (path !== "SKILL.md") resourcePath(path); await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), Buffer.from(bytes, "base64"), { flag: "wx" }); } }
    catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
  output({ id: entry.id, name: entry.name, path: join(directory, "SKILL.md"), files: Object.keys(skill.files), sha256: skill.sha256, revision: skill.revision, dryRun: args.flags["dry-run"] });
}

/** Prompt hooks must not block the user's prompt when an optional library is unavailable. */
export async function runLib(argv: string[]): Promise<void> {
  try { await runLibInternal(argv); }
  catch (error) {
    if (argv[0] !== "hook") throw error;
    console.error(`Craft skill hook unavailable: ${error instanceof Error ? error.message.slice(0, 500) : "unknown error"}`);
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "" } }));
  }
}
