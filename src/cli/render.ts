// shared rendering for `docs get` / `blocks get` / `docs daily`.
// markdown reads are local-first: the Craft Desktop PlainTextSearch mirror is
// read when available and the API is only used when it is not.
import type { CraftClient } from "../lib/client.ts";
import type { Block } from "../lib/types.ts";
import { inferTitle, LinkScopeError } from "../lib/links.ts";
import { backlinksWithFallback, localRootResolver, type AnyLink } from "./links-native.ts";
export { renderBacklinksMarkdown } from "./links-native.ts";
import { stripPageWrapper } from "./format.ts";
import { readLocalDocSafe } from "./local-safe.ts";
import type { LocalDocReadOutcome } from "./local-safe.ts";
import { shouldFallbackToApi, shouldTryLocal } from "./source.ts";
import { dailyTitleForDate } from "../lib/local-db.ts";
import type { Source } from "./config.ts";

export interface GetAndRenderOpts {
  id?: string;       // pass id OR date
  date?: string;
  depth?: number;
  metadata?: boolean;
  format: "json" | "markdown";
  raw?: boolean;     // keep <page> wrapper in markdown output
  withLinks?: boolean;  // fetch + attach backlinks (opt-in; needs the API)
  exhaustive?: boolean; // use the legacy exhaustive backlinks scan
  source?: Source;      // read source for this call (default auto)
  spaceId?: string;     // required for local-first reads
  /** Test seams for local routing; production callers should omit these. */
  localRead?: (
    target: { id?: string; dailyTitle?: string },
    opts?: { spaceId?: string },
  ) => Promise<LocalDocReadOutcome>;
}

export interface GetAndRenderResult {
  /** parsed JSON block when format==="json", or the markdown string when "markdown" */
  payload: Block | string;
  backlinks: AnyLink[] | null; // null = not fetched (opted out)
  /** which store served the content */
  servedBy: "local" | "api";
}

/** Resolve `today` / `yesterday` / `YYYY-MM-DD` / `YYYY.MM.DD` to a Date. */
export function resolveDailyDate(input: string): Date {
  const raw = (input ?? "").trim().toLowerCase();
  const now = new Date();
  if (raw === "" || raw === "today") return now;
  if (raw === "yesterday") {
    now.setDate(now.getDate() - 1);
    return now;
  }
  if (raw === "tomorrow") {
    now.setDate(now.getDate() + 1);
    return now;
  }
  const m = raw.match(/^(\d{4})[-.](\d{2})[-.](\d{2})$/);
  if (!m) {
    throw new Error(`invalid daily date: ${input}; expected today, yesterday, tomorrow, or YYYY-MM-DD`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error(`invalid daily date: ${input}; calendar date is out of range`);
  }
  return parsed;
}

function formatDailyApiDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export async function getAndRender(
  client: CraftClient,
  opts: GetAndRenderOpts
): Promise<GetAndRenderResult> {
  const source = opts.source ?? "auto";
  const withLinks = opts.withLinks === true || opts.exhaustive === true;
  const localRead = opts.localRead ?? readLocalDocSafe;
  const resolvedDate = opts.date ? resolveDailyDate(opts.date) : undefined;
  const apiDate = resolvedDate ? formatDailyApiDate(resolvedDate) : undefined;

  // `local` is a hard source contract. Reject every operation whose result
  // cannot come entirely from the Desktop mirror before touching the client.
  if (source === "local") {
    if (!opts.spaceId) {
      throw new Error("--source local requires a resolved Craft spaceId; use --source auto or --source api");
    }
    if (
      opts.format !== "markdown" ||
      opts.depth !== undefined ||
      opts.metadata ||
      opts.raw ||
      withLinks
    ) {
      throw new Error("--source local supports cached markdown reads only (no --json, --depth, --metadata, --raw, --links, or --exhaustive); use --source auto or --source api");
    }
  }

  // Local-first only covers whole-document markdown. depth and metadata are
  // API-only semantics, and --json needs block ids, so those stay on the API.
  // Craft Desktop owns synchronization. Cached Markdown is the local source;
  // callers needing immediate remote confirmation explicitly choose API.
  const localEligible =
    opts.format === "markdown" &&
    shouldTryLocal(source) &&
    opts.spaceId !== undefined &&
    opts.depth === undefined &&
    !opts.metadata &&
    !opts.raw;

  if (localEligible) {
    const local = await localRead(
      {
        id: opts.id,
        dailyTitle: resolvedDate ? dailyTitleForDate(resolvedDate) : undefined,
      },
      { spaceId: opts.spaceId },
    );

    if (local.status === "available" && local.doc) {
      const backlinks = withLinks
        ? await fetchBacklinks(client, local.doc.id, local.doc.title, opts)
        : null;
      return { payload: local.doc.markdown, backlinks, servedBy: "local" };
    }

    if (!shouldFallbackToApi(source)) {
      if (local.status === "available" && !local.doc) {
        throw new Error(
          "document is not present in the local Craft cache; use --source auto or --source api",
        );
      }
      throw new Error(
        `local Craft store unavailable (${local.status}); use --source auto or --source api`,
      );
    }
  }

  // --- API path ---
  const fetchBlock = async (format: "json" | "markdown") => {
    if (opts.id) {
      return await client.blocks.get(opts.id, {
        maxDepth: opts.depth ?? -1,
        fetchMetadata: opts.metadata,
        format,
      });
    }
    if (apiDate) {
      return await client.blocks.getDaily(apiDate, {
        maxDepth: opts.depth ?? -1,
        fetchMetadata: opts.metadata,
        format,
      });
    }
    throw new Error("id or date required");
  };

  // markdown-only reads are a single request. The structured fetch is only
  // needed when backlinks are requested, since they need the title.
  if (opts.format === "markdown") {
    const md = (await fetchBlock("markdown")) as string;
    const payload = opts.raw ? md : stripPageWrapper(md);
    let backlinks: AnyLink[] | null = null;
    if (withLinks) {
      // native backlinks need only the id; the structured fetch is for daily
      // notes (no id yet) and the legacy fallback's title
      const structured = opts.id ? undefined : ((await fetchBlock("json")) as Block);
      backlinks = await fetchBacklinks(
        client,
        opts.id ?? structured!.id,
        structured ? inferTitle(structured) : undefined,
        opts,
      );
    }
    return { payload, backlinks, servedBy: "api" };
  }

  const structured = (await fetchBlock("json")) as Block;
  const backlinks = withLinks
    ? await fetchBacklinks(client, opts.id ?? structured.id, inferTitle(structured), opts)
    : null;
  return { payload: structured, backlinks, servedBy: "api" };
}

/** Backlinks for --links reads: Craft's native /internal-links, the legacy
 * full scan with --exhaustive. Never let them fail a read. */
async function fetchBacklinks(
  client: CraftClient,
  id: string,
  title: string | undefined,
  opts: GetAndRenderOpts,
): Promise<AnyLink[]> {
  try {
    if (opts.exhaustive) return await client.links.backlinksExhaustive(id);
    return await backlinksWithFallback(client, id, {
      title,
      resolveDocumentId: localRootResolver(opts.spaceId, opts.source ?? "auto"),
    });
  } catch (e) {
    if (e instanceof LinkScopeError) console.error(`backlinks skipped: ${e.message}`);
    return [];
  }
}

export function attachBacklinksJson(block: Block, backlinks: AnyLink[] | null): unknown {
  if (backlinks === null) return block;
  return { ...block, backlinks };
}
