import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { CraftClient } from "./client.ts";
import type { Block } from "./types.ts";
import { renderLibraryBlock, type LibraryEntry } from "./skill-library.ts";

export interface SkillPackage {
  entry: LibraryEntry;
  markdown: string;
  sha256: string;
  revision: string;
  resources: string[];
  complete: boolean;
  /** Exact bytes encoded as base64, including SKILL.md. */
  files: Record<string, string>;
}
export function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function resourcePath(path: string): string {
  if (!path || path.includes("\\") || path.includes("\0") || path.startsWith("/") || path.split("/").some(p => !p || p === "." || p === "..") || /^[a-z]+:/i.test(path)) {
    throw new Error(`unsafe resource path: ${path}`);
  }
  if (path === "SKILL.md" || path.startsWith(".craft-")) throw new Error(`reserved resource path: ${path}`);
  return path;
}
function slug(text: string): string { return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reference"; }
function children(block: any): any[] { return Array.isArray(block.content) ? block.content : []; }

/** Render nested pages and a Resources collection into a portable complete folder. */
export async function loadSkillPackage(client: CraftClient, entry: LibraryEntry, catalog: LibraryEntry[], options: { bodyOnly?: boolean; resource?: string } = {}): Promise<SkillPackage> {
  const root: any = await client.blocks.get(entry.id, { maxDepth: -1, format: "json" });
  if (root?.nextCursor || root?.hasMore) throw new Error("incomplete skill body");
  if (root?.type !== "collectionItem") throw new Error(`invalid skill root for ${entry.name}: expected collectionItem`);
  const files: Record<string, string> = {};
  const destinations = new Map<string, string>(catalog.map(e => [e.id.toLowerCase(), `../${e.name}/SKILL.md`]));
  destinations.set(entry.id.toLowerCase(), "SKILL.md");
  const pages: { block: any; path: string; raw: boolean }[] = [];
  const resourceCollections = new Map<string, string[]>();
  const resourcePaths: string[] = [];
  const assets: { block: any; path: string }[] = [];
  const put = (path: string, bytes: Uint8Array | string) => {
    if (Object.keys(files).some(p => p.toLowerCase() === path.toLowerCase())) throw new Error(`duplicate resource path: ${path}`);
    files[path] = Buffer.from(bytes).toString("base64");
  };
  const register = (block: any, path: string) => {
    resourcePath(path);
    if (!block.id) throw new Error(`resource ${path} has no block ID`);
    if ([...destinations.values()].some(p => p.toLowerCase() === path.toLowerCase())) throw new Error(`duplicate resource path: ${path}`);
    destinations.set(block.id.toLowerCase(), path); resourcePaths.push(path);
  };
  const scanned = new Set<string>();
  async function scan(block: any, prefix = "references") {
    if (block.id) { if (scanned.has(block.id)) throw new Error("cyclic or repeated skill resource"); scanned.add(block.id); }
    for (let child of children(block)) {
      if (child.nextCursor || child.hasMore) throw new Error("incomplete skill resource content");
      if (!options.bodyOnly && child.type === "page" && !Array.isArray(child.content)) child = await client.blocks.get(child.id, { maxDepth: -1, format: "json" });
      if (child.type === "page") {
        const path = `${prefix}/${slug(child.markdown ?? child.title ?? "reference")}.md`;
        register(child, path); pages.push({ block: child, path, raw: false });
        await scan(child, path.slice(0, -3));
      } else if (child.type === "file" || child.type === "image" || child.type === "video") {
        const name = child.fileName ?? new URL(child.url ?? "https://invalid/").pathname.split("/").pop();
        const path = `assets/${name || "asset"}`;
        register(child, path); assets.push({ block: child, path });
      } else if (child.type === "collection") {
        if ((child.name ?? child.markdown ?? "").toLowerCase() !== "resources") throw new Error(`unsupported collection in ${entry.name}; name supporting collection Resources`);
        const rows = await client.collections.getItems(child.id, 0);
        if (!Array.isArray(rows?.items) || (rows as any).nextCursor || (rows as any).hasMore) throw new Error("incomplete Resources listing");
        const paths: string[] = []; resourceCollections.set(child.id, paths);
        for (const row of rows.items) {
          const path = resourcePath(String(row.properties?.path ?? row.title ?? ""));
          paths.push(path);
          const kind = String(row.properties?.kind ?? "text");
          if (!["text", "script", "file"].includes(kind)) throw new Error(`unsupported resource kind: ${kind}`);
          if (options.bodyOnly || (options.resource && kind === "file" && options.resource !== path)) { register(row, path); continue; }
          const body: any = await client.blocks.get(row.id, { maxDepth: -1, format: "json" });
          register(body, path);
          if (kind === "file") {
            const attachments = children(body).filter(c => ["file", "image", "video"].includes(c.type));
            if (attachments.length !== 1 || children(body).length !== 1) throw new Error(`file resource ${path} requires exactly one attachment`);
            assets.push({ block: attachments[0], path });
          } else {
            pages.push({ block: body, path, raw: kind === "script" });
            if (children(body).some(c => ["page", "collection", "file", "image", "video"].includes(c.type))) throw new Error(`text resource ${path} must be self-contained; use another Resources row for supporting files`);
          }
        }
      } else if (children(child).length) await scan(child, prefix);
    }
  }
  await scan(root);
  function rewrite(text: string, from: string): string {
    return text.replace(/\[([^\]]*)\]\(block:\/\/([a-f0-9-]+)\)/gi, (_all, label, id) => {
      const destination = destinations.get(id.toLowerCase());
      const url = destination ? posix.relative(posix.dirname(from), destination) : `craftdocs://open?blockId=${id}`;
      return `[${label}](${url})`;
    });
  }
  function render(block: any, path: string): string[] {
    if (["page", "file", "image", "video"].includes(block.type)) {
      const dest = destinations.get(block.id?.toLowerCase());
      if (!dest) throw new Error(`unregistered resource in ${entry.name}`);
      return [`[${block.markdown || block.fileName || "Resource"}](${posix.relative(posix.dirname(path), dest)})`];
    }
    if (block.type === "collection") {
      const links = (resourceCollections.get(block.id) ?? []).map(p => `[${p}](${posix.relative(posix.dirname(path), p)})`);
      return links;
    }
    const own = renderLibraryBlock({ ...block, content: undefined } as Block & Record<string, unknown>, path).map(s => block.type === "code" ? s : rewrite(s, path));
    return [...own, ...children(block).flatMap(c => render(c, path))];
  }
  if (options.resource && !resourcePaths.includes(options.resource)) throw new Error(`resource not found: ${options.resource}`);
  if (!options.bodyOnly) for (const page of pages) {
    if (options.resource && options.resource !== page.path) continue;
    let text: string;
    if (page.raw) {
      const content = children(page.block);
      if (content.length !== 1 || content[0].type !== "code") throw new Error(`script ${page.path} requires exactly one code block`);
      text = content[0].rawCode ?? content[0].markdown ?? "";
    } else text = children(page.block).flatMap(c => render(c, page.path)).join("\n\n") + "\n";
    put(page.path, text);
  }
  if (!options.bodyOnly) for (const asset of assets) {
    if (options.resource && options.resource !== asset.path) continue;
    const url = new URL(asset.block.url);
    if (url.protocol !== "https:") throw new Error(`attachment ${asset.path} requires HTTPS`);
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
    if (!response.ok) throw new Error(`attachment download failed (${response.status}): ${asset.path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 50 * 1024 * 1024) throw new Error(`attachment too large: ${asset.path}`);
    put(asset.path, bytes);
  }
  const body = children(root).flatMap(c => render(c, "SKILL.md")).join("\n\n");
  if (!body.trim()) throw new Error(`skill ${entry.name} has no exportable text content`);
  const markdown = `---\nname: ${JSON.stringify(entry.name)}\ndescription: ${JSON.stringify(entry.description)}\n---\n\n${body}\n`;
  put("SKILL.md", markdown);
  const revision = hash(JSON.stringify(Object.keys(files).sort().map(path => [path, files[path]])));
  return { entry, markdown, sha256: hash(markdown), revision, files, resources: resourcePaths.sort(), complete: !options.bodyOnly && !options.resource };
}
