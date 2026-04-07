// craft cat <id> [id...] - read multiple docs, concat output
import { parseWithGlobals, buildClient } from "../client-factory.ts";
import {
  getAndRender,
  renderBacklinksMarkdown,
} from "../render.ts";
import { parallel } from "../../lib/client.ts";

export async function runCat(argv: string[]) {
  const args = parseWithGlobals(argv, {
    flags: {
      depth: { type: "number" },
      "no-links": { type: "boolean" },
      raw: { type: "boolean" },
    },
  });

  const ids = args.positional;
  if (ids.length === 0) throw new Error("usage: craft cat <id> [id...]");

  const { client } = await buildClient(args);

  const results = await parallel(ids, async (id) => {
    const { payload, backlinks } = await getAndRender(client, {
      id,
      depth: args.flags.depth ?? -1,
      format: args.flags.json ? "json" : "markdown",
      raw: args.flags.raw,
      withLinks: !args.flags["no-links"],
    });
    return { id, payload, backlinks };
  });

  if (args.flags.json) {
    console.log(JSON.stringify(results.map((r) => r.payload), null, 2));
    return;
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (i > 0) console.log(`\n---\n`);
    process.stdout.write(r.payload as string);
    if (r.backlinks !== null) {
      process.stdout.write(renderBacklinksMarkdown(r.backlinks));
    }
  }
}
