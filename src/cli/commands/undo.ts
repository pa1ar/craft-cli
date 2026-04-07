// craft undo [docId|blockId] - revert last CLI mutation
import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { getJournal } from "../journal-singleton.ts";
import { dim, bold, err } from "../format.ts";

export async function runUndo(argv: string[]) {
  const args = parseWithGlobals(argv, {
    flags: {
      force: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });

  const targetId = args.positional[0];
  const journal = getJournal();

  // find last mutation - filter by docId if provided
  const last = targetId
    ? journal.listMutations({ docId: targetId, last: 1 })[0] ?? null
    : journal.listMutations({ last: 1 })[0] ?? null;

  if (!last) {
    console.error(err("no mutations to undo"));
    process.exit(1);
  }

  // don't undo an undo
  if (last.op === "undo") {
    console.error(err("last mutation is already an undo"));
    process.exit(1);
  }

  console.log(
    `${dim(`undoing: ${last.ts} ${last.op} on ${last.docId} (${last.blockIds.length} blocks)`)}`
  );

  const { client } = await buildClient(args);

  // --- insert/append: undo by deleting added blocks ---
  if (last.op === "append" || last.op === "insert" || last.op === "task-add") {
    if (args.flags["dry-run"]) {
      console.log(
        `${bold("would delete")} ${last.blockIds.length} blocks: ${last.blockIds.join(", ")}`
      );
      return;
    }

    // verify blocks still exist
    for (const blockId of last.blockIds) {
      try {
        await client.blocks.get(blockId, { format: "json", maxDepth: 0 });
      } catch {
        console.error(err(`block ${blockId} no longer exists, cannot undo`));
        if (!args.flags.force) process.exit(1);
      }
    }

    if (last.op === "task-add") {
      await client.tasks.delete(last.blockIds);
    } else {
      await client.blocks.delete(last.blockIds);
    }

    journal.record({
      op: "undo",
      docId: last.docId,
      blockIds: last.blockIds,
      pre: last.post,
    });

    console.log(`undone: deleted ${last.blockIds.length} blocks`);
    return;
  }

  // --- delete: can't reliably restore (new IDs, lost position) ---
  if (last.op === "delete" || last.op === "task-delete") {
    console.error(
      err("cannot undo deletes - blocks would get new IDs and lose their position")
    );
    if (last.pre) {
      console.error(dim("pre-deletion content saved in journal:"));
      console.error(dim(JSON.stringify(last.pre, null, 2).slice(0, 500)));
    }
    process.exit(1);
  }

  // --- update/patch: restore pre state ---
  if (last.op === "update" || last.op === "patch" || last.op === "task-update") {
    if (!last.pre) {
      console.error(err("no pre-mutation state recorded, cannot undo"));
      process.exit(1);
    }

    const preBlocks = Array.isArray(last.pre) ? last.pre : [last.pre];
    const postBlocks = Array.isArray(last.post)
      ? last.post
      : last.post
        ? [last.post]
        : [];

    // verify current state matches post (hasn't been modified since)
    if (!args.flags.force) {
      for (const expected of postBlocks as any[]) {
        if (!expected?.id || expected?.markdown === undefined) continue;
        try {
          const current = (await client.blocks.get(expected.id, {
            format: "json",
            maxDepth: 0,
          })) as any;
          if (current.markdown !== expected.markdown) {
            console.error(err(`block ${expected.id} was modified since your edit`));
            console.error(
              `  ${dim("expected:")} ${expected.markdown?.slice(0, 80)}`
            );
            console.error(
              `  ${dim("current:")}  ${current.markdown?.slice(0, 80)}`
            );
            console.error(dim("\nuse --force to override"));
            process.exit(1);
          }
        } catch {
          console.error(err(`block ${expected.id} no longer accessible`));
          process.exit(1);
        }
      }
    }

    const updates = (preBlocks as any[])
      .filter((b) => b?.id && b?.markdown !== undefined)
      .map((b) => ({ id: b.id, markdown: b.markdown }));

    if (updates.length === 0) {
      console.error(err("no restorable blocks in pre-mutation state"));
      process.exit(1);
    }

    if (args.flags["dry-run"]) {
      for (const u of updates) {
        console.log(`${bold("would restore")} ${dim(u.id)}: ${u.markdown.slice(0, 100)}`);
      }
      return;
    }

    if (last.op === "task-update") {
      await client.tasks.update(
        (preBlocks as any[])
          .filter((b) => b?.id)
          .map((b) => ({ id: b.id, markdown: b.markdown, taskInfo: b.taskInfo }))
      );
    } else {
      await client.blocks.update(updates);
    }

    journal.record({
      op: "undo",
      docId: last.docId,
      blockIds: updates.map((u) => u.id),
      pre: last.post,
      post: last.pre,
    });

    console.log(`undone: restored ${updates.length} blocks`);
    return;
  }

  // --- move: can't undo (original position not tracked) ---
  if (last.op === "move") {
    console.error(err("cannot undo moves - original position not tracked"));
    process.exit(1);
  }

  // --- unknown op ---
  console.error(err(`don't know how to undo op: ${last.op}`));
  process.exit(1);
}
