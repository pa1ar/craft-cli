import type { CraftClient } from "../../lib/client.ts";
import type { Block } from "../../lib/types.ts";
import { findLocalMediaAssets, preferredLocalMediaAsset } from "../../lib/local-media.ts";
import { getJournal } from "../journal-singleton.ts";
import { runSkillByName } from "./skills.ts";
import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { jsonOutForArgs, table } from "../format.ts";
import { inferContentType } from "./upload.ts";

const MEDIA_TYPES = new Set(["image", "video", "file"]);

const HELP = `craft media

Usage:
  craft media local <blockId> [--all] [--json]
  craft media analyze <blockId> [--estimate] [--max-cost EUR] [--json]
  craft media replace <blockId> <file> [--content-type TYPE] [--dry-run] [--json]
`;

export function buildMediaAnalyzeSkillArgs(blockId: string, rest: string[]): string[] {
  return ["media-analyze", "analyze", blockId, ...rest];
}

export interface ReplaceMediaResult {
  oldBlockId: string;
  newBlockId: string;
  assetUrl: string;
  type: string;
  contentType: string;
  bytes: number;
  oldDeleted: boolean;
}

type MediaClient = Pick<CraftClient, "blocks" | "upload">;

export async function replaceMediaBlock(
  client: MediaClient,
  input: {
    oldBlockId: string;
    bytes: Uint8Array;
    contentType: string;
  },
): Promise<ReplaceMediaResult> {
  const oldBlock = asBlock(await client.blocks.get(input.oldBlockId, {
    format: "json",
    maxDepth: 1,
    fetchMetadata: true,
  }));
  if (!MEDIA_TYPES.has(oldBlock.type)) {
    throw new Error(`block ${input.oldBlockId} is ${oldBlock.type}, not image/video/file`);
  }
  if (oldBlock.content?.length) {
    throw new Error("refusing to replace media with child blocks; move or preserve them first");
  }
  if (oldBlock.metadata?.comments && oldBlock.metadata.comments.length > 0) {
    throw new Error("refusing to replace media with comments; the new block would get a new ID");
  }

  const uploaded = await client.upload.file(
    input.bytes,
    { position: "before", siblingId: input.oldBlockId },
    input.contentType,
  );

  let newBlock: Block;
  try {
    newBlock = asBlock(await client.blocks.get(uploaded.blockId, {
      format: "json",
      maxDepth: 0,
    }));
    if (!MEDIA_TYPES.has(newBlock.type) || newBlock.type !== oldBlock.type || !newBlock.url) {
      throw new Error(`uploaded block verification mismatch: expected ${oldBlock.type}, got ${newBlock.type}`);
    }
  } catch (error) {
    try {
      await client.blocks.delete([uploaded.blockId]);
    } catch (cleanupError) {
      throw new Error(
        `${(error as Error).message}; rollback also failed, new block remains: ${uploaded.blockId} (${(cleanupError as Error).message})`,
      );
    }
    throw error;
  }

  try {
    await client.blocks.delete([input.oldBlockId]);
  } catch (error) {
    throw new Error(
      `new block ${uploaded.blockId} verified, but old block ${input.oldBlockId} could not be deleted: ${(error as Error).message}`,
    );
  }

  return {
    oldBlockId: input.oldBlockId,
    newBlockId: uploaded.blockId,
    assetUrl: uploaded.assetUrl,
    type: newBlock.type,
    contentType: input.contentType,
    bytes: input.bytes.byteLength,
    oldDeleted: true,
  };
}

export async function runMedia(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(HELP.trimEnd());
    return;
  }

  const rest = argv.slice(1);
  if (sub === "local") {
    const args = parseWithGlobals(rest, { flags: { all: { type: "boolean" } } });
    const blockId = args.positional[0];
    if (!blockId) throw new Error("usage: craft media local <blockId> [--all]");
    const assets = findLocalMediaAssets(blockId);
    if (assets.length === 0) throw new Error(`no on-device media found for block ${blockId}`);
    const selected = args.flags.all ? assets : assets.slice(0, 1);
    const payload = { blockId, preferred: assets[0], items: selected };
    if (args.flags.json) {
      console.log(jsonOutForArgs(payload, args.flags));
    } else if (args.flags.all) {
      console.log(table(selected.map((asset) => ({
        variant: asset.variant,
        bytes: asset.size ?? "",
        fileName: asset.fileName ?? "",
        path: asset.path,
      })), ["variant", "bytes", "fileName", "path"]));
    } else {
      console.log(selected[0]!.path);
    }
    return;
  }

  if (sub === "analyze") {
    const args = parseWithGlobals(rest, {
      flags: {
        estimate: { type: "boolean" },
        "max-cost": { type: "number" },
      },
    });
    const blockId = args.positional[0];
    if (!blockId) throw new Error("usage: craft media analyze <blockId>");
    const local = preferredLocalMediaAsset(blockId);
    if (local) args.flags["local-file"] = local.path;
    const skillArgs = buildMediaAnalyzeSkillArgs(blockId, args.positional.slice(1));
    const output = await runSkillByName(skillArgs[0]!, skillArgs[1]!, skillArgs.slice(2), args.flags);
    if (args.flags.json) {
      console.log(jsonOutForArgs(output, args.flags));
    } else {
      if (output.error) console.error(output.error);
      if (output.markdown) console.log(output.markdown);
      if (!output.error && !output.markdown) console.log(output.status);
    }
    if (output.status === "failed") process.exitCode = 1;
    return;
  }

  if (sub === "replace") {
    const args = parseWithGlobals(rest, {
      flags: { "content-type": { type: "string" } },
    });
    const [oldBlockId, filePath] = args.positional;
    if (!oldBlockId || !filePath) {
      throw new Error("usage: craft media replace <blockId> <file> [--content-type TYPE]");
    }
    const file = Bun.file(filePath);
    if (!await file.exists()) throw new Error(`file not found: ${filePath}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = (args.flags["content-type"] as string | undefined) ?? inferContentType(filePath);
    if (args.flags["dry-run"]) {
      const preview = {
        op: "media.replace",
        oldBlockId,
        file: filePath,
        bytes: bytes.byteLength,
        contentType,
        sequence: ["upload before old block", "verify new media block", "delete old block"],
      };
      console.log(args.flags.json ? jsonOutForArgs(preview, args.flags) : `dry-run: would replace ${oldBlockId} with ${filePath} (${bytes.byteLength} bytes)`);
      return;
    }
    const { client } = await buildClient(args);
    const result = await replaceMediaBlock(client, { oldBlockId, bytes, contentType });
    try {
      getJournal().record({
        op: "media-replace",
        docId: oldBlockId,
        blockIds: [oldBlockId, result.newBlockId],
        post: result,
      });
    } catch (error) {
      console.error(`journal warning: ${(error as Error).message}`);
    }
    console.log(args.flags.json ? jsonOutForArgs(result, args.flags) : `${result.newBlockId}  ${result.assetUrl}`);
    return;
  }

  throw new Error(`unknown media command: ${sub}`);
}

function asBlock(value: Block | string): Block {
  if (!value || typeof value === "string" || typeof value.type !== "string" || typeof value.id !== "string") {
    throw new Error("Craft returned an invalid block payload");
  }
  return value;
}
