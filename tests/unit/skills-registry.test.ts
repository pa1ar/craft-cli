import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverSkills, searchSkills } from "../../src/cli/skills/registry.ts";

describe("skill registry", () => {
  test("discovers bundled and local skills", async () => {
    const bundledDir = await makeSkillRoot("bundled-skill", "Bundled media helper");
    const localDir = await makeSkillRoot("local-skill", "Local transcript helper");
    const skills = await discoverSkills({ bundledDir, localDir });
    expect(skills.map((skill) => `${skill.source}:${skill.manifest.name}`)).toEqual([
      "bundled:bundled-skill",
      "local:local-skill",
    ]);
  });

  test("searches manifest fields", async () => {
    const bundledDir = await makeSkillRoot("media-analyze", "Analyze Craft video blocks", ["video", "openai"]);
    const skills = await discoverSkills({ bundledDir, localDir: `${bundledDir}-none` });
    const results = searchSkills(skills, "video");
    expect(results).toHaveLength(1);
    expect(results[0]!.manifest.name).toBe("media-analyze");
    expect(results[0]!.matches).toContain("description");
  });
});

async function makeSkillRoot(name: string, description: string, tags = ["test"]): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "craft-cli-skills-"));
  const root = join(parent, name);
  await Bun.$`mkdir -p ${root}/scripts ${root}/examples ${root}/tests`.quiet();
  await Bun.write(`${root}/SKILL.md`, `# ${name}\n`);
  await Bun.write(`${root}/manifest.json`, JSON.stringify({
    name,
    description,
    tags,
    commands: [{ name: "analyze", description: "Analyze media", entry: "scripts/analyze.ts" }],
    permissions: { craft: ["read"] },
    artifacts: ["analysis"],
  }));
  return parent;
}
