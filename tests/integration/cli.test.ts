// end-to-end CLI tests: shell out to the built binary, assert stdout/exit.
// gated on CRAFT_URL + CRAFT_KEY env. operates inside __cli-tests__ folder.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { CraftClient } from "../../src/lib/index.ts";
import { join } from "node:path";

const URL = process.env.CRAFT_URL || process.env.ALL_DOCS_MAIN_URL;
const KEY = process.env.CRAFT_KEY || process.env.ALL_DOCS_MAIN_API_KEY;

if (!URL || !KEY) {
  throw new Error("CRAFT_URL + CRAFT_KEY (or ALL_DOCS_MAIN_*) required");
}

// run via `bun src/cli/main.ts` not the compiled binary — faster iteration and same code
const CLI = [process.execPath, join(import.meta.dir, "..", "..", "src/cli/main.ts")];
const env = { ...process.env, CRAFT_URL: URL, CRAFT_KEY: KEY };

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn({
    cmd: [...CLI, ...args],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

let sandboxId: string;
let seedDocId: string;

const client = new CraftClient({ url: URL, key: KEY });

beforeAll(async () => {
  const folders = await client.folders.list();
  const existing = folders.items.find((f) => f.name === "__cli-tests__");
  if (existing) sandboxId = existing.id;
  else {
    const created = await client.folders.create([{ name: "__cli-tests__" }]);
    sandboxId = created.items[0]!.id;
  }
  const doc = await client.documents.create([{ title: `cli-test ${Date.now()}` }], {
    folderId: sandboxId,
  });
  seedDocId = doc.items[0]!.id;
});

afterAll(async () => {
  try { await client.documents.delete([seedDocId]); } catch {}
  try { await client.folders.delete([sandboxId]); } catch {}
});

describe("cli e2e", () => {
  test("whoami --json", async () => {
    const r = await run(["whoami", "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.space?.name).toBeTruthy();
  }, 30000);

  test("folders ls --json", async () => {
    const r = await run(["folders", "ls", "--json"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items.some((f: any) => f.name === "__cli-tests__")).toBe(true);
  }, 30000);

  test("docs get --json depth 0", async () => {
    const r = await run(["docs", "get", seedDocId, "--json", "--depth", "0"]);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.id).toBe(seedDocId);
  }, 30000);

  test("blocks append + get shows inserted", async () => {
    const marker = `cli_test_marker_${Date.now()}`;
    const r = await run(["blocks", "append", seedDocId, "--markdown", marker]);
    expect(r.code).toBe(0);
    const r2 = await run(["docs", "get", seedDocId, "--raw"]);
    expect(r2.stdout).toContain(marker);
  }, 30000);

  test("docs search finds seeded marker", async () => {
    const marker = `cli_search_${Date.now()}`;
    await run(["blocks", "append", seedDocId, "--markdown", marker]);
    // index lag polling
    let found = false;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const r = await run(["docs", "search", marker, "--json"]);
      const out = JSON.parse(r.stdout);
      if (out.items?.length > 0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  }, 30000);

  test("404 on bad block id returns exit 4", async () => {
    const r = await run(["blocks", "get", "00000000-0000-0000-0000-000000000000"]);
    expect(r.code).toBe(4);
    expect(r.stderr).toContain("NOT_FOUND");
  }, 30000);

  test("401 on bad auth returns exit 3", async () => {
    const r = await run(["whoami"]);
    // override env
    const proc = Bun.spawn({
      cmd: [...CLI, "whoami"],
      env: { ...env, CRAFT_KEY: "pdk_bogus" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(3);
  }, 30000);

  test("raw escape hatch", async () => {
    const r = await run(["raw", "GET", "/connection"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.space?.id).toBeTruthy();
  }, 30000);

  test("refuses footgun insert without target", async () => {
    const r = await run(["blocks", "insert", "--file", "/dev/null"]);
    expect(r.code).not.toBe(0);
  }, 30000);

  test("docs daily works", async () => {
    const r = await run(["docs", "daily", "--json", "--depth", "0"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.type).toBe("page");
  }, 30000);
});
