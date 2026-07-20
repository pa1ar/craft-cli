// Build a single-file executable via bun build --compile.
// Bun's final bundle write can invalidate the Mach-O linker signature on newer
// macOS versions, so sign the completed artifact before it is executed.
import { $ } from "bun";

const output = "./dist/craft";

await $`bun build ./src/cli/main.ts --compile --minify --outfile ${output}`;

if (process.platform === "darwin") {
  await $`/usr/bin/codesign --force --sign - ${output}`;
  await $`/usr/bin/codesign --verify --deep --strict --verbose=2 ${output}`;
}

// Catch invalid signatures and other launch-time failures before install.sh
// links the binary into PATH.
await $`${output} --help`.quiet();

console.log(`built and verified ${output}`);
