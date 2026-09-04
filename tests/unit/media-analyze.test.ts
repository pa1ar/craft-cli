import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAnalysisMarkdown, extractMediaCandidates, resolveMediaFile, stripWrappingMarkdownFence } from "../../skills/media-analyze/scripts/analyze.ts";

describe("media-analyze helpers", () => {
  test("finds nested Craft media block URLs", () => {
    const candidates = extractMediaCandidates({
      id: "root",
      content: [{ id: "child", type: "image", url: "https://r.craft.do/img.jpg" }],
    });
    expect(candidates).toEqual([
      { url: "https://r.craft.do/img.jpg", kind: "image", source: "block-json" },
    ]);
  });

  test("ignores non-media richUrl before Craft video", () => {
    const candidates = extractMediaCandidates({
      id: "root",
      content: [
        { id: "link", type: "richUrl", url: "https://vm.tiktok.com/example/" },
        { id: "video", type: "video", url: "https://r.craft.do/video" },
      ],
    });
    expect(candidates).toEqual([
      { url: "https://r.craft.do/video", kind: "video", source: "block-json" },
    ]);
  });

  test("builds markdown with transcript and metadata JSON", () => {
    const markdown = buildAnalysisMarkdown("Analysis", "Transcript", "/tmp/contact.jpg", {
      url: "https://example.com/video.mp4",
      kind: "video",
      source: "download",
      warnings: [],
    });
    expect(markdown).toContain("## Media analysis");
    expect(markdown).toContain("Analysis");
    expect(markdown).not.toContain("### Transcript");
    expect(markdown).not.toContain("### Metadata");
  });

  test("strips wrapping markdown fences", () => {
    expect(stripWrappingMarkdownFence("```markdown\n## Summary\ntext\n```")).toBe("## Summary\ntext");
  });

  test("uses an existing extensionless local media file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "media-analyze-"));
    const local = join(dir, "asset-id");
    await writeFile(local, new Uint8Array([
      0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20,
    ]));
    try {
      const result = await resolveMediaFile("https://r.craft.do/video", dir, local);
      expect(result).toMatchObject({
        path: local,
        source: "local",
        contentType: "video/quicktime",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
