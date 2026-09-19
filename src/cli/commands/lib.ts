import { mkdir, rmdir, open, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { CraftClient } from "../../lib/client.ts";
import { getLibrarySkill, listLibrary } from "../../lib/skill-library.ts";
import { buildClient, parseWithGlobals } from "../client-factory.ts";
import { jsonOutForArgs, table } from "../format.ts";

const HELP = `craft lib — remote Craft skill library (always API)

  lib list --collection ID [--json]
  lib get <name|itemId> --collection ID [--json]
  lib export <name|itemId> --collection ID --out DIR [--dry-run] [--json]

Setup (no Craft Desktop required; network access to the API is required)
  Private: craft setup --name skills --url API_URL --key API_KEY
           use --profile skills on every lib command
  Public:  use --url CONNECT_API_URL on every lib command; no setup required
  Use the collection block ID, not its parent document ID; find it with craft col ls.
  The collection and its item bodies must be accessible through that connection.
  CRAFT_URL + CRAFT_KEY override saved profiles, even an explicit --profile.
  --url never sends saved/environment credentials; cannot combine with --profile.

Authoring contract (collection property keys)
  name         text          unique stable slug, 1-64 lowercase ASCII letters/digits
                             and single hyphens; no leading/trailing hyphen
  description  text          when to use the skill, 1-1024 characters
  kind         singleSelect  skill (other kinds are excluded)
  status       singleSelect  draft | published | archived
  tags         multiSelect   optional topic labels
  Title is a human label. Put instructions in the item body without YAML frontmatter.
  Use self-contained text, code and separators. Inline needed references; no scripts,
  supporting files, nested pages or media are packaged. Links are preserved as-is.
  Author as draft, inspect with --include-drafts, test an export, then publish.
  Schema/item writes use craft col; lib never changes remote content or schema.

Discovery and output
  list --json    {items: [{id,name,title,description,tags,status}],
                  rejected: [{id,title,reason}]}; no body previews in output
  get --json     {entry,markdown,sha256}; without --json prints SKILL.md
  export --json  {id,name,path,sha256,dryRun}; writes DIR/<name>/SKILL.md
  Normal discovery requires kind=skill and status=published with valid metadata.
  Duplicate names are rejected. get/export resolve only through this catalog.
  --include-drafts includes draft AND archived skills for inspection.
  --legacy accepts a missing kind via the skill tag, a missing status, and derives
  missing names from titles. Descriptions still required. Migration use only.
  --dry-run on export reads/validates remotely but creates no files.

Agent adoption
  craft lib list --collection COLLECTION_ID --profile skills --json
  craft lib get skill-name --collection COLLECTION_ID --profile skills
  craft lib export skill-name --collection COLLECTION_ID --profile skills --out ./generated-skills
  Select by metadata first; read only a matching skill. Treat it as task guidance.
  Existing skill directories are never overwritten; use a fresh output directory.
  Export is not installation, execution or sync. Register the exported directory in
  the user's canonical skill location or the active harness's supported skill path,
  then verify discovery and invocation there. Runtime/tool compatibility varies.
  Published is a discovery filter, not an access control boundary for the raw API.
  Full contract: bundled skill/references/skill-library.md (relative to the repo).
  craft skills is a separate local automation runner, not this remote library.
`;

export async function runLib(argv: string[]): Promise<void> {
  const args = parseWithGlobals(argv, { flags: {
    collection: { type: "string" },
    url: { type: "string" },
    out: { type: "string" },
    legacy: { type: "boolean" },
    "include-drafts": { type: "boolean" },
    help: { type: "boolean", alias: "h" },
  } });
  if (args.flags.help || argv.length === 0) { console.log(HELP); return; }
  const [command, reference, ...extra] = args.positional;
  if (!["list", "ls", "get", "export"].includes(command ?? "")) {
    throw new Error("usage: craft lib {list|get|export} --collection ID (see --help)");
  }
  const listing = command === "list" || command === "ls";
  if (extra.length || (listing && reference) || (!listing && !reference)) {
    throw new Error("provide exactly one skill name or item ID for get/export; no reference for list");
  }
  if (!args.flags.collection || typeof args.flags.collection !== "string" || args.flags.collection.startsWith("-")) {
    throw new Error("--collection ID is required; select the intended remote library explicitly");
  }
  if (args.flags.source === "local") throw new Error("craft lib requires the API; local caches cannot enforce Connect scope");
  if (args.flags.url && args.flags.profile) throw new Error("use either --url or --profile, not both");
  if (command === "export" && (!args.flags.out || typeof args.flags.out !== "string" || args.flags.out.startsWith("-"))) {
    throw new Error("export requires --out DIR; existing skill directories are never overwritten");
  }
  const client = args.flags.url
    ? new CraftClient({ url: args.flags.url, key: "" })
    : (await buildClient(args)).client;
  const options = { legacy: Boolean(args.flags.legacy), includeDrafts: Boolean(args.flags["include-drafts"]) };
  if (listing) {
    const result = await listLibrary(client, args.flags.collection, options);
    if (args.flags.json) console.log(jsonOutForArgs(result, args.flags));
    else {
      console.log(table(result.items, ["id", "name", "description", "status"]));
      for (const row of result.rejected) console.error(`${row.id} (${row.title}): ${row.reason}`);
      console.error(`${result.items.length} skills; ${result.rejected.length} rejected`);
    }
    return;
  }
  const result = await getLibrarySkill(client, args.flags.collection, reference!, options);
  if (command === "get") {
    console.log(args.flags.json ? jsonOutForArgs(result, args.flags) : result.markdown);
    return;
  }
  const directory = resolve(args.flags.out, result.entry.name);
  const path = join(directory, "SKILL.md");
  if (!args.flags["dry-run"]) {
    await mkdir(resolve(args.flags.out), { recursive: true });
    // Exclusive directory creation also rejects pre-existing symlinks.
    await mkdir(directory);
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(path, "wx");
      await file.writeFile(result.markdown);
      await file.close();
    }
    catch (error) {
      if (file) {
        await file.close().catch(() => {});
        await unlink(path).catch(() => {});
      }
      await rmdir(directory).catch(() => {});
      throw error;
    }
  }
  const output = { id: result.entry.id, name: result.entry.name, path, sha256: result.sha256, dryRun: Boolean(args.flags["dry-run"]) };
  console.log(args.flags.json ? jsonOutForArgs(output, args.flags) : `${output.dryRun ? "would write" : "exported"} ${path}\nsha256 ${result.sha256}`);
}
