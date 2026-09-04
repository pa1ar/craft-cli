import { parseWithGlobals, buildClient } from "../client-factory.ts";
import type { UploadTarget } from "../../lib/upload.ts";
import { jsonOutForArgs } from "../format.ts";

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
  if (args.flags["dry-run"]) {
    const preview = { op: "upload.file", file, contentType: ct, target, bytes: bytes.byteLength };
    console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would upload ${file} (${bytes.byteLength} bytes)`);
    return;
  }
  const { client } = await buildClient(args);
  const res = await client.upload.file(bytes, target, ct);
  console.log(args.flags.json ? jsonOutForArgs(res, args.flags) : `${res.blockId}  ${res.assetUrl}`);
}

export function inferContentType(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
