import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../..");
const temporary: string[] = [];
function directory() {
  const path = mkdtempSync(join(tmpdir(), "craft install "));
  temporary.push(path);
  return path;
}
function install(...args: string[]) {
  return Bun.spawnSync(["bash", join(repo, "install.sh"), "--skill-only", ...args], { cwd: repo });
}
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("explicit installer skill registration", () => {
  test("links the full skill into a selected directory with spaces", () => {
    const root = directory();
    const result = install("--skill-dir", root);
    expect(result.exitCode).toBe(0);
    expect(readlinkSync(join(root, "craft-cli"))).toBe(join(repo, "skill"));
    expect(existsSync(join(root, "craft-cli", "references", "skill-library.md"))).toBe(true);
  });

  test("refreshes a directory symlink without following its target", () => {
    const root = directory();
    const old = join(root, "old");
    mkdirSync(old);
    symlinkSync(old, join(root, "craft-cli"));
    expect(install("--skill-dir", root).exitCode).toBe(0);
    expect(readlinkSync(join(root, "craft-cli"))).toBe(join(repo, "skill"));
    expect(existsSync(join(old, "skill"))).toBe(false);
  });

  test("preserves an existing real skill directory", () => {
    const root = directory();
    const target = join(root, "craft-cli");
    mkdirSync(target);
    writeFileSync(join(target, "SKILL.md"), "custom skill");
    const result = install("--skill-dir", root);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("custom skill");
    expect(result.stdout.toString()).toContain("already exists and is not a symlink");
  });

  test("requires a destination instead of choosing a harness", () => {
    expect(install().exitCode).toBe(1);
    expect(install("--skill-dir").exitCode).toBe(1);
    expect(install("--skill-dir", "--help").exitCode).toBe(1);
  });
});
