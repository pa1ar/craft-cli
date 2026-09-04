import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAssetIndexes, findLocalMediaAssets, preferredLocalMediaAsset } from "../../src/lib/local-media.ts";

describe("local Craft media", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  test("prefers an existing full asset over its preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "craft-media-"));
    roots.push(root);
    const space = join(root, "space-1");
    await mkdir(space);
    await writeFile(join(space, "full-id"), "full");
    await writeFile(join(space, "preview-id"), "preview");
    await writeFile(join(space, "index.json"), JSON.stringify({
      onDeviceAssetsByUrl: {
        "https://resv2.craft.do/user/preview/space/doc/block/Image.jpg": {
          assetId: "preview-id",
          blockIds: ["BLOCK-1"],
          size: 7,
        },
        "https://resv2.craft.do/user/full/space/doc/block/My%20Image.png": {
          assetId: "full-id",
          blockIds: ["block-1"],
          size: 4,
        },
      },
    }));

    const assets = findLocalMediaAssets("block-1", { roots: [root] });
    expect(assets.map((asset) => asset.variant)).toEqual(["full", "preview"]);
    expect(assets[0]!.fileName).toBe("My Image.png");
    expect(preferredLocalMediaAsset("block-1", { roots: [root] })?.path).toBe(join(space, "full-id"));
  });

  test("ignores stale index entries whose files were evicted", async () => {
    const root = await mkdtemp(join(tmpdir(), "craft-media-"));
    roots.push(root);
    const space = join(root, "space-1");
    await mkdir(space);
    await writeFile(join(space, "index.json"), JSON.stringify({
      onDeviceAssetsByUrl: {
        "https://resv2.craft.do/user/full/space/doc/block/video.mp4": {
          assetId: "missing-id",
          blockIds: ["block-2"],
          size: 42,
        },
      },
    }));

    expect(findLocalMediaAssets("block-2", { roots: [root] })).toEqual([]);
  });

  test("accepts an index file or space directory as an override root", async () => {
    const root = await mkdtemp(join(tmpdir(), "craft-media-"));
    roots.push(root);
    const index = join(root, "index.json");
    await writeFile(index, JSON.stringify({ onDeviceAssetsByUrl: {} }));
    expect(discoverAssetIndexes([root])).toEqual([index]);
    expect(discoverAssetIndexes([index])).toEqual([index]);
  });
});
