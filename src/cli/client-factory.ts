// shared: resolve profile and build a CraftClient for a command.
import { CraftClient } from "../lib/client.ts";
import { resolveProfile } from "./config.ts";
import { parseArgs, type ParsedArgs } from "./args.ts";

export async function buildClient(args: ParsedArgs): Promise<{ client: CraftClient; profile: string }> {
  const explicitProfile = typeof args.flags.profile === "string" ? args.flags.profile : undefined;
  const resolved = await resolveProfile(explicitProfile);
  const client = new CraftClient({ url: resolved.url, key: resolved.key });
  return { client, profile: resolved.profileName };
}

export function parseWithGlobals(argv: string[], spec: Parameters<typeof parseArgs>[1] = {}) {
  const flags = {
    ...(spec.flags ?? {}),
    profile: { type: "string" as const },
    json: { type: "boolean" as const },
    quiet: { type: "boolean" as const },
    api: { type: "boolean" as const },
  };
  return parseArgs(argv, { ...spec, flags });
}
