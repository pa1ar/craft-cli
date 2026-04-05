import { parseWithGlobals, buildClient } from "../client-factory.ts";
import type { UploadTarget } from "../../lib/upload.ts";

export async function runUpload(argv: string[]) {
  const args = parseWithGlobals(argv, {
    flags: {
      parent: { type: "string" },
      date: { type: "string" },
      sibling: { type: "string" },
      position: { type: "string" },
      "content-type": { type: "string" },
    },
  });
  const file = args.positional[0];
  if (!file) throw new Error("usage: craft upload <file> (--parent ID | --date DATE | --sibling ID) [--position start|end|before|after]");

  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());

  let target: UploadTarget;
  const pos = (args.flags.position as any) ?? "end";
  if (args.flags.parent) {
    target = { position: pos, pageId: args.flags.parent as string };
  } else if (args.flags.date) {
    target = { position: pos, date: args.flags.date as string };
  } else if (args.flags.sibling) {
    target = { position: pos, siblingId: args.flags.sibling as string };
  } else {
    throw new Error("one of --parent, --date, --sibling required");
  }

  const ct = (args.flags["content-type"] as string) ?? inferContentType(file);
  const { client } = await buildClient(args);
  const res = await client.upload.file(bytes, target, ct);
  console.log(args.flags.json ? JSON.stringify(res, null, 2) : `${res.blockId}  ${res.assetUrl}`);
}

function inferContentType(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
