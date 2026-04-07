// craft diff <docId|blockId> - compare current state to last journal entry
import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { getJournal } from "../journal-singleton.ts";
import { dim, bold } from "../format.ts";
import { walkBlocks } from "../../lib/client.ts";

export async function runDiff(argv: string[]) {
  const args = parseWithGlobals(argv, { flags: {} });
  const targetId = args.positional[0];
  if (!targetId) throw new Error("usage: craft diff <docId|blockId>");

  const journal = getJournal();

  // search for mutations by this id - could be doc id, block id, or daily:date
  const mutations = journal.listMutations({ docId: targetId, last: 1 });
  const last = mutations[0] ?? null;

  if (!last) {
    console.error("no previous state recorded for this id");
    process.exit(1);
  }

  const { client } = await buildClient(args);

  // fetch current state of affected blocks
  const currentBlocks = new Map<string, string>();
  for (const blockId of last.blockIds) {
    try {
      const block = await client.blocks.get(blockId, { format: "json", maxDepth: 0 });
      if (block && (block as any).markdown !== undefined) {
        currentBlocks.set(blockId, (block as any).markdown);
      }
    } catch {
      // block may have been deleted
      currentBlocks.set(blockId, "(deleted)");
    }
  }

  // reconstruct last known state from journal pre/post
  const lastBlocks = new Map<string, string>();
  // for updates: pre has original, post has what we wrote
  // for appends/inserts: post has what was added
  // for deletes: pre has what was removed
  const source = last.op === "delete" ? last.pre : last.post;
  if (source && typeof source === "object") {
    if (Array.isArray(source)) {
      for (const b of source) {
        if (b?.id && b?.markdown !== undefined) lastBlocks.set(b.id, b.markdown);
      }
    } else if ((source as any).markdown !== undefined) {
      lastBlocks.set(last.blockIds[0], (source as any).markdown);
    }
  }

  if (args.flags.json) {
    const changes: { type: string; blockId: string; old?: string; current?: string }[] = [];
    for (const blockId of last.blockIds) {
      const cur = currentBlocks.get(blockId);
      const prev = lastBlocks.get(blockId);
      if (cur !== prev) {
        changes.push({ type: "changed", blockId, old: prev, current: cur });
      }
    }
    console.log(JSON.stringify({ targetId, lastMutation: last.ts, op: last.op, changes }, null, 2));
    return;
  }

  console.log(`${dim(`last mutation: ${last.ts} (${last.op})`)}`);
  console.log();

  let changeCount = 0;
  for (const blockId of last.blockIds) {
    const cur = currentBlocks.get(blockId);
    const prev = lastBlocks.get(blockId);
    if (cur !== prev) {
      console.log(`${bold("~")} ${dim(blockId)}`);
      if (prev !== undefined) console.log(`  ${dim("-")} ${prev}`);
      if (cur !== undefined) console.log(`  ${bold("+")} ${cur}`);
      console.log();
      changeCount++;
    }
  }

  if (changeCount === 0) {
    console.log("no changes detected since last mutation");
  } else {
    console.error(dim(`\n${changeCount} blocks changed`));
  }
}
