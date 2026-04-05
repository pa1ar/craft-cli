// tiny arg parser — no deps, no magic. each command calls parse() with its own spec.

export interface ArgSpec {
  /** positional arg names in order; use "..." suffix for rest */
  positional?: string[];
  /** flag name → { type, alias, multi } */
  flags?: Record<string, { type: "string" | "number" | "boolean"; alias?: string; multi?: boolean }>;
}

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, any>;
}

export function parseArgs(argv: string[], spec: ArgSpec = {}): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, any> = {};
  const specFlags = spec.flags ?? {};
  const aliasMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(specFlags)) {
    if (v.alias) aliasMap[v.alias] = k;
    if (v.type === "boolean") flags[k] = false;
    if (v.multi) flags[k] = [];
  }

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const [nameRaw, inlineVal] = arg.slice(2).split("=", 2);
      const name = aliasMap[nameRaw!] ?? nameRaw!;
      const def = specFlags[name];
      if (!def) {
        // unknown flag — collect as string for raw passthrough
        flags[name] = inlineVal ?? (argv[i + 1] && !argv[i + 1]!.startsWith("-") ? argv[++i] : true);
      } else if (def.type === "boolean") {
        flags[name] = inlineVal !== "false";
      } else {
        const val = inlineVal ?? argv[++i];
        if (val === undefined) throw new Error(`flag --${name} requires a value`);
        const cast = def.type === "number" ? Number(val) : val;
        if (def.multi) (flags[name] ??= []).push(cast);
        else flags[name] = cast;
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      // short flag(s)
      const letters = arg.slice(1);
      for (const l of letters) {
        const name = aliasMap[l];
        if (!name) continue;
        const def = specFlags[name]!;
        if (def.type === "boolean") {
          flags[name] = true;
        } else {
          const val = argv[++i];
          if (val === undefined) throw new Error(`flag -${l} requires a value`);
          flags[name] = def.type === "number" ? Number(val) : val;
        }
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  return { positional, flags };
}

/** Read stdin to string when positional arg is "-" or when --stdin */
export async function readStdin(): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(out);
}
