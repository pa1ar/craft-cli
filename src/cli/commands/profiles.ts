import { parseWithGlobals } from "../client-factory.ts";
import { loadConfig, saveConfig } from "../config.ts";
import { bold, dim, err } from "../format.ts";

export async function runProfiles(argv: string[]) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const args = parseWithGlobals(rest);

  const cfg = await loadConfig();
  if (!cfg) {
    console.error(err("no config. run: craft setup --url URL --key KEY"));
    process.exit(1);
  }

  switch (sub) {
    case undefined:
    case "ls":
    case "list": {
      if (args.flags.json) {
        console.log(JSON.stringify(cfg, null, 2));
        return;
      }
      for (const [name, p] of Object.entries(cfg.profiles)) {
        const marker = name === cfg.default ? "*" : " ";
        console.log(`${marker} ${bold(name)}  ${p.spaceName ?? ""} ${dim(p.url)}`);
      }
      return;
    }
    case "use": {
      const name = args.positional[0];
      if (!name || !cfg.profiles[name]) {
        console.error(err(`unknown profile: ${name}`));
        process.exit(1);
      }
      cfg.default = name;
      saveConfig(cfg);
      console.log(`default profile → ${name}`);
      return;
    }
    case "rm":
    case "remove": {
      const name = args.positional[0];
      if (!name || !cfg.profiles[name]) {
        console.error(err(`unknown profile: ${name}`));
        process.exit(1);
      }
      delete cfg.profiles[name];
      if (cfg.default === name) {
        cfg.default = Object.keys(cfg.profiles)[0] ?? "";
      }
      saveConfig(cfg);
      console.log(`removed profile ${name}`);
      return;
    }
    default:
      console.error(err(`unknown subcommand: profiles ${sub}`));
      console.error("usage: craft profiles {list|use NAME|rm NAME}");
      process.exit(1);
  }
}
