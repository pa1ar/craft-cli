import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { CraftClient } from "../lib/client.ts";
import { listLibrary, type LibraryListResult } from "../lib/skill-library.ts";
import { hash, loadSkillPackage, type SkillPackage } from "../lib/skill-packages.ts";
import type { Source } from "./config.ts";

export interface LibraryBinding {
  document: string; collection: string; guide?: string[]; out?: string;
  github?: { repo: string; branch: string; path: string; mode: "pr" | "direct" };
}
export interface LibraryBody { entry: SkillPackage["entry"]; markdown: string; sha256: string; revision: string; resources: string[]; }
function bodyOf(value: SkillPackage): LibraryBody { return { entry: value.entry, markdown: value.markdown, sha256: value.sha256, revision: value.sha256, resources: value.resources ?? Object.keys(value.files).filter(p => p !== "SKILL.md").sort() }; }
interface Snapshot {
  version: 1; scope: string; collection: string; fetchedAt: string;
  catalog: LibraryListResult; packages: Record<string, SkillPackage>; bodies?: Record<string, LibraryBody>; resources?: Record<string, { content: string; sha256: string }>; guide?: string; guideKey?: string;
}
export const libraryStateRoot = () => process.env.CRAFT_LIB_STATE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "craft-cli", "libraries");
const bindingRoot = () => process.env.CRAFT_LIB_STATE ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "craft-cli", "libraries");
export function libraryScope(client: CraftClient): string { return hash(JSON.stringify([client.url, client.key])); }
async function readJSON<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error: any) { if (error.code === "ENOENT") return undefined; throw new Error(`invalid library state: ${path}`); }
}
export async function atomicJSON(path: string, data: unknown): Promise<void> {
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, JSON.stringify(data), { mode: 0o600, flag: "wx" }); await rename(tmp, path); }
  finally { await rm(tmp, { force: true }); }
}
export async function readBinding(client: CraftClient): Promise<LibraryBinding | undefined> { return readJSON(join(bindingRoot(), libraryScope(client), "binding.json")); }
export async function writeBinding(client: CraftClient, binding: LibraryBinding): Promise<void> { await atomicJSON(join(bindingRoot(), libraryScope(client), "binding.json"), binding); }
export class LibraryStore {
  private snapshot?: Snapshot;
  private readonly scope: string;
  private readonly path: string;
  provenance = { source: "api" as "api" | "snapshot", fetchedAt: "", ageSeconds: 0, stale: false };
  constructor(private client: CraftClient, readonly collection: string, private source: Source, private maxAge = 60, private legacy = false, private includeDrafts = false) {
    this.scope = libraryScope(client);
    this.path = join(libraryStateRoot(), this.scope, hash(JSON.stringify([collection.toLowerCase(), legacy])) + ".json");
  }
  async catalog(full = false, binding?: LibraryBinding): Promise<LibraryListResult> {
    const cached = await readJSON<Snapshot>(this.path);
    if (cached && (cached.version !== 1 || cached.scope !== this.scope || cached.collection.toLowerCase() !== this.collection.toLowerCase() || !Array.isArray(cached.catalog?.items) || !cached.packages)) throw new Error("invalid or mismatched library snapshot; refresh with --source api");
    const age = cached ? Math.max(0, (Date.now() - Date.parse(cached.fetchedAt)) / 1000) : Infinity;
    if (!full && cached && (this.source === "local" || this.source === "auto" && age <= this.maxAge)) {
      this.snapshot = cached; this.provenance = { source: "snapshot", fetchedAt: cached.fetchedAt, ageSeconds: age, stale: age > this.maxAge };
      return cached.catalog;
    }
    if (this.source === "local") throw new Error("library snapshot unavailable; run craft lib refresh --source api first");
    const catalog = await listLibrary(this.client, this.collection, { includeDrafts: true, legacy: this.legacy });
    // Do not carry old bodies into a new catalog revision.
    const snapshot: Snapshot = { version: 1, scope: this.scope, collection: this.collection, fetchedAt: new Date().toISOString(), catalog, packages: {} };
    if (full) {
      for (const entry of catalog.items.filter(e => this.includeDrafts || e.status === "published" || this.legacy && e.status === "legacy")) snapshot.packages[entry.id] = await loadSkillPackage(this.client, entry, catalog.items);
    }
    if (binding) {
      snapshot.guideKey = hash(JSON.stringify(binding.guide ?? []));
      snapshot.guide = await this.fetchGuide(binding);
    }
    // Complete refresh is atomic, failure above retains the previous good snapshot.
    await atomicJSON(this.path, snapshot); this.snapshot = snapshot;
    this.provenance = { source: "api", fetchedAt: snapshot.fetchedAt, ageSeconds: 0, stale: false };
    return catalog;
  }
  async body(reference: string): Promise<LibraryBody> {
    if (!this.snapshot) await this.catalog();
    const entry = this.snapshot!.catalog.items.find(e => e.id.toLowerCase() === reference.toLowerCase() || e.name === reference);
    if (!entry) throw new Error(`skill reference is not present in the validated library: ${reference}`);
    if (this.snapshot!.packages[entry.id]) return bodyOf(await this.skill(entry.id));
    const cached = this.snapshot!.bodies?.[entry.id];
    if (cached) {
      if (hash(cached.markdown) !== cached.sha256) throw new Error("corrupt skill body snapshot; refresh with --source api");
      return cached;
    }
    if (this.source === "local") throw new Error(`uncached skill ${entry.name}; run craft lib refresh --source api first`);
    const value = bodyOf(await loadSkillPackage(this.client, entry, this.snapshot!.catalog.items, { bodyOnly: true }));
    (this.snapshot!.bodies ??= {})[entry.id] = value; await atomicJSON(this.path, this.snapshot);
    return value;
  }
  async resource(reference: string, path: string): Promise<string> {
    if (!this.snapshot) await this.catalog();
    const entry = this.snapshot!.catalog.items.find(e => e.id.toLowerCase() === reference.toLowerCase() || e.name === reference);
    if (!entry) throw new Error(`skill reference is not present in the validated library: ${reference}`);
    if (this.snapshot!.packages[entry.id]) {
      const full = await this.skill(entry.id); const content = full.files[path];
      if (content === undefined) throw new Error(`resource not found: ${path}`); return content;
    }
    const key = `${entry.id}/${path}`;
    const cached = this.snapshot!.resources?.[key];
    if (cached) { if (hash(Buffer.from(cached.content, "base64")) !== cached.sha256) throw new Error("corrupt resource snapshot"); return cached.content; }
    if (this.source === "local") throw new Error(`uncached resource ${path}; run craft lib refresh --source api first`);
    const value = await loadSkillPackage(this.client, entry, this.snapshot!.catalog.items, { resource: path });
    const content = value.files[path]; if (content === undefined) throw new Error(`resource not found: ${path}`);
    (this.snapshot!.resources ??= {})[key] = { content, sha256: hash(Buffer.from(content, "base64")) }; await atomicJSON(this.path, this.snapshot); return content;
  }
  async skill(reference: string): Promise<SkillPackage> {
    if (!this.snapshot) await this.catalog();
    const entry = this.snapshot!.catalog.items.find(e => e.id.toLowerCase() === reference.toLowerCase() || e.name === reference);
    if (!entry) throw new Error(`skill reference is not present in the validated library: ${reference}`);
    const cached = this.snapshot!.packages[entry.id];
    if (cached) {
      const paths = Object.keys(cached.files).sort();
      const expected = hash(JSON.stringify(paths.map(path => [path, cached.files[path]])));
      if (expected !== cached.revision || hash(cached.markdown) !== cached.sha256 || Buffer.from(cached.files["SKILL.md"] ?? "", "base64").toString("utf8") !== cached.markdown) throw new Error("corrupt skill snapshot; refresh with --source api");
      return cached;
    }
    if (this.source === "local") throw new Error(`uncached skill ${entry.name}; run craft lib refresh --source api first`);
    const value = await loadSkillPackage(this.client, entry, this.snapshot!.catalog.items);
    this.snapshot!.packages[entry.id] = value;
    await atomicJSON(this.path, this.snapshot);
    return value;
  }
  revision(): string { return hash(JSON.stringify(this.snapshot?.catalog)); }
  async guide(binding: LibraryBinding): Promise<string> {
    if (!this.snapshot) await this.catalog();
    const guideKey = hash(JSON.stringify(binding.guide ?? []));
    if (this.snapshot!.guide !== undefined && this.snapshot!.guideKey === guideKey) return this.snapshot!.guide;
    if (this.source === "local") throw new Error("uncached library guide; refresh it through API first");
    const text = await this.fetchGuide(binding);
    this.snapshot!.guideKey = guideKey;
    this.snapshot!.guide = text; await atomicJSON(this.path, this.snapshot);
    return this.snapshot!.guide;
  }
  private async fetchGuide(binding: LibraryBinding): Promise<string> {
    const parts: string[] = [];
    const { renderLibraryBlock } = await import("../lib/skill-library.ts");
    for (const id of binding.guide ?? []) {
      const block: any = await this.client.blocks.get(id, { maxDepth: -1, format: "json" });
      if (block.type === "page") parts.push(...(block.content ?? []).flatMap((c: any) => renderLibraryBlock(c, id)));
      else parts.push(...renderLibraryBlock(block, id));
    }
    return parts.join("\n\n");
  }
}
