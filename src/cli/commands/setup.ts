// craft setup --url URL --key KEY [--name PROFILE]
import { parseWithGlobals } from "../client-factory.ts";
import { CraftClient } from "../../lib/client.ts";
import { loadConfig, saveConfig, CONFIG_PATH, type Config } from "../config.ts";
import { probeLocalStoreSafe } from "../local-safe.ts";
import { bold, err, dim, jsonOutForArgs } from "../format.ts";

export async function runSetup(argv: string[]) {
  const args = parseWithGlobals(argv, {
    flags: {
      url: { type: "string" },
      key: { type: "string" },
      name: { type: "string" }, // --name profile name (kept separate from --profile which overrides)
    },
  });

  const url = args.flags.url;
  const key = args.flags.key;
  if (!url || !key) {
    console.error(err("craft setup --url URL --key KEY [--name PROFILE]"));
    process.exit(1);
  }

  const profileName = args.flags.name || args.flags.profile || "main";

  console.error(dim(`verifying credentials against ${url} …`));
  const client = new CraftClient({ url, key });
  const info = await client.connection();
  console.error(
    `${bold("✓")} connected to space ${bold(info.space.name)} (${info.space.id})`
  );

  const existing: Config = (await loadConfig()) ?? { default: profileName, profiles: {} as Record<string, any> };
  existing.profiles[profileName] = {
    url,
    key,
    spaceName: info.space.name,
    spaceId: info.space.id,
  };
  if (!existing.default || Object.keys(existing.profiles).length === 1) {
    existing.default = profileName;
  }

  // auto-detect headless on first setup only. never overrides an existing
  // source - a user who ran `craft source api` explicitly should not get
  // silently flipped on re-setup. two-stage probe avoids pinning to api
  // when Craft IS installed but this specific space hasn't synced yet:
  //   1. probe for this space's store - if present, hybrid works now
  //   2. fallback: any local store at all? if yes, Craft is installed,
  //      leave mode unset (hybrid default, per-call graceful fallback)
  //   3. no stores anywhere → truly headless, pin to api
  if (!existing.source && !existing.mode) {
    const spaceLocal = await probeLocalStoreSafe({ spaceId: info.space.id });
    if (spaceLocal.status === "available") {
      // hybrid default is fine.
    } else if (spaceLocal.status === "timeout" || spaceLocal.status === "error") {
      console.error(
        `${bold("!")} local Craft probe did not finish - leaving source auto with API fallback`
      );
    } else {
      const anyLocal = await probeLocalStoreSafe();
      if (anyLocal.status === "available") {
        console.error(
          `${bold("!")} Craft found but space "${info.space.name}" not synced locally yet - source auto will fall back to api until sync catches up`
        );
      } else if (anyLocal.status === "timeout" || anyLocal.status === "error") {
        console.error(
          `${bold("!")} local Craft probe did not finish - leaving source auto with API fallback`
        );
      } else {
        existing.source = "api";
        console.error(`${bold("!")} no local Craft store found - setting source to api`);
      }
    }
  }

  saveConfig(existing);

  console.error(`${bold("✓")} saved profile "${profileName}" to ${CONFIG_PATH}`);
  console.error(dim(`active profile: ${existing.default}`));
  if (existing.source === "api" || existing.mode === "api") {
    console.error(dim("read source: api (no local Craft app). change with: craft source auto"));
  }

  // Agent harnesses use different skill directories. Respect a user-configured
  // canonical skill first; otherwise register the bundled repo skill there.
  console.error(dim("agent skill: use the user's canonical craft-cli skill, or register the repo's skill/SKILL.md with this harness"));

  if (args.flags.json) {
    console.log(jsonOutForArgs({ profile: profileName, space: info.space, source: existing.source ?? (existing.mode === "api" ? "api" : "auto") }, args.flags));
  }
}
