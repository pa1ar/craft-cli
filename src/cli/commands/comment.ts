import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { jsonOutForArgs } from "../format.ts";

export async function runComment(argv: string[]) {
  const args = parseWithGlobals(argv);
  const [blockId, ...textParts] = args.positional;
  if (!blockId || textParts.length === 0) {
    throw new Error("usage: craft comment <blockId> <text>");
  }
  const content = textParts.join(" ");
  if (args.flags["dry-run"]) {
    const preview = { op: "comments.add", items: [{ blockId, content }] };
    console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would comment on ${blockId}`);
    return;
  }
  const { client } = await buildClient(args);
  const res = await client.comments.add([{ blockId, content }]);
  console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : res.items[0]?.commentId);
}
