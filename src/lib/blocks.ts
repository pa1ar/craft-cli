import type { CraftClient } from "./client.ts";
import type { Block, Position, ItemsResponse, BlockSearchHit } from "./types.ts";

export interface GetBlockOptions {
  maxDepth?: number;
  fetchMetadata?: boolean;
  format?: "json" | "markdown";
}

export interface BlockInsert {
  type?: string;
  textStyle?: string;
  markdown?: string;
  content?: BlockInsert[];
  url?: string;
  altText?: string;
  font?: string;
  // media-specific (image, video, file)
  uploaded?: boolean;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  size?: string;
  width?: number;
  aspectRatio?: number;
  // richUrl
  title?: string;
  description?: string;
  // text/list/page
  listStyle?: string;
  indentationLevel?: number;
  decorations?: string[];
  color?: string;
  lineStyle?: string;
  // code
  rawCode?: string;
  language?: string;
  // passthrough — API accepts additional optional fields
  [key: string]: unknown;
}

/**
 * Pre-process blocks before insert: for image/file blocks whose URL points at Craft's
 * private CDN (r.craft.do), the API requires `uploaded: true` and a `mimeType` —
 * otherwise it tries to re-fetch the asset and 404s, because r.craft.do is scoped to
 * the original uploader's auth. Video blocks accept the URL alone; we still default
 * uploaded+mimeType for consistency. Recurses into nested `content`.
 * Users can override by passing their own `uploaded` / `mimeType`.
 */
export function normalizeCraftMediaBlocks(blocks: BlockInsert[]): BlockInsert[] {
  const defaultMime = (type: string | undefined): string => {
    if (type === "image") return "image/jpeg";
    if (type === "video") return "video/mp4";
    if (type === "file") return "application/octet-stream";
    return "application/octet-stream";
  };
  const isCraftHosted = (url: string | undefined): boolean =>
    typeof url === "string" && url.startsWith("https://r.craft.do/");
  return blocks.map((b) => {
    const needsNorm =
      (b.type === "image" || b.type === "file" || b.type === "video") &&
      isCraftHosted(b.url);
    const patch = needsNorm
      ? {
          uploaded: b.uploaded ?? true,
          mimeType: b.mimeType ?? defaultMime(b.type),
        }
      : {};
    const content = b.content
      ? normalizeCraftMediaBlocks(b.content as BlockInsert[])
      : undefined;
    return content ? { ...b, ...patch, content } : { ...b, ...patch };
  });
}

export interface BlockUpdate {
  id: string;
  markdown?: string;
  font?: string;
}

export interface SearchInDocOpts {
  blockId: string;
  pattern: string;
  caseSensitive?: boolean;
  beforeBlockCount?: number;
  afterBlockCount?: number;
  fetchBlocks?: boolean;
}

/** Guard against the daily-note footgun: POST /blocks with position.end and no
 * pageId/date silently writes to today's daily note. Force one of the two. */
function assertExplicitPosition(pos: Position): Position {
  const hasPage = "pageId" in pos && !!pos.pageId;
  const hasDate = "date" in pos && !!pos.date;
  if (!hasPage && !hasDate) {
    throw new Error(
      "refusing to POST/move blocks with no pageId or date: would silently land in today's daily note. Pass {pageId} or {date} explicitly."
    );
  }
  return pos;
}

export function makeBlocks(c: CraftClient) {
  return {
    /** GET /blocks?id=... — fetch by block id */
    async get(id: string, opts: GetBlockOptions = {}): Promise<Block | string> {
      return c.request("GET", "/blocks", {
        query: {
          id,
          maxDepth: opts.maxDepth,
          fetchMetadata: opts.fetchMetadata,
        },
        accept: opts.format === "markdown" ? "text/markdown" : "application/json",
      });
    },

    /** GET /blocks?date=... — fetch a daily note root */
    async getDaily(date: string = "today", opts: GetBlockOptions = {}): Promise<Block | string> {
      return c.request("GET", "/blocks", {
        query: {
          date,
          maxDepth: opts.maxDepth,
          fetchMetadata: opts.fetchMetadata,
        },
        accept: opts.format === "markdown" ? "text/markdown" : "application/json",
      });
    },

    /** POST /blocks — insert structured blocks */
    async insert(blocks: BlockInsert[], position: Position): Promise<ItemsResponse<Block>> {
      return c.request("POST", "/blocks", {
        body: { blocks: normalizeCraftMediaBlocks(blocks), position: assertExplicitPosition(position) },
      });
    },

    /** POST /blocks — insert raw markdown (gets auto-split into blocks by the API) */
    async insertMarkdown(markdown: string, position: Position): Promise<ItemsResponse<Block>> {
      return c.request("POST", "/blocks", {
        body: { markdown, position: assertExplicitPosition(position) },
      });
    },

    /** Convenience: append markdown to a page or daily note */
    async append(markdown: string, target: { pageId: string } | { date: string }) {
      const position = { position: "end" as const, ...target } as Position;
      return this.insertMarkdown(markdown, position);
    },

    /** PUT /blocks — partial update. Trial 04 confirmed children are preserved. */
    async update(updates: BlockUpdate[]): Promise<ItemsResponse<Block>> {
      return c.request("PUT", "/blocks", { body: { blocks: updates } });
    },

    /** DELETE /blocks */
    async delete(blockIds: string[]): Promise<ItemsResponse<{ id: string }>> {
      return c.request("DELETE", "/blocks", { body: { blockIds } });
    },

    /** PUT /blocks/move */
    async move(blockIds: string[], position: Position): Promise<ItemsResponse<{ id: string }>> {
      return c.request("PUT", "/blocks/move", {
        body: { blockIds, position: assertExplicitPosition(position) },
      });
    },

    /** GET /blocks/search — within a single document */
    async search(opts: SearchInDocOpts): Promise<ItemsResponse<BlockSearchHit>> {
      return c.request("GET", "/blocks/search", {
        query: {
          blockId: opts.blockId,
          pattern: opts.pattern,
          caseSensitive: opts.caseSensitive,
          beforeBlockCount: opts.beforeBlockCount,
          afterBlockCount: opts.afterBlockCount,
          fetchBlocks: opts.fetchBlocks,
        },
      });
    },
  };
}
