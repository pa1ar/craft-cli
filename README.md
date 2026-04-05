# @1ar/craft-cli

Fast CLI wrapping the Craft Docs "API for All Docs". Built for LLM tool use (Claude Code) and Raycast reuse.

## Install

```sh
cd ~/dev/tools/craft-cli
bun install
bun run build
ln -sf "$PWD/dist/craft" ~/.local/bin/craft
```

## Setup

```sh
craft setup --url "https://connect.craft.do/links/XXX/api/v1" --key "pdk_..."
craft whoami
```

Credentials are verified via `GET /connection` and stored at `~/.config/craft-cli/config.json` (mode 0600).

Env overrides: `CRAFT_URL`, `CRAFT_KEY`, `CRAFT_PROFILE`.

## Library usage (Node or Bun)

```ts
import { CraftClient } from "@1ar/craft-cli/lib";

const craft = new CraftClient({ url: process.env.CRAFT_URL!, key: process.env.CRAFT_KEY! });
const hits = await craft.documents.search({ regexps: "LTM|memory" });
```

See `trials/CAVEATS.md` in `~/dev/craft-docs/craft-do-api/` for behavioral gotchas.
