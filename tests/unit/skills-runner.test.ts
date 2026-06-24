import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveBunExecutable, runSkillSubprocess } from "../../src/cli/skills/runner.ts";
import { applyProposedWrites } from "../../src/cli/skills/writes.ts";
import type { SkillRef } from "../../src/cli/skills/manifest.ts";

describe("skill runner", () => {
  test("passes structured JSON stdin and parses stdout", async () => {
    const root = await makeFakeSkill(`const input = await new Response(Bun.stdin.stream()).json();
console.log(JSON.stringify({ status: "ok", markdown: input.command.args.join(","), metrics: { estimatedCostEur: input.limits.maxCostEur } }));`);
    const output = await runSkillSubprocess({
      skill: fakeSkill(root),
      command: { name: "run", description: "Run", entry: "scripts/run.ts", estimatedCostEur: 0.1 },
      args: ["a", "b"],
      maxCostEur: 1,
    });
    expect(output.status).toBe("ok");
    expect(output.markdown).toBe("a,b");
    expect(output.metrics?.estimatedCostEur).toBe(1);
  });

  test("rejects cost estimate above cap before subprocess", async () => {
    const root = await makeFakeSkill(`console.log("should not run");`);
    const output = await runSkillSubprocess({
      skill: fakeSkill(root),
      command: { name: "run", description: "Run", entry: "scripts/run.ts", estimatedCostEur: 2 },
      args: [],
      maxCostEur: 1,
    });
    expect(output.status).toBe("failed");
    expect(output.error).toContain("exceeds cap");
  });

  test("resolves Bun from HOME when PATH omits it", async () => {
    const home = await mkdtemp(join(tmpdir(), "craft-cli-bun-home-"));
    const bunPath = join(home, ".bun", "bin", "bun");
    await mkdir(join(home, ".bun", "bin"), { recursive: true });
    await writeFile(bunPath, "");

    expect(resolveBunExecutable({ HOME: home, PATH: "/usr/bin:/bin" }, "/tmp/craft")).toBe(bunPath);
  });

  test("applies proposed writes through client layer", async () => {
    const calls: unknown[] = [];
    const client = {
      blocks: {
        append: async (markdown: string, target: { pageId: string }) => {
          calls.push({ op: "append", markdown, target });
          return { items: [{ id: "new", markdown }] };
        },
        update: async (updates: unknown[]) => {
          calls.push({ op: "update", updates });
          return { items: updates };
        },
      },
    };
    const applied = await applyProposedWrites(client as any, [
      { op: "append_markdown", parentId: "parent", markdown: "hello" },
      { op: "update_markdown", blockId: "block", markdown: "updated" },
    ]);
    expect(applied).toEqual([
      { op: "append_markdown", count: 1 },
      { op: "update_markdown", count: 1 },
    ]);
    expect(calls).toHaveLength(2);
  });
});

async function makeFakeSkill(script: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "craft-cli-runner-skill-"));
  await Bun.$`mkdir -p ${root}/scripts`.quiet();
  await Bun.write(`${root}/scripts/run.ts`, script);
  return root;
}

function fakeSkill(root: string): SkillRef {
  return {
    root,
    source: "local",
    manifest: {
      name: "fake",
      description: "Fake",
      tags: ["fake"],
      commands: [{ name: "run", description: "Run", entry: "scripts/run.ts" }],
      permissions: {},
      artifacts: [],
    },
  };
}
