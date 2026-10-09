import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = [process.execPath, join(import.meta.dir, "../../src/cli/main.ts")];
const PAGE = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const SOURCE = 'flowchart LR\n  Visitor["Visitors + staff"] --> App\n  App --> Database\n';
let root: string;
let server: ReturnType<typeof Bun.serve>;
let requests: Array<{ method: string; body: any }>;
let block: any;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "craft-mermaid-cli-"));
  requests = [];
  block = null;
  server = Bun.serve({ port: 0, async fetch(req) {
    const body = req.method === "GET" ? null : await req.json();
    requests.push({ method: req.method, body });
    if (req.method === "POST") {
      block = { ...body.blocks[0], id: ID };
      return Response.json({ items: [block] });
    }
    if (req.method === "DELETE") {
      block = null;
      return Response.json({ items: [{ id: ID }] });
    }
    return Response.json(block);
  } });
});

afterEach(() => { server.stop(true); rmSync(root, { recursive: true, force: true }); });

async function run(args: string[], input = "") {
  const child = Bun.spawn({ cmd: [...CLI, ...args], stdin: "pipe", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, HOME: root, CRAFT_URL: `http://127.0.0.1:${server.port}`, CRAFT_KEY: "fixture", CRAFT_SOURCE: "api" } });
  child.stdin.write(input); child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}

describe("Mermaid CLI flow", () => {
  test("inline diagram survives readback and can be undone through the mutation journal", async () => {
    const inserted = await run(["blocks", "mermaid", PAGE, "--code", SOURCE, "--position", "start", "--json"]);
    expect(inserted.code).toBe(0);
    expect(JSON.parse(inserted.stdout).items[0]).toEqual({ id: ID, type: "code", language: "mermaid", rawCode: SOURCE });
    const read = await run(["blocks", "get", ID, "--json"]);
    expect(read.code).toBe(0);
    expect(JSON.parse(read.stdout).rawCode).toBe(SOURCE);
    expect((await run(["undo", PAGE])).code).toBe(0);
    expect(block).toBeNull();
    expect(requests[0].body.position).toEqual({ pageId: PAGE, position: "start" });
    expect(requests.at(-1)?.body).toEqual({ blockIds: [ID] });
  });

  test("file and piped source are preserved, including a daily target", async () => {
    const file = join(root, "diagram.mmd"); writeFileSync(file, SOURCE);
    expect((await run(["blocks", "mermaid", PAGE, "--file", file])).code).toBe(0);
    expect(block.rawCode).toBe(SOURCE);
    expect((await run(["blocks", "mermaid", "--date", "today", "-"], SOURCE)).code).toBe(0);
    expect(block.rawCode).toBe(SOURCE);
    expect(requests.at(-1)?.body.position).toEqual({ date: "today", position: "end" });
  });

  test("dry-run previews the diagram without sending a request", async () => {
    const result = await run(["blocks", "mermaid", PAGE, "--code", SOURCE, "--dry-run", "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).blocks[0].rawCode).toBe(SOURCE);
    expect(requests).toEqual([]);
  });

  test("missing targets, empty source and conflicting sources fail without writing", async () => {
    for (const args of [["--code", SOURCE], [PAGE, "--code", "  "], [PAGE, "--code", SOURCE, "--file", "unused"]]) {
      expect((await run(["blocks", "mermaid", ...args])).code).toBe(1);
    }
    expect(requests).toEqual([]);
  });

  test("help and discovery explain native rendering without contacting Craft", async () => {
    expect((await run(["blocks", "mermaid", "--help"])).stdout).toContain("Craft renders Mermaid");
    const discovery = await run(["which", "mermaid", "--json"]);
    expect(discovery.code).toBe(0);
    expect(JSON.parse(discovery.stdout).items[0].command).toContain("blocks mermaid");
    expect(requests).toEqual([]);
  });
});
