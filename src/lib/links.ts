// Link discovery for Craft docs.
//
// Native path: Craft's GET /internal-links (experimental, added 2026-10).
// It lists directed document pairs with reference counts, or individual
// block references, for outgoing links (fromDocumentId) and backlinks
// (toDocumentId). Ids must be document root ids; references to cards and
// blocks roll up to their containing document, so a card or block target is
// answered with a block-level query on its document plus a local filter.
//
// Legacy path (kept as fallback, `backlinksLegacy` / `backlinksExhaustive`):
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
import type {
  Block,
  BlockLink,
  InternalLink,
  InternalLinkPair,
  InternalLinkRef,
  InternalLinksPage,
  InternalLinksQuery,
} from "./types.ts";
import { CraftError } from "./errors.ts";
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


export type LinkDirection = "in" | "out";

export interface LinkScopeOptions {
  /** Document root that contains the id. Skips root resolution. */
  documentId?: string;
  /** Map any block id to its document root id (or null). The CLI injects a
   * local SQLite resolver; library users may supply their own. */
  resolveDocumentId?: (id: string) => string | null | undefined | Promise<string | null | undefined>;
  /** When the containing document can't be found, scan every reference in
   * the space (slow: ~75 s for ~7.5k references). */
  scan?: boolean;
  /** "document" (default) groups by document with counts; "block" keeps
   * exact source and target blocks. */
  level?: "document" | "block";
  /** Include links within one document. For card or block targets, links
   * from sibling blocks of the same document are always considered. */
  includeSelfLinks?: boolean;
}

export interface LinksResult {
  direction: LinkDirection;
  /** the id that was asked about */
  id: string;
  /** document root used for the query; null for a whole-space scan */
  documentId: string | null;
  /** true when `id` is itself a document root */
  isDocument: boolean;
  level: "document" | "block";
  items: InternalLink[];
}

/** Thrown when a card or block id can't be mapped to its document root. */
export class LinkScopeError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(
      `cannot find the document that contains ${id}. ` +
        `pass the document root id (--doc <rootId>) or allow a slow whole-space scan (--scan)`,
    );
    this.name = "LinkScopeError";
    this.id = id;
  }
}

/** True when the experimental endpoint is missing or failing server-side,
 * the only cases where falling back to the legacy title search makes sense. */
export function isInternalLinksUnavailable(e: unknown): boolean {
  if (!(e instanceof CraftError)) return false;
  if (!e.path.includes("/internal-links")) return false;
  return e.status === 404 || e.status === 405 || e.status === 501 || e.kind === "SERVER";
}

const eq = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

function isRef(l: InternalLink): l is InternalLinkRef {
  return (l as InternalLinkRef).sourceBlockId !== undefined;
}

/** Group block references into document pairs with counts. */
function groupRefs(refs: InternalLinkRef[]): InternalLinkPair[] {
  const byPair = new Map<string, InternalLinkPair>();
  for (const r of refs) {
    const key = `${r.sourceDocumentId.toLowerCase()}:${r.targetDocumentId.toLowerCase()}`;
    const cur = byPair.get(key);
    if (cur) cur.referenceCount++;
    else
      byPair.set(key, {
        sourceDocumentId: r.sourceDocumentId,
        targetDocumentId: r.targetDocumentId,
        referenceCount: 1,
        ...(r.sourceDocumentTitle !== undefined && { sourceDocumentTitle: r.sourceDocumentTitle }),
        ...(r.targetDocumentTitle !== undefined && { targetDocumentTitle: r.targetDocumentTitle }),
      });
  }
  return [...byPair.values()];
}

function collectIds(root: Block): Set<string> {
  const ids = new Set<string>();
  walkBlocks(root, (b: Block) => {
    if (b.id) ids.add(b.id.toLowerCase());
  });
  return ids;
}

