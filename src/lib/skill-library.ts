import { createHash } from "node:crypto";
import type { CraftClient } from "./client.ts";
import type { Block, CollectionItem, ItemsResponse } from "./types.ts";

/** The small, stable view of a Craft collection row exposed by the skill library. */
export interface LibraryEntry {
  [key: string]: unknown;
  id: string;
  name: string;
  title: string;
  description: string;
  tags: string[];
  status: string;
}

export interface LibraryRejected {
  id: string;
  title: string;
  reason: string;
}

export interface LibraryOptions {
  /** Include published, draft, and archived rows (metadata is still validated). */
  includeDrafts?: boolean;
  /** Read the older tag/title convention used by pre-schema collections. */
  legacy?: boolean;
}

export interface LibraryListResult {
  items: LibraryEntry[];
  rejected: LibraryRejected[];
}

export interface LibrarySkillResult {
  entry: LibraryEntry;
  markdown: string;
  /** SHA-256 of the generated single-file markdown export. */
  sha256: string;
}

type Row = CollectionItem & {
  [key: string]: unknown;
  properties?: Record<string, unknown>;
};

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DRAFT_STATUSES = new Set(["draft", "archived"]);
const SUPPORTED_TEXT_TYPES = new Set(["text", "code", "line"]);
const UNSUPPORTED_TYPES = new Set([
  "image",
  "video",
  "file",
  "collection",
  "page",
  "whiteboard",
  "drawing",
  "table",
  "richUrl",
]);

function property(row: Row, key: string): unknown {
  const props = row.properties ?? {};
  if (key in props) return props[key];
  const wanted = key.toLowerCase();
  for (const [name, value] of Object.entries(props)) {
    if (name.toLowerCase() === wanted) return value;
  }
  return row[key];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : value === undefined || value === null ? undefined : String(value);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  const one = stringValue(value)?.trim();
  return one ? [one] : [];
}

function hasTag(tags: string[], wanted: string): boolean {
  return tags.some((tag) => tag.toLowerCase() === wanted);
}

function legacySlug(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64)
    .replace(/-+$/, "");
}

function rowIdentity(row: Row): { id: string; title: string } {
  return {
    id: stringValue(row.id) ?? "",
    title: stringValue(row.title) ?? stringValue(property(row, "title")) ?? "",
  };
}

function reject(row: Row, reason: string): LibraryRejected {
  const identity = rowIdentity(row);
  return { ...identity, reason };
}

function candidate(row: Row, options: LibraryOptions): { entry?: LibraryEntry; rejected?: LibraryRejected } {
  const identity = rowIdentity(row);
  const tags = stringList(property(row, "tags") ?? row.tags);
  const kind = stringValue(property(row, "kind"))?.trim().toLowerCase();
  const statusRaw = stringValue(property(row, "status"))?.trim().toLowerCase();
  const legacy = options.legacy === true;

  // An explicit kind always wins. The legacy tag is only a fallback for rows
  // from collections that predate the kind property.
  const isSkill = kind !== undefined
    ? kind === "skill"
    : legacy && hasTag(tags, "skill");
  if (!isSkill) return {};

  if (statusRaw === undefined || statusRaw === "") {
    if (!legacy) return { rejected: reject(row, "missing properties.status (expected published)") };
  } else if (statusRaw !== "published") {
    if (!(options.includeDrafts === true && DRAFT_STATUSES.has(statusRaw))) return {};
  }

  const title = identity.title;
  const rawName = property(row, "name");
  if (rawName !== undefined && typeof rawName !== "string") {
    return { rejected: reject(row, "name must be a string") };
  }
  const name = legacy && rawName === undefined
    ? legacySlug(title)
    : typeof rawName === "string" ? rawName.trim() : "";
  if (!name || name.length > 64 || !NAME_RE.test(name)) {
    return { rejected: reject(row, "invalid skill name; use lowercase letters, digits, and single hyphens (max 64 characters)") };
  }

  const rawDescription = property(row, "description");
  if (rawDescription !== undefined && typeof rawDescription !== "string") {
    return { rejected: reject(row, "description must be a string") };
  }
  const description = typeof rawDescription === "string" ? rawDescription.trim() : "";
  if (!description) return { rejected: reject(row, "missing description") };
  if (description.length > 1024) return { rejected: reject(row, "description exceeds 1024 characters") };

  return {
    entry: {
      id: identity.id,
      name,
      title,
      description,
      tags,
      status: statusRaw || "legacy",
    },
  };
}

