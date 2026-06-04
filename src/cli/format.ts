// output formatters: json, pretty table, tree, markdown pass-through.

export function jsonOut(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function jsonOutForArgs(data: unknown, flags: Record<string, unknown>): string {
  const select = typeof flags.select === "string" ? flags.select : undefined;
  const projected = select ? projectFields(data, select) : data;
  return JSON.stringify(projected, null, 2);
}

export function compactJson(data: unknown): string {
  return JSON.stringify(data);
}

export function projectFields(data: unknown, select: string): unknown {
  const paths = select
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (paths.length === 0) return data;
  return projectValue(data, paths);
}

function projectValue(value: unknown, paths: string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => projectValue(item, paths));
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const selectsTopLevel = paths.some((path) => {
    const top = path.split(".")[0];
    return top !== undefined && top in obj;
  });
  if (Array.isArray(obj.items) && !selectsTopLevel) {
    return { ...obj, items: obj.items.map((item) => projectValue(item, paths)) };
  }
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const found = getPath(obj, path.split("."));
    if (found.exists) setPath(out, path.split("."), found.value);
  }
  return out;
}

function getPath(obj: unknown, parts: string[]): { exists: boolean; value?: unknown } {
  let cur = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object" || !(part in cur)) return { exists: false };
    cur = (cur as Record<string, unknown>)[part];
  }
  return { exists: true, value: cur };
}

function setPath(obj: Record<string, unknown>, parts: string[], value: unknown): void {
  let cur = obj;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      cur[part] = value;
      return;
    }
    if (!cur[part] || typeof cur[part] !== "object") cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
}

/** Simple table: align columns, one row per object. */
export function table(rows: Record<string, unknown>[], cols?: string[]): string {
  if (rows.length === 0) return "(no results)";
  const keys = cols ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => cell(r[k]).length))
  );
  const header = keys.map((k, i) => k.padEnd(widths[i]!)).join("  ");
  const sep = keys.map((_, i) => "-".repeat(widths[i]!)).join("  ");
  const body = rows.map((r) =>
    keys.map((k, i) => cell(r[k]).padEnd(widths[i]!)).join("  ")
  );
  return [header, sep, ...body].join("\n");
}

function cell(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 77) + "…" : v;
  return String(v);
}

/** Tree printer for folder hierarchy */
export function folderTree(
  folders: Array<{ id: string; name: string; documentCount?: number; folders?: any[] }>,
  indent = ""
): string {
  return folders
    .map((f, i) => {
      const last = i === folders.length - 1;
      const branch = last ? "└─" : "├─";
      const count = f.documentCount !== undefined ? ` (${f.documentCount})` : "";
      const line = `${indent}${branch} ${f.name}${count}  ${dim(f.id)}`;
      const childIndent = indent + (last ? "   " : "│  ");
      const children = (f.folders && f.folders.length > 0)
        ? "\n" + folderTree(f.folders, childIndent)
        : "";
      return line + children;
    })
    .join("\n");
}

export function dim(s: string): string {
  return process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s;
}

export function bold(s: string): string {
  return process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s;
}

export function err(s: string): string {
  return process.stderr.isTTY ? `\x1b[31m${s}\x1b[0m` : s;
}

/** Strip the <page>/<pageTitle>/<content> XML wrappers the markdown endpoint
 * returns. Optional — callers may want the raw form for LLM input. */
export function stripPageWrapper(md: string): string {
  return md
    .replace(/<pageTitle>([^<]*)<\/pageTitle>/g, "# $1")
    .replace(/<page(?!Title)[^>]*>\s*/g, "")
    .replace(/<\/page>\s*/g, "")
    .replace(/<content>\s*/g, "")
    .replace(/<\/content>\s*/g, "")
    .replace(/^ {4}/gm, "") // dedent 4-space block indent from daily note wrapper
    .replace(/^ {2}/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
