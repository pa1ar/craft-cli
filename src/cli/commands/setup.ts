// craft setup --url URL --key KEY [--name PROFILE]
import { parseWithGlobals } from "../client-factory.ts";
import { CraftClient } from "../../lib/client.ts";
import { loadConfig, saveConfig, CONFIG_PATH, type Config } from "../config.ts";
import { discoverLocalStore } from "../../lib/local-db.ts";
import { bold, err, dim } from "../format.ts";

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
  // mode - a user who ran `craft mode api` explicitly should not get
  // silently flipped on re-setup. two-stage probe avoids pinning to api
  // when Craft IS installed but this specific space hasn't synced yet:
  //   1. probe for this space's store - if present, hybrid works now
  //   2. fallback: any local store at all? if yes, Craft is installed,
  //      leave mode unset (hybrid default, per-call graceful fallback)
  //   3. no stores anywhere → truly headless, pin to api
  if (!existing.mode) {
    const spaceLocal = discoverLocalStore(info.space.id);
    if (spaceLocal) {
      spaceLocal.close();
    } else {
      const anyLocal = discoverLocalStore();
      if (anyLocal) {
        anyLocal.close();
        console.error(
          `${bold("!")} Craft found but space "${info.space.name}" not synced locally yet - hybrid mode will fall back to api until sync catches up`
        );
      } else {
        existing.mode = "api";
        console.error(`${bold("!")} no local Craft store found - setting mode to api`);
      }
    }
  }

  saveConfig(existing);

  console.error(`${bold("✓")} saved profile "${profileName}" to ${CONFIG_PATH}`);
  console.error(dim(`active profile: ${existing.default}`));
  if (existing.mode === "api") {
    console.error(dim(`read mode: api (no local Craft app). change with: craft mode hybrid`));
  }

  // skill path hint for AI agents
  const skillPaths = [
    `${process.env.HOME}/.claude/skills/craft-cli/SKILL.md`,
    "skill/SKILL.md (in repo)",
  ];
  console.error(dim(`agent reference: ${skillPaths[0]}`));

  if (args.flags.json) {
    console.log(JSON.stringify({ profile: profileName, space: info.space, mode: existing.mode ?? "hybrid" }, null, 2));
  }
}
