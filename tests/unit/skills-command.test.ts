import { describe, expect, test } from "bun:test";
import { estimateSkillRun } from "../../src/cli/skills/runner.ts";

describe("skills command helpers", () => {
  test("estimate respects max cost", () => {
    const output = estimateSkillRun({
      name: "analyze",
      description: "Analyze",
      entry: "scripts/analyze.ts",
      estimatedCostEur: 1.5,
    }, 1);
    expect(output.status).toBe("failed");
    expect(output.error).toContain("exceeds cap");
  });
});
