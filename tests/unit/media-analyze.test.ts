import { describe, expect, test } from "bun:test";
import { buildAnalysisMarkdown, extractMediaCandidates, stripWrappingMarkdownFence } from "../../skills/media-analyze/scripts/analyze.ts";

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
});
