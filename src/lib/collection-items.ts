/** Client-side helpers for clean, filterable collection item retrieval. */

export type CollectionItemLike = {
  id?: string;
  title?: string;
  properties?: Record<string, unknown>;
  contentPreviewMd?: string;
  content?: unknown;
  [key: string]: unknown;
};

export type CollectionItemFilters = {
  /** Match properties.status (case-insensitive). Comma-separated OR. */
  status?: string;
  /**
   * Match assignee multiSelect membership (forAI / byAI / pa1ar).
   * Also accepts legacy boolean forai/byai properties during transition.
   */
  forai?: boolean;
  byai?: boolean;
  /** Match assignee contains this value (e.g. pa1ar). */
  assignee?: string;
  /** Exact property matches: key=value (repeatable). */
  props?: string[];
  /** Substring match on title (case-insensitive). */
  text?: string;
  /** Cap returned rows after filtering. */
  limit?: number;
};

function propValue(item: CollectionItemLike, key: string): unknown {
  const props = item.properties ?? {};
  if (key in props) return props[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(props)) {
    if (k.toLowerCase() === lower) return v;
  }
  if (key in item) return item[key];
  return undefined;
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v === undefined || v === null || v === "") return [];
  return [String(v)];
}

function listIncludes(v: unknown, want: string): boolean {
  const target = want.toLowerCase();
  return asStringList(v).some((x) => x.toLowerCase() === target);
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "yes" || v === "1") return true;
  if (v === "false" || v === "no" || v === "0") return false;
  return undefined;
}

function parseBoolFlag(raw: unknown): boolean | undefined {
  if (raw === true || raw === false) return raw;
  if (typeof raw !== "string") return undefined;
  const s = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return undefined;
}

/** Normalize CLI flag values into CollectionItemFilters. */
export function filtersFromFlags(flags: Record<string, unknown>): CollectionItemFilters {
  const propFlag = flags.prop;
  const props = Array.isArray(propFlag)
    ? propFlag.map(String)
    : typeof propFlag === "string"
      ? [propFlag]
      : [];
  const limitRaw = flags.limit;
  return {
    status: typeof flags.status === "string" ? flags.status : undefined,
    forai: parseBoolFlag(flags.forai ?? flags.forAI),
    byai: parseBoolFlag(flags.byai ?? flags.byAI),
    assignee: typeof flags.assignee === "string" ? flags.assignee : undefined,
    props,
    text: typeof flags.text === "string" ? flags.text : typeof flags.q === "string" ? flags.q : undefined,
    limit: typeof limitRaw === "number" ? limitRaw : typeof limitRaw === "string" ? Number(limitRaw) : undefined,
  };
}

export function filterCollectionItems<T extends CollectionItemLike>(
  items: T[],
  filters: CollectionItemFilters
): T[] {
  let out = items;

  if (filters.status) {
    const wanted = new Set(
      filters.status
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
    out = out.filter((item) => {
      const st = String(propValue(item, "status") ?? "").toLowerCase();
      return wanted.has(st);
    });
  }

  if (filters.forai !== undefined) {
    out = out.filter((item) => {
      const assignees = propValue(item, "assignee");
      const legacy = asBool(propValue(item, "forai"));
      const has = listIncludes(assignees, "forAI") || legacy === true;
      return filters.forai ? has : !has;
    });
  }

  if (filters.byai !== undefined) {
    out = out.filter((item) => {
      const assignees = propValue(item, "assignee");
      const legacy = asBool(propValue(item, "byai"));
      const has = listIncludes(assignees, "byAI") || legacy === true;
      return filters.byai ? has : !has;
    });
  }

  if (filters.assignee) {
    out = out.filter((item) => listIncludes(propValue(item, "assignee"), filters.assignee!));
  }

  if (filters.props && filters.props.length > 0) {
    for (const raw of filters.props) {
      const eq = raw.indexOf("=");
      if (eq <= 0) continue;
      const key = raw.slice(0, eq).trim();
      const want = raw.slice(eq + 1).trim();
      out = out.filter((item) => {
        const got = propValue(item, key);
        if (Array.isArray(got)) return got.map(String).includes(want);
        if (typeof got === "boolean") return String(got) === want.toLowerCase() || String(got) === want;
        return String(got ?? "") === want;
      });
    }
  }

  if (filters.text) {
    const q = filters.text.toLowerCase();
    out = out.filter((item) => String(item.title ?? "").toLowerCase().includes(q));
  }

  if (typeof filters.limit === "number" && Number.isFinite(filters.limit) && filters.limit >= 0) {
    out = out.slice(0, filters.limit);
  }

  return out;
}

/** Drop bulky preview/content fields agents rarely need in list views. */
export function stripItemNoise<T extends CollectionItemLike>(item: T, keepPreview = false): T {
  const next: Record<string, unknown> = { ...item };
  if (!keepPreview) {
    delete next.contentPreviewMd;
    delete next.content;
  }
  return next as T;
}

/**
 * Flatten `properties` onto the item (properties win only if top-level missing).
 * Useful for `--select status,forai,linearid` without `properties.` prefix.
 */
export function flattenItemProps<T extends CollectionItemLike>(
  item: T,
  opts: { dropPropertiesBag?: boolean } = {}
): Record<string, unknown> {
  const props = item.properties ?? {};
  const out: Record<string, unknown> = { ...item };
  for (const [k, v] of Object.entries(props)) {
    if (!(k in out) || out[k] === undefined) out[k] = v;
  }
  if (opts.dropPropertiesBag) delete out.properties;
  return out;
}

export function itemsForAgentOutput(
  items: CollectionItemLike[],
  opts: { preview?: boolean; flat?: boolean } = {}
): Record<string, unknown>[] {
  return items.map((item) => {
    const cleaned = stripItemNoise(item, opts.preview === true);
    return opts.flat ? flattenItemProps(cleaned, { dropPropertiesBag: true }) : cleaned;
  });
}

/** Compact table rows for human/agent terminal scans. */
export function itemsToTableRows(items: CollectionItemLike[]): Record<string, unknown>[] {
  return items.map((item) => {
    const op = propValue(item, "operation") as { relations?: { title?: string }[] } | undefined;
    const opTitle = op?.relations?.[0]?.title ?? "";
    return {
      id: item.id ?? "",
      title: item.title ?? "",
      status: propValue(item, "status") ?? "",
      priority: propValue(item, "priority") ?? "",
      assignee: asStringList(propValue(item, "assignee")).join(","),
      operation: opTitle,
      tldr: propValue(item, "tldr") ?? "",
    };
  });
}
