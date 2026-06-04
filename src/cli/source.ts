import type { ParsedArgs } from "./args.ts";
import { normalizeSource, type Source } from "./config.ts";
import { getSourceOverride } from "./local.ts";

export function sourceFromArgs(args: ParsedArgs): Source {
  if (args.flags.api) return "api";
  if (typeof args.flags.source === "string") {
    const source = normalizeSource(args.flags.source);
    if (!source) throw new Error(`invalid --source: ${args.flags.source}. expected auto|api|local`);
    return source;
  }
  return getSourceOverride();
}

export function shouldTryLocal(source: Source): boolean {
  return source === "auto" || source === "local";
}

export function shouldFallbackToApi(source: Source): boolean {
  return source === "auto";
}
