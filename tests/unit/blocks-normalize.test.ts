import { describe, expect, test } from "bun:test";
import { normalizeCraftMediaBlocks } from "../../src/lib/blocks.ts";

describe("normalizeCraftMediaBlocks", () => {
  test("adds uploaded + mimeType for r.craft.do image blocks", () => {
    const out = normalizeCraftMediaBlocks([
      { type: "image", url: "https://r.craft.do/hUsZYh2iPX-FdQ25ncaK8" },
    ]);
    expect(out[0]).toEqual({
      type: "image",
      url: "https://r.craft.do/hUsZYh2iPX-FdQ25ncaK8",
      uploaded: true,
      mimeType: "image/jpeg",
    });
  });

  test("adds uploaded + mimeType for r.craft.do file blocks", () => {
    const out = normalizeCraftMediaBlocks([
      { type: "file", url: "https://r.craft.do/xyz", fileName: "doc.pdf" },
    ]);
    expect(out[0].uploaded).toBe(true);
    expect(out[0].mimeType).toBe("application/octet-stream");
    expect(out[0].fileName).toBe("doc.pdf");
  });

  test("adds uploaded + mimeType for r.craft.do video blocks", () => {
    const out = normalizeCraftMediaBlocks([
      { type: "video", url: "https://r.craft.do/abc" },
    ]);
    expect(out[0].uploaded).toBe(true);
    expect(out[0].mimeType).toBe("video/mp4");
  });

  test("does NOT touch external image URLs", () => {
    const input = { type: "image", url: "https://example.com/foo.png" };
    const out = normalizeCraftMediaBlocks([input]);
    expect(out[0]).toEqual(input);
  });

  test("does NOT override user-provided uploaded/mimeType", () => {
    const out = normalizeCraftMediaBlocks([
      {
        type: "image",
        url: "https://r.craft.do/abc",
        uploaded: false,
        mimeType: "image/png",
      },
    ]);
    expect(out[0].uploaded).toBe(false);
    expect(out[0].mimeType).toBe("image/png");
  });

  test("leaves text / richUrl / line / code untouched", () => {
    const input: any[] = [
      { type: "text", markdown: "hi" },
      { type: "richUrl", url: "https://r.craft.do/abc", title: "t" },
      { type: "line" },
      { type: "code", rawCode: "x", language: "js" },
    ];
    const out = normalizeCraftMediaBlocks(input);
    expect(out).toEqual(input);
  });

  test("recurses into nested content", () => {
    const out = normalizeCraftMediaBlocks([
      {
        type: "text",
        markdown: "parent",
        content: [
          { type: "image", url: "https://r.craft.do/nested" },
        ],
      },
    ]);
    expect(out[0].content?.[0]).toMatchObject({
      type: "image",
      uploaded: true,
      mimeType: "image/jpeg",
    });
  });
});
