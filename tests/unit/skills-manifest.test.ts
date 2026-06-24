import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateBundledSkill, validateSkillManifest } from "../../src/cli/skills/manifest.ts";

describe("skill manifest validation", () => {
  test("accepts valid manifest", () => {
    const result = validateSkillManifest({
      name: "media-analyze",
      description: "Analyze media",
      tags: ["media"],
      commands: [{ name: "analyze", description: "Analyze a block", entry: "scripts/analyze.ts" }],
      permissions: { craft: ["read", "write"], openai: true },
      artifacts: ["analysis"],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("rejects missing fields", () => {
    const result = validateSkillManifest({ name: "bad" });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("description must be a non-empty string");
    expect(result.errors).toContain("commands must be a non-empty array");
  });

  test("validates bundled skill folder requirements", async () => {
    const root = await makeTempSkill();
    const result = await validateBundledSkill(root);
    expect(result.ok).toBe(true);
  });
});

async function makeTempSkill(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "craft-cli-test-skill-"));
  await Bun.$`mkdir -p ${root}/scripts ${root}/examples ${root}/tests`.quiet();
  await Bun.write(`${root}/SKILL.md`, "# test\n");
  await Bun.write(`${root}/manifest.json`, JSON.stringify({
    name: "test",
    description: "Test skill",
    tags: ["test"],
    commands: [{ name: "run", description: "Run", entry: "scripts/run.ts" }],
    permissions: {},
    artifacts: [],
  }));
  return root;
}
