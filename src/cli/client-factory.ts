// shared: resolve profile and build a CraftClient for a command.
import { CraftClient, type CraftClientOptions } from "../lib/client.ts";
import { resolveProfile } from "./config.ts";
import { parseArgs, type ParsedArgs } from "./args.ts";

type ClientTuning = Pick<CraftClientOptions, "timeoutMs" | "retries" | "backoffBaseMs">;

export const HEALTHCHECK_CLIENT_OPTIONS: ClientTuning = {
  timeoutMs: 5000,
  retries: 1,
  backoffBaseMs: 250,
};

export async function buildClient(
  args: ParsedArgs,
  options: ClientTuning = {}
): Promise<{ client: CraftClient; profile: string }> {
  const explicitProfile = typeof args.flags.profile === "string" ? args.flags.profile : undefined;
  const resolved = await resolveProfile(explicitProfile);
  const client = new CraftClient({ url: resolved.url, key: resolved.key, ...options });
  return { client, profile: resolved.profileName };
}

export function parseWithGlobals(argv: string[], spec: Parameters<typeof parseArgs>[1] = {}) {
  const flags = {
    ...(spec.flags ?? {}),
    profile: { type: "string" as const },
    json: { type: "boolean" as const },
    quiet: { type: "boolean" as const },
    api: { type: "boolean" as const },
    source: { type: "string" as const },
    select: { type: "string" as const },
    "dry-run": { type: "boolean" as const },
  };
  return parseArgs(argv, { ...spec, flags });
}
