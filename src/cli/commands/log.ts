// craft log [docId] - show mutation history
import { parseWithGlobals } from "../client-factory.ts";
import { getJournal } from "../journal-singleton.ts";
import { table, dim } from "../format.ts";

export async function runLog(argv: string[]) {
  const args = parseWithGlobals(argv, {
    flags: {
      last: { type: "number" },
      since: { type: "string" },
    },
  });

  const docId = args.positional[0];
  const journal = getJournal();

  const mutations = journal.listMutations({
    docId,
    last: args.flags.last as number | undefined,
    since: args.flags.since as string | undefined,
  });

  if (args.flags.json) {
    console.log(JSON.stringify(mutations, null, 2));
    return;
  }

  if (mutations.length === 0) {
    console.log("no mutations recorded");
    return;
  }

  console.log(
    table(
      mutations.map((m) => ({
        ts: m.ts.slice(0, 19).replace("T", " "),
        op: m.op,
        doc: m.docId.length > 36 ? m.docId.slice(0, 33) + "..." : m.docId,
        blocks: m.blockIds.length,
      }))
    )
  );
}