/** List validated skill metadata without fetching any item bodies. */
export async function listLibrary(
  client: CraftClient,
  collectionId: string,
  options: LibraryOptions = {},
): Promise<LibraryListResult> {
  // Depth zero is intentional: callers should never pay for content while listing.
  const response = await client.collections.getItems(collectionId, 0) as ItemsResponse<CollectionItem>;
  if (!response || !Array.isArray(response.items)) {
    throw new Error("invalid Craft collection items response: expected an items array");
  }
  const rows = response.items as Row[];
  const items: LibraryEntry[] = [];
  const rejected: LibraryRejected[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      throw new Error("invalid Craft collection item: expected an object");
    }
    const result = candidate(row, options);
    if (result.entry) items.push(result.entry);
    if (result.rejected) rejected.push(result.rejected);
  }

  const byName = new Map<string, LibraryEntry[]>();
  for (const item of items) {
    const group = byName.get(item.name) ?? [];
    group.push(item);
    byName.set(item.name, group);
  }
  const duplicateNames = new Set<string>();
  for (const [name, group] of byName) {
    if (group.length > 1) duplicateNames.add(name);
  }
  if (duplicateNames.size > 0) {
    const kept: LibraryEntry[] = [];
    for (const item of items) {
      if (!duplicateNames.has(item.name)) {
        kept.push(item);
        continue;
      }
      rejected.push({ id: item.id, title: item.title, reason: `duplicate skill name: ${item.name}` });
    }
    return { items: kept, rejected };
  }

  return { items, rejected };
}

function jsonYaml(value: unknown): string {
  return JSON.stringify(value);
}

function maxBackticks(value: string): number {
  let max = 0;
  for (const match of value.matchAll(/`+/g)) max = Math.max(max, match[0].length);
  return max;
}

function renderBlock(block: Block & Record<string, unknown>, path: string): string[] {
  const type = typeof block.type === "string" ? block.type : "";
  if (UNSUPPORTED_TYPES.has(type)) {
    throw new Error(`unsupported block type "${type}" at ${path}; skill exports support text and code blocks only`);
  }
  if (!SUPPORTED_TEXT_TYPES.has(type)) {
    throw new Error(`unsupported block type "${type || "unknown"}" at ${path}; skill exports support text and code blocks only`);
  }

  let markdown: string;
  if (type === "code") {
    const raw = stringValue(block.rawCode) ?? stringValue(block.markdown) ?? "";
    const fence = "`".repeat(Math.max(3, maxBackticks(raw) + 1));
    const language = stringValue(block.language) ?? "";
    markdown = `${fence}${language}\n${raw}\n${fence}`;
  } else if (type === "line") {
    markdown = "---";
  } else {
    // Keep Craft markdown extensions and literal XML untouched.
    markdown = stringValue(block.markdown) ?? "";
  }

  const parts = markdown ? [markdown] : [];
  if (Array.isArray(block.content)) {
    for (let index = 0; index < block.content.length; index++) {
      const child = block.content[index];
      if (!child || typeof child !== "object") {
        throw new Error(`unsupported empty block at ${path}.content[${index}]`);
      }
      parts.push(...renderBlock(child as Block & Record<string, unknown>, `${path}.content[${index}]`));
    }
  }
  return parts;
}

function renderSkill(entry: LibraryEntry, root: Block): string {
  const rootType = typeof (root as any).type === "string" ? (root as any).type : "";
  if (rootType !== "collectionItem") {
    throw new Error(`unsupported skill root type "${rootType || "unknown"}"; expected collectionItem`);
  }
  const content = Array.isArray(root.content) ? root.content : [];
  const body: string[] = [];
  for (let index = 0; index < content.length; index++) {
    const child = content[index];
    if (!child || typeof child !== "object") throw new Error(`unsupported empty block at content[${index}]`);
    body.push(...renderBlock(child as Block & Record<string, unknown>, `content[${index}]`));
  }
  if (body.length === 0 || body.every((part) => part.trim() === "")) {
    throw new Error(`skill ${entry.name} has no exportable text content`);
  }
  const frontmatter = [
    "---",
    `name: ${jsonYaml(entry.name)}`,
    `description: ${jsonYaml(entry.description)}`,
    "---",
  ].join("\n");
  return `${frontmatter}\n\n${body.join("\n\n")}${body.length ? "\n" : ""}`;
}

/** Resolve a catalog entry by exact id or name, then fetch only that block's body. */
export async function getLibrarySkill(
  client: CraftClient,
  collectionId: string,
  reference: string,
  options: LibraryOptions = {},
): Promise<LibrarySkillResult> {
  const catalog = await listLibrary(client, collectionId, options);
  const entry = catalog.items.find((item) => item.id === reference || item.name === reference);
  if (!entry) throw new Error(`skill reference is not present in the validated library: ${reference}`);

  const fetched = await client.blocks.get(entry.id, { maxDepth: -1, format: "json" });
  if (!fetched || typeof fetched !== "object") {
    throw new Error(`skill ${entry.name} did not return a structured block`);
  }
  const markdown = renderSkill(entry, fetched as Block);
  const sha256 = createHash("sha256").update(markdown, "utf8").digest("hex");
  return { entry, markdown, sha256 };
}
