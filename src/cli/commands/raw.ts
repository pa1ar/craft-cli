// escape hatch — call any path with any method
import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { readStdin } from "../args.ts";

export async function runRaw(argv: string[]) {
  const args = parseWithGlobals(argv, {
    flags: {
      query: { type: "string", multi: true },
      body: { type: "string" },
      header: { type: "string", multi: true },
    },
  });
  const [method, path] = args.positional;
  if (!method || !path) throw new Error("usage: craft raw <METHOD> <path> [--query k=v] [--body FILE|-] [--header k:v]");

  const query: Record<string, string> = {};
  for (const kv of (args.flags.query as string[] | undefined) ?? []) {
    const [k, ...rest] = kv.split("=");
    if (k) query[k] = rest.join("=");
  }

  let body: unknown;
  if (args.flags.body === "-") {
    body = JSON.parse(await readStdin());
  } else if (typeof args.flags.body === "string") {
    body = JSON.parse(await Bun.file(args.flags.body).text());
  }

  const { client } = await buildClient(args);
  const res = await client.request(method.toUpperCase(), path, { query, body });
  console.log(typeof res === "string" ? res : JSON.stringify(res, null, 2));
}
