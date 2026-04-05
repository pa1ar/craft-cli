// craft setup --url URL --key KEY [--profile NAME]
import { parseWithGlobals } from "../client-factory.ts";
import { CraftClient } from "../../lib/client.ts";
import { loadConfig, saveConfig, CONFIG_PATH } from "../config.ts";
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

  const existing = (await loadConfig()) ?? { default: profileName, profiles: {} as Record<string, any> };
  existing.profiles[profileName] = {
    url,
    key,
    spaceName: info.space.name,
    spaceId: info.space.id,
  };
  if (!existing.default || Object.keys(existing.profiles).length === 1) {
    existing.default = profileName;
  }
  saveConfig(existing);

  console.error(`${bold("✓")} saved profile "${profileName}" to ${CONFIG_PATH}`);
  console.error(dim(`active profile: ${existing.default}`));
  if (args.flags.json) {
    console.log(JSON.stringify({ profile: profileName, space: info.space }, null, 2));
  }
}
