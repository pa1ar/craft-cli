// build a single-file executable via bun build --compile
import { $ } from "bun";

await $`bun build ./src/cli/main.ts --compile --minify --outfile ./dist/craft`;
console.log("built ./dist/craft");
