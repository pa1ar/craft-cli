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
        body: { blocks, position: assertExplicitPosition(position) },
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
