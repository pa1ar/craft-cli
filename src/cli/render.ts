// shared rendering for `docs get` / `blocks get` / `docs daily`.
// Fetches the block, optionally fetches backlinks in parallel, renders as JSON
// or markdown with a trailing Backlinks section.
import type { CraftClient } from "../lib/client.ts";
import type { Block, BlockLink } from "../lib/types.ts";
import { inferTitle } from "../lib/links.ts";
import { stripPageWrapper } from "./format.ts";

export interface GetAndRenderOpts {
  id?: string;       // pass id OR date
  date?: string;
  depth?: number;
  metadata?: boolean;
  format: "json" | "markdown";
  raw?: boolean;     // keep <page> wrapper in markdown output
  withLinks?: boolean;  // fetch + attach backlinks (default true)
  exhaustive?: boolean; // use exhaustive backlinks scan
}

export interface GetAndRenderResult {
  /** parsed JSON block when format==="json", or the markdown string when "markdown" */
  payload: Block | string;
  backlinks: BlockLink[] | null; // null = not fetched (opted out)
}

export async function getAndRender(
  client: CraftClient,
  opts: GetAndRenderOpts
): Promise<GetAndRenderResult> {
  const withLinks = opts.withLinks !== false;

  // we always need the structured block once for title extraction if backlinks
  // are requested. fetching twice (once json, once markdown) would waste a call,
  // so we fetch JSON first when we need the title, then request markdown render
  // only if the caller asked for markdown.
  //
  // optimization: if the caller only wants JSON and no backlinks, skip the
  // double-fetch entirely.
  const fetchBlock = async (format: "json" | "markdown") => {
    if (opts.id) {
      return await client.blocks.get(opts.id, {
        maxDepth: opts.depth ?? -1,
        fetchMetadata: opts.metadata,
        format,
      });
    }
    if (opts.date) {
      return await client.blocks.getDaily(opts.date, {
        maxDepth: opts.depth ?? -1,
        fetchMetadata: opts.metadata,
        format,
      });
    }
    throw new Error("id or date required");
  };

  // fetch structured block + backlinks in parallel (backlinks call needs the
  // target id which we already have, not the block itself)
  const targetId = opts.id; // for date case, we only know the id after fetch
  const structuredPromise = fetchBlock("json") as Promise<Block>;

  let backlinksPromise: Promise<BlockLink[]> | null = null;
  if (withLinks && targetId) {
    // we can start backlinks in parallel for the id path — we'll need the title
    // which requires the structured block, but search can use a title we infer
    // later. So we actually MUST wait for structured block first. Run sequential
    // then.
  }

  const structured = await structuredPromise;

  let backlinks: BlockLink[] | null = null;
  if (withLinks) {
    const title = inferTitle(structured);
    // resolve the id we'll use for backlinks (date path needed structured first)
    const resolveId = targetId ?? structured.id;
    if (title) {
      try {
        backlinks = opts.exhaustive
          ? await client.links.backlinksExhaustive(resolveId)
          : await client.links.backlinks(resolveId, { linkText: title });
      } catch {
        backlinks = [];
      }
    } else {
      backlinks = [];
    }
  }

  // for markdown format we need a second fetch with the markdown accept header.
  // this is unavoidable because the API returns one or the other, not both.
  let payload: Block | string;
  if (opts.format === "markdown") {
    const md = (await fetchBlock("markdown")) as string;
    payload = opts.raw ? md : stripPageWrapper(md);
  } else {
    payload = structured;
  }

  return { payload, backlinks };
}

export function renderBacklinksMarkdown(backlinks: BlockLink[]): string {
  if (backlinks.length === 0) return "\n\n---\n\n## Backlinks\n\n_none_\n";
  const lines = backlinks.map((l) => {
    const text = l.text || "(untitled)";
    return `- **${text}** → \`${l.inDocumentId}\` / \`${l.inBlockId}\``;
  });
  return `\n\n---\n\n## Backlinks (${backlinks.length})\n\n${lines.join("\n")}\n`;
}

export function attachBacklinksJson(block: Block, backlinks: BlockLink[] | null): unknown {
  if (backlinks === null) return block;
  return { ...block, backlinks };
}
