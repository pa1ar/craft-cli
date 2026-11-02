// CLI glue for Craft's native /internal-links: local root resolution,
// legacy fallback and rendering. Library logic lives in src/lib/links.ts.
import type { CraftClient } from "../lib/client.ts";
import type { BlockLink, InternalLink, InternalLinkRef } from "../lib/types.ts";
import { isInternalLinksUnavailable, type LinkScopeOptions } from "../lib/links.ts";
import { localDocumentRootSafe } from "./local-safe.ts";
import { shouldTryLocal } from "./source.ts";
import type { Source } from "./config.ts";
import { dim } from "./format.ts";

export type AnyLink = InternalLink | BlockLink;

/** Resolver that maps a block id to its document root via the local Craft
 * cache. Disabled under --source api. */
export function localRootResolver(spaceId: string | undefined, source: Source): LinkScopeOptions["resolveDocumentId"] {
  if (!spaceId || !shouldTryLocal(source)) return undefined;
  return (id: string) => localDocumentRootSafe(id, { spaceId });
}

/** Native backlinks with the legacy title search as fallback only when the
 * experimental endpoint is unavailable. */
export async function backlinksWithFallback(
  client: CraftClient,
  id: string,
  opts: LinkScopeOptions & { title?: string },
): Promise<AnyLink[]> {
  try {
    return (await client.links.backlinks(id, opts)).items;
  } catch (e) {
    if (!isInternalLinksUnavailable(e)) throw e;
    console.error(dim("internal-links endpoint unavailable; using legacy title search (may be incomplete)"));
    return client.links.backlinksLegacy(id, { linkText: opts.title });
  }
}

function isLegacy(l: AnyLink): l is BlockLink {
  return (l as BlockLink).inBlockId !== undefined;
}

function isRef(l: AnyLink): l is InternalLinkRef {
  return (l as InternalLinkRef).sourceBlockId !== undefined;
}

/** Table rows for `links in` / `links out`. */
export function linkRows(links: AnyLink[], direction: "in" | "out"): Record<string, unknown>[] {
  return links.map((l) => {
    if (isLegacy(l)) {
      return direction === "in"
        ? { source_doc: l.inDocumentId, source_block: l.inBlockId, text: l.text }
        : { target: l.blockId, text: l.text, from: l.inBlockId };
    }
    const title = direction === "in" ? l.sourceDocumentTitle : l.targetDocumentTitle;
    const doc = direction === "in" ? l.sourceDocumentId : l.targetDocumentId;
    if (isRef(l)) {
      return direction === "in"
        ? { title: title ?? "", source_doc: doc, source_block: l.sourceBlockId, target_block: l.targetBlockId }
        : { title: title ?? "", target_doc: doc, target_block: l.targetBlockId, from_block: l.sourceBlockId };
    }
    return direction === "in"
      ? { title: title ?? "", source_doc: doc, refs: l.referenceCount }
      : { title: title ?? "", target_doc: doc, refs: l.referenceCount };
  });
}

/** `## Backlinks` section appended to markdown reads with --links. */
export function renderBacklinksMarkdown(backlinks: AnyLink[]): string {
  if (backlinks.length === 0) return "\n\n---\n\n## Backlinks\n\n_none_\n";
  const lines = backlinks.map((l) => {
    if (isLegacy(l)) {
      return `- **${l.text || "(untitled)"}** → \`${l.inDocumentId}\` / \`${l.inBlockId}\``;
    }
    const title = l.sourceDocumentTitle || "(untitled)";
    if (isRef(l)) return `- **${title}** → \`${l.sourceDocumentId}\` / \`${l.sourceBlockId}\``;
    const refs = l.referenceCount > 1 ? ` (${l.referenceCount} refs)` : "";
    return `- **${title}** → \`${l.sourceDocumentId}\`${refs}`;
  });
  return `\n\n---\n\n## Backlinks (${backlinks.length})\n\n${lines.join("\n")}\n`;
}
