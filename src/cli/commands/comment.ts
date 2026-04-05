import { parseWithGlobals, buildClient } from "../client-factory.ts";

export async function runComment(argv: string[]) {
  const args = parseWithGlobals(argv);
  const [blockId, ...textParts] = args.positional;
  if (!blockId || textParts.length === 0) {
    throw new Error("usage: craft comment <blockId> <text>");
  }
  const { client } = await buildClient(args);
  const res = await client.comments.add([{ blockId, content: textParts.join(" ") }]);
  console.log(args.flags.json ? JSON.stringify(res, null, 2) : res.items[0]?.commentId);
}
