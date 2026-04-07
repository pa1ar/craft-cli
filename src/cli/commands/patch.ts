// craft patch <docId> --old "text" --new "text" - find and replace in blocks
import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { getJournal } from "../journal-singleton.ts";
import { readStdin } from "../args.ts";
import { dim, bold, err } from "../format.ts";
import { walkBlocks } from "../../lib/client.ts";

export async function runPatch(argv: string[]) {
  const args = parseWithGlobals(argv, {
    flags: {
      old: { type: "string" },
      new: { type: "string" },
      "dry-run": { type: "boolean" },
      file: { type: "string" },
    },
  });

  const docId = args.positional[0];
  if (!docId) throw new Error("usage: craft patch <docId> --old \"text\" --new \"text\"");

  let oldText = args.flags.old as string | undefined;
  let newText = args.flags.new as string | undefined;

  // support reading from file/stdin with delimiter
  if (args.flags.file || (!oldText && !newText)) {
    const content = args.flags.file
      ? await Bun.file(args.flags.file as string).text()
      : await readStdin();
    const parts = content.split("\n---\n");
    if (parts.length !== 2) throw new Error("stdin/file format: old text\\n---\\nnew text");
    oldText = parts[0]!.trim();
    newText = parts[1]!.trim();
  }

  if (!oldText || newText === undefined) {
    throw new Error("--old and --new required (or pipe old\\n---\\nnew via stdin)");
  }

  const { client } = await buildClient(args);

  // fetch full block tree
  const tree = await client.blocks.get(docId, { format: "json", maxDepth: -1 });

  // find blocks containing the old text
  type BlockHit = { id: string; markdown: string };
  const matches: BlockHit[] = [];
  walkBlocks(tree, (b: any) => {
    if (b.id && typeof b.markdown === "string" && b.markdown.includes(oldText!)) {
      matches.push({ id: b.id, markdown: b.markdown });
    }
  });

  if (matches.length === 0) {
    console.error(err("text not found in any block"));
    process.exit(4);
  }

  if (matches.length > 1) {
    console.error(err(`ambiguous: ${matches.length} blocks contain this text`));
    for (const m of matches) {
      console.error(`  ${dim(m.id)}  ${dim(m.markdown.slice(0, 80))}`);
    }
    console.error("\nprovide more context in --old to match exactly one block");
    process.exit(1);
  }

  const match = matches[0]!;
  const updatedMarkdown = match.markdown.replace(oldText, newText);

  if (args.flags["dry-run"]) {
    console.log(`${bold("would update")} ${dim(match.id)}`);
    console.log(`  ${dim("-")} ${match.markdown}`);
    console.log(`  ${bold("+")} ${updatedMarkdown}`);
    return;
  }

  // perform the update
  await client.blocks.update([{ id: match.id, markdown: updatedMarkdown }]);

  // journal
  try {
    const journal = getJournal();
    journal.record({
      op: "patch",
      docId,
      blockIds: [match.id],
      pre: [{ id: match.id, markdown: match.markdown }],
      post: [{ id: match.id, markdown: updatedMarkdown }],
    });
  } catch (e) {
    console.error(dim(`journal warning: ${(e as Error).message}`));
  }

  if (args.flags.json) {
    console.log(JSON.stringify({ blockId: match.id, old: match.markdown, new: updatedMarkdown }, null, 2));
  } else {
    console.log(`patched ${dim(match.id)}`);
  }
}