export function makeLinks(c: CraftClient) {
  let docTitles: Promise<Map<string, string>> | undefined;
  /** id (lowercased) -> title for every document root, cached per client. */
  const titles = () => {
    if (!docTitles) {
      docTitles = c.documents.list().then((r) => {
        const m = new Map<string, string>();
        for (const d of r.items) m.set(d.id.toLowerCase(), d.title ?? "");
        return m;
      });
      docTitles.catch(() => (docTitles = undefined));
    }
    return docTitles;
  };

  async function page(q: InternalLinksQuery): Promise<InternalLinksPage> {
    return c.request<InternalLinksPage>("GET", "/internal-links", {
      query: {
        level: q.level,
        fromDocumentId: q.fromDocumentId,
        toDocumentId: q.toDocumentId,
        fromDate: q.fromDate,
        toDate: q.toDate,
        includeSelfLinks: q.includeSelfLinks === undefined ? undefined : String(q.includeSelfLinks),
        limit: q.limit,
        cursor: q.cursor,
      },
    });
  }

  /** Follow every cursor. Results are live, so a vanished cursor item
   * (CURSOR_INVALID) restarts the walk; duplicates are dropped. */
  async function all(q: InternalLinksQuery): Promise<InternalLink[]> {
    for (let attempt = 0; ; attempt++) {
      const seen = new Set<string>();
      const out: InternalLink[] = [];
      let cursor: string | undefined;
      try {
        do {
          const r = await page({ ...q, limit: q.limit ?? 200, cursor });
          for (const it of r.items) {
            const key = isRef(it)
              ? it.id
              : `${it.sourceDocumentId}:${it.targetDocumentId}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(it);
          }
          cursor = r.pagination?.cursor;
        } while (cursor);
        return out;
      } catch (e) {
        if (e instanceof CraftError && e.code === "CURSOR_INVALID" && attempt < 2) continue;
        throw e;
      }
    }
  }

  /** Find the document root for an id: explicit, injected resolver, then
   * membership in GET /documents (which lists every location). */
  async function findRoot(id: string, opts: LinkScopeOptions): Promise<string | null> {
    if (opts.documentId) return opts.documentId;
    if (opts.resolveDocumentId) {
      try {
        const r = await opts.resolveDocumentId(id);
        if (r) return r;
      } catch {
        // resolver is best-effort; fall through to the API check
      }
    }
    const t = await titles();
    return t.has(id.toLowerCase()) ? id : null;
  }

  async function addTitles<T extends InternalLink>(items: T[], side: "source" | "target" | "both"): Promise<T[]> {
    if (items.length === 0) return items;
    const t = await titles().catch(() => new Map<string, string>());
    return items.map((it) => {
      const out: any = { ...it };
      if ((side === "source" || side === "both") && out.sourceDocumentTitle === undefined) {
        const v = t.get(it.sourceDocumentId.toLowerCase());
        if (v !== undefined) out.sourceDocumentTitle = v;
      }
      if ((side === "target" || side === "both") && out.targetDocumentTitle === undefined) {
        const v = t.get(it.targetDocumentId.toLowerCase());
        if (v !== undefined) out.targetDocumentTitle = v;
      }
      return out as T;
    });
  }

  async function native(direction: LinkDirection, id: string, opts: LinkScopeOptions = {}): Promise<LinksResult> {
    const level = opts.level ?? "document";
    const other = direction === "in" ? "source" : "target";
    const root = await findRoot(id, opts);

    // id is a document root: ask Craft directly
    if (root && eq(root, id)) {
      const filter = direction === "in" ? { toDocumentId: root } : { fromDocumentId: root };
      let items = await all({ ...filter, level, includeSelfLinks: opts.includeSelfLinks });
      if (level === "block") items = await addTitles(items, other);
      return { direction, id, documentId: root, isDocument: true, level, items };
    }

    if (!root && !opts.scan) throw new LinkScopeError(id);

    // card or block: block-level query on its document (or the whole space),
    // then keep only references that touch the id
    const filter = !root ? {} : direction === "in" ? { toDocumentId: root } : { fromDocumentId: root };
    const refs = (await all({ ...filter, level: "block", includeSelfLinks: true })) as InternalLinkRef[];
    let kept: InternalLinkRef[];
    if (direction === "in") {
      kept = refs.filter((r) => eq(r.targetBlockId, id) && (opts.includeSelfLinks || !eq(r.sourceBlockId, id)));
    } else {
      const subtree = collectIds((await c.blocks.get(id, { maxDepth: -1 })) as Block);
      kept = refs.filter(
        (r) =>
          subtree.has(r.sourceBlockId.toLowerCase()) &&
          (opts.includeSelfLinks || !subtree.has(r.targetBlockId.toLowerCase())),
      );
    }
    kept = await addTitles(kept, other);
    const items: InternalLink[] = level === "block" ? kept : groupRefs(kept);
    return { direction, id, documentId: root, isDocument: false, level, items };
  }

  return {
    /** One page of GET /internal-links, unchanged. */
    page,
    /** Every page of GET /internal-links for a query. */
    all,
    /** Document root for any id, or null when it can't be determined. */
    findRoot,

    /** Backlinks via Craft's native /internal-links. */
    async backlinks(id: string, opts: LinkScopeOptions = {}): Promise<LinksResult> {
      return native("in", id, opts);
    },

    /** Outgoing links via Craft's native /internal-links. */
    async outgoing(id: string, opts: LinkScopeOptions = {}): Promise<LinksResult> {
      return native("out", id, opts);
    },

    /** Legacy outgoing links: parse `[text](block://UUID)` from the fetched
     * tree. Keeps link text, misses date mentions. */
    async outgoingParsed(blockId: string): Promise<BlockLink[]> {
      const root = (await c.blocks.get(blockId, { maxDepth: -1 })) as Block;
      return extractOutgoing(root, blockId);
    },

    /** Legacy backlinks via title-based search (~1 API call).
     * Pass `linkText` explicitly if the author uses custom link labels, otherwise
     * it's derived from the target block's title. */
    async backlinksLegacy(
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
