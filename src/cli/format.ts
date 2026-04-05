// output formatters: json, pretty table, tree, markdown pass-through.

export function jsonOut(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function compactJson(data: unknown): string {
  return JSON.stringify(data);
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
