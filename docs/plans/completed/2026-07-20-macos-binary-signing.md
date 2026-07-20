# macOS compiled binary signing

Issue: LABS-264

## Goal

Prevent Bun-compiled craft-cli binaries from being killed by macOS with exit 137 when their linker signature is invalidated during compilation.

## Changes

- Re-sign the finished Mach-O ad hoc on macOS, after Bun has written the complete executable.
- Verify the signature and execute a CLI help smoke test as part of every build.
- Make `install.sh` independently confirm that the compiled binary launches before linking it.
- Add a changelog entry for the install fix.

## Verification

- `bun test tests/unit`
- `bun run typecheck`
- `bun run build`
- `codesign --verify --deep --strict --verbose=4 dist/craft`
- `./install.sh`
- installed `craft whoami --json`
- installed `craft tasks --json` state counts

## Result

- Bun compilation is followed by macOS ad-hoc signing, strict signature verification, and a launch smoke test.
- `install.sh` independently refuses to link a binary that cannot execute.
- The rebuilt and installed binary passes strict `codesign` verification and matches `dist/craft` by SHA-256.
- Installed CLI verification reached the `1ar` Craft space and returned 1,492 tasks: 328 todo, 940 done, and 224 canceled.
