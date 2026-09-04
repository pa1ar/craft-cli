import { describe, expect, test } from "bun:test";
import { buildMediaAnalyzeSkillArgs, replaceMediaBlock } from "../../src/cli/commands/media.ts";
import { inferContentType } from "../../src/cli/commands/upload.ts";

describe("media command", () => {
  test("routes analyze alias to media-analyze skill", () => {
    expect(buildMediaAnalyzeSkillArgs("block-1", ["--estimate"])).toEqual([
      "media-analyze",
      "analyze",
      "block-1",
      "--estimate",
    ]);
  });

  test("infers common media content types", () => {
    expect(inferContentType("clip.mov")).toBe("video/quicktime");
    expect(inferContentType("clip.mp4")).toBe("video/mp4");
    expect(inferContentType("photo.heic")).toBe("image/heic");
    expect(inferContentType("audio.m4a")).toBe("audio/mp4");
  });

  test("uploads before, verifies, then deletes the old media block", async () => {
    const calls: string[] = [];
    const client = {
      blocks: {
        get: async (id: string) => {
          calls.push(`get:${id}`);
          return id === "old"
            ? { id, type: "video", url: "https://r.craft.do/old" }
            : { id, type: "video", url: "https://r.craft.do/new" };
        },
        delete: async (ids: string[]) => {
          calls.push(`delete:${ids.join(",")}`);
          return { items: ids.map((id) => ({ id })) };
        },
      },
      upload: {
        file: async (_bytes: Uint8Array, target: { siblingId: string }, contentType: string) => {
          calls.push(`upload:${target.siblingId}:${contentType}`);
          return { blockId: "new", assetUrl: "https://r.craft.do/new" };
        },
      },
    } as any;

    const result = await replaceMediaBlock(client, {
      oldBlockId: "old",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "video/mp4",
    });

    expect(calls).toEqual([
      "get:old",
      "upload:old:video/mp4",
      "get:new",
      "delete:old",
    ]);
    expect(result).toMatchObject({ oldBlockId: "old", newBlockId: "new", oldDeleted: true });
  });

  test("rolls back the new block when verification fails", async () => {
    const deleted: string[] = [];
    const client = {
      blocks: {
        get: async (id: string) => id === "old"
          ? { id, type: "video", url: "https://r.craft.do/old" }
          : { id, type: "file", url: "https://r.craft.do/new" },
        delete: async (ids: string[]) => {
          deleted.push(...ids);
          return { items: [] };
        },
      },
      upload: { file: async () => ({ blockId: "new", assetUrl: "https://r.craft.do/new" }) },
    } as any;

    await expect(replaceMediaBlock(client, {
      oldBlockId: "old",
      bytes: new Uint8Array([1]),
      contentType: "video/mp4",
    })).rejects.toThrow("verification mismatch");
    expect(deleted).toEqual(["new"]);
  });

  test("refuses media blocks with children before uploading", async () => {
    let uploaded = false;
    const client = {
      blocks: {
        get: async () => ({ id: "old", type: "image", url: "https://r.craft.do/old", content: [{ id: "child", type: "text" }] }),
        delete: async () => ({ items: [] }),
      },
      upload: { file: async () => { uploaded = true; return { blockId: "new", assetUrl: "" }; } },
    } as any;

    await expect(replaceMediaBlock(client, {
      oldBlockId: "old",
      bytes: new Uint8Array([1]),
      contentType: "image/png",
    })).rejects.toThrow("child blocks");
    expect(uploaded).toBe(false);
  });
});
