import { describe, expect, test } from "bun:test";
import { analyzeMedia, extractMediaCandidates } from "../scripts/analyze.ts";

describe("media-analyze skill", () => {
  test("extracts media URLs from block JSON and markdown", () => {
    const candidates = extractMediaCandidates(
      {
        content: [
          { type: "richUrl", url: "https://vm.tiktok.com/example/" },
          { type: "video", url: "https://r.craft.do/a.mp4" },
        ],
      },
      "fallback https://example.com/audio.mp3"
    );
    expect(candidates.map((candidate) => candidate.url)).toEqual([
      "https://r.craft.do/a.mp4",
      "https://example.com/audio.mp3",
    ]);
    expect(candidates[0]!.kind).toBe("video");
    expect(candidates[1]!.kind).toBe("audio");
  });

  test("returns mocked analysis artifacts", async () => {
    process.env.CRAFT_MEDIA_ANALYZE_MOCK = "1";
    const output = await analyzeMedia({
      skill: { name: "media-analyze", root: ".", source: "bundled" },
      command: { name: "analyze", args: ["block"] },
      flags: {},
      limits: { maxCostEur: 1 },
      craft: {
        sourceBlock: {
          id: "block",
          markdown: "Video https://r.craft.do/a.mp4",
          json: { type: "video", url: "https://r.craft.do/a.mp4" },
        },
      },
    });
    delete process.env.CRAFT_MEDIA_ANALYZE_MOCK;
    expect(output.status).toBe("ok");
    expect(output.markdown).toContain("Mock generic media analysis");
    expect(output.artifacts?.map((artifact) => artifact.name)).toContain("transcript");
    expect(output.artifacts?.map((artifact) => artifact.name)).toContain("metadata");
  });
});
