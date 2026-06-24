import { describe, expect, test } from "bun:test";
import { buildMediaAnalyzeSkillArgs } from "../../src/cli/commands/media.ts";

describe("media command", () => {
  test("routes analyze alias to media-analyze skill", () => {
    expect(buildMediaAnalyzeSkillArgs("block-1", ["--estimate"])).toEqual([
      "media-analyze",
      "analyze",
      "block-1",
      "--estimate",
    ]);
  });
});
