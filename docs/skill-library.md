# Remote skill library

`craft lib` reads reviewed skill instructions from an explicitly selected Craft collection over the API. It does not use local Desktop caches, install or execute skills, or claim that every agent harness can load the result. The authoritative portable contract, including schema and JSON examples, ships with the bundled skill at [`skill/references/skill-library.md`](../skill/references/skill-library.md). Register the complete bundled `skill/` folder, including `references/`, in the user's declared canonical skill location first; otherwise use the target harness's supported user-level location.

The implementation pilot and its verified limits are recorded in [Unslop pilot evidence](skill-library-unslop-pilot-2026-09-19.md).

## Operating sequence

Use an explicit profile and collection ID. For a public Connect URL, use `--url URL`; it never sends saved or environment credentials. For profile-based commands, `CRAFT_URL` plus `CRAFT_KEY` wins even when `--profile` is supplied; otherwise `--profile`, then `CRAFT_PROFILE`, then the saved default profile are resolved. `--url` and `--profile` cannot be combined.

```sh
craft lib list --collection COLLECTION_ID --profile PROFILE --json
craft lib get skill-name --collection COLLECTION_ID --profile PROFILE
craft lib export skill-name --collection COLLECTION_ID --profile PROFILE --out ./generated-skills
```

Select from list metadata (`name`, `description`, `status`, and tags) before fetching a body. `list` reads depth zero and returns `{items, rejected}` without previews. `get` resolves the exact name or item ID through that catalog and returns generated `SKILL.md`; arbitrary or unlisted IDs are rejected before a body fetch. Normal selection requires `kind=skill`, `status=published`, a valid name, and a nonempty description. `--include-drafts` includes `draft` and `archived` rows for review; `--legacy` is an explicit migration mode for old `skill` tags and missing names, but descriptions remain required. Missing status is rejected in normal mode and accepted only by legacy mode. Duplicate names are rejected.

Author the body without frontmatter. The exporter adds `name` and `description` frontmatter. Exports are single-file `DIR/<name>/SKILL.md` outputs, refuse existing directories and symlinks, support `--dry-run`, and report the exact generated-file SHA-256. Only text, code, and separator blocks are supported; nested pages, media, files, tables, collections, and other unsupported blocks fail explicitly. Inline Craft markup and links are preserved for review. No supporting files, plugin archive, publication endpoint, execution, synchronization, or automatic installation is provided. A successful export is not a compatibility test; run the target harness's own registration and activation check.

Keep private drafts behind a separate connection or document boundary. A publication filter controls adapter output only; it does not hide rows from anyone holding the raw Connect URL/key.
