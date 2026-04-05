// Link discovery for Craft docs.
//
// Craft's search index does NOT index the `block://<UUID>` URI itself, so
// searching for a raw UUID returns zero hits. Fortunately, when a block is
// referenced via `[text](block://<UUID>)` syntax, the visible anchor text IS
// indexed as normal content.
//
// Insight from Pavel: by default Craft inserts the target block's title as
// the link text. So to find backlinks to block X, fetch X's title, search the
// vault for that title, and locally filter the resulting blocks to those whose
// markdown contains `block://X`. One search call + zero extra fetches when
// `fetchBlocks: true` is passed.
//
// Caveats:
// - If the author renamed the link text to something other than the target's
//   title, this won't find that backlink. Set `linkText` manually for such cases.
// - Very short titles may produce noisy search hits; the local `block://<id>`
//   filter guarantees false positives are dropped.
// - Craft's search returns top-20 by relevance. For very common titles, some
//   backlinks may be missed. A full-vault scan is the only alternative (see
//   `backlinksExhaustive` below).

import type { CraftClient } from "./client.ts";
import type { Block, BlockLink } from "./types.ts";
import { walkBlocks, parallel } from "./client.ts";

const LINK_RE = /\[([^\]]*)\]\(block:\/\/([0-9a-fA-F-]{36})\)/g;

/** Extract every `[text](block://UUID)` link from a block tree. */
export function extractOutgoing(root: Block, rootDocId?: string): BlockLink[] {
  const links: BlockLink[] = [];
  const docId = rootDocId ?? root.id;
  walkBlocks(root, (b: Block) => {
    if (!b.markdown) return;
    for (const m of b.markdown.matchAll(LINK_RE)) {
      links.push({
        blockId: m[2]!,
        text: m[1] ?? "",
        inBlockId: b.id,
        inDocumentId: docId,
      });
    }
  });
  return links;
}

/** Pull the human-readable title from a block fetched via GET /blocks.
 * For a page/doc block, the markdown is usually just the title text (no leading "#").
 * For the markdown wrapper format, the title is inside `<pageTitle>...</pageTitle>`. */
export function inferTitle(block: Block): string {
  const md = block.markdown ?? "";
  // strip heading marks and trim
  return md.replace(/^#+\s*/, "").trim();
}

export function makeLinks(c: CraftClient) {
  return {
    /** Outgoing links — free, just parses the fetched tree. Pass a root block
     * or re-fetch by id. */
    async outgoing(blockId: string): Promise<BlockLink[]> {
      const root = (await c.blocks.get(blockId, { maxDepth: -1 })) as Block;
      return extractOutgoing(root, blockId);
    },

    /** Backlinks via title-based search (fast, ~1 API call).
     * Pass `linkText` explicitly if the author uses custom link labels, otherwise
     * it's derived from the target block's title. */
    async backlinks(
      targetBlockId: string,
      opts: { linkText?: string; includeSelf?: boolean } = {}
    ): Promise<BlockLink[]> {
      let linkText = opts.linkText;
      if (!linkText) {
        const target = (await c.blocks.get(targetBlockId, { maxDepth: 0 })) as Block;
        linkText = inferTitle(target);
      }
      if (!linkText) return [];

      const hits = await c.documents.search({
        include: linkText,
        fetchBlocks: true,
      });

      const refPattern = `block://${targetBlockId}`;
      const refPatternLower = refPattern.toLowerCase();
      const backlinks: BlockLink[] = [];

      for (const hit of hits.items) {
        if (!opts.includeSelf && hit.documentId === targetBlockId) continue;
        for (const block of hit.blocks ?? []) {
          if (!block.markdown) continue;
          const md = block.markdown.toLowerCase();
          if (!md.includes(refPatternLower)) continue;
          // find the specific matching link to grab its text
          for (const m of block.markdown.matchAll(LINK_RE)) {
            if (m[2]?.toLowerCase() === targetBlockId.toLowerCase()) {
              backlinks.push({
                blockId: targetBlockId,
                text: m[1] ?? "",
                inBlockId: block.id,
                inDocumentId: hit.documentId,
              });
            }
          }
        }
      }
      return backlinks;
    },

    /** Exhaustive backlinks: scan every document in the space. Expensive but
     * catches references the title-search heuristic misses (custom link labels,
     * low-ranked hits past the top-20 cutoff).
     *
     * ~2-3 minutes for a 1000-doc space at concurrency 15. Only use when the
     * fast path returns suspiciously few results. */
    async backlinksExhaustive(
      targetBlockId: string,
      opts: { concurrency?: number; location?: any; folderId?: string } = {}
    ): Promise<BlockLink[]> {
      const docs = await c.documents.list({
        location: opts.location,
        folderId: opts.folderId,
      });
      const refPattern = `block://${targetBlockId}`.toLowerCase();

      const perDoc = await parallel(
        docs.items,
        async (doc) => {
          try {
            const root = (await c.blocks.get(doc.id, { maxDepth: -1 })) as Block;
            const hits: BlockLink[] = [];
            walkBlocks(root, (b: Block) => {
              if (!b.markdown) return;
              if (!b.markdown.toLowerCase().includes(refPattern)) return;
              for (const m of b.markdown.matchAll(LINK_RE)) {
                if (m[2]?.toLowerCase() === targetBlockId.toLowerCase()) {
                  hits.push({
                    blockId: targetBlockId,
                    text: m[1] ?? "",
                    inBlockId: b.id,
                    inDocumentId: doc.id,
                  });
                }
              }
            });
            return hits;
          } catch {
            return [];
          }
        },
        opts.concurrency ?? 15
      );
      return perDoc.flat();
    },
  };
}
