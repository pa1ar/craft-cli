/** Small, composable shaping helpers for bounded Markdown reads. */

export interface ReadShapeOptions {
  lines?: { start: number; end: number };
  head?: number;
  outline?: boolean;
  budget?: number;
}

export const TRUNCATION_MARKER = "[truncated]";

/** Parse an inclusive, one-based line range such as `12:24`. */
export function parseLineRange(value: unknown): { start: number; end: number } {
  if (typeof value !== "string" || !/^\d+:\d+$/.test(value)) {
    throw new Error("--lines must be a positive inclusive range in the form A:B");
  }
  const [startRaw, endRaw] = value.split(":");
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (!isPositiveInteger(start) || !isPositiveInteger(end) || start > end) {
    throw new Error("--lines must be a positive inclusive range in the form A:B (A <= B)");
  }
  return { start, end };
}

function positiveInteger(value: unknown, flag: string): number | undefined {
  if (value === undefined || value === false || value === null) return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!isPositiveInteger(number)) throw new Error(`${flag} must be a positive integer`);
  return number;
}

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Convert parsed command flags into validated shaping options. */
export function readShapeOptions(
  flags: Record<string, unknown>,
  format: "json" | "markdown" = "markdown",
): ReadShapeOptions | undefined {
  const hasLines = flags.lines !== undefined;
  const hasHead = flags.head !== undefined;
  const outline = flags.outline === true;
  const hasBudget = flags.budget !== undefined;
  if (!hasLines && !hasHead && !outline && !hasBudget) return undefined;
  if (format === "json") {
    throw new Error("read shaping flags (--lines, --head, --outline, --budget) require Markdown output; remove --json");
  }
  if (flags.raw === true) {
    throw new Error("read shaping flags cannot be combined with --raw");
  }
  if (hasLines && hasHead) throw new Error("--lines and --head cannot be combined");
  if (outline && (hasLines || hasHead)) {
    throw new Error("--outline cannot be combined with --lines or --head");
  }
  const budget = hasBudget ? positiveInteger(flags.budget, "--budget") : undefined;
  if (budget !== undefined && budget < Array.from(TRUNCATION_MARKER).length) {
    throw new Error(`--budget must be at least ${Array.from(TRUNCATION_MARKER).length} characters to include the truncation marker`);
  }
  return {
    lines: hasLines ? parseLineRange(flags.lines) : undefined,
    head: hasHead ? positiveInteger(flags.head, "--head") : undefined,
    outline,
    budget,
  };
}

/** Apply line/range/outline shaping, then an optional character budget. */
export function shapeMarkdown(markdown: string, options: ReadShapeOptions = {}): string {
  let shaped = markdown;
  const sourceLines = options.lines || options.head !== undefined || options.outline
    ? markdown.split(/\r?\n/) : [];
  if (options.lines) {
    shaped = sourceLines.slice(options.lines.start - 1, options.lines.end).join("\n");
  } else if (options.head !== undefined) {
    shaped = sourceLines.slice(0, options.head).join("\n");
  } else if (options.outline) {
    shaped = markdownOutline(sourceLines);
  }
  return options.budget === undefined ? shaped : applyCharacterBudget(shaped, options.budget);
}

/** Return Markdown headings with their original one-based line numbers. */
export function markdownOutline(lines: string[]): string {
  const output: string[] = [];
  let fence: { char: "`" | "~"; length: number } | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const run = fenceMatch[1]!;
      const char = run[0] as "`" | "~";
      if (!fence || (fence.char === char && run.length >= fence.length && fenceMatch[2]!.trim() === "")) {
        fence = fence ? undefined : { char, length: run.length };
      }
      continue;
    }
    if (fence) continue;
    const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*?)[ \t]*#*[ \t]*$/);
    if (match) output.push(`${index + 1}: ${line.trimEnd()}`);
  }
  return output.join("\n");
}

/** Bound a single string to N characters, preserving an explicit marker. */
export function applyCharacterBudget(text: string, budget: number): string {
  if (!isPositiveInteger(budget)) throw new Error("--budget must be a positive integer");
  const markerLength = Array.from(TRUNCATION_MARKER).length;
  if (budget < markerLength) {
    throw new Error(`--budget must be at least ${markerLength} characters to include the truncation marker`);
  }
  // Stop after budget + 1 code points instead of allocating an array for the
  // entire document. Track a UTF-16 offset so slicing never splits a surrogate.
  let count = 0;
  let offset = 0;
  let cut = 0;
  for (const character of text) {
    if (count === budget - markerLength) cut = offset;
    if (count === budget) return `${text.slice(0, cut)}${TRUNCATION_MARKER}`;
    count++;
    offset += character.length;
  }
  return text;
}

/** Apply one character budget to already-rendered, multi-document output. */
export function applyDocumentBudget(documents: string[], budget: number, separator = "\n---\n\n"): string {
  return applyCharacterBudget(documents.join(separator), budget);
}
