// end-to-end checks for `craft links` on Craft's native /internal-links.
// gated on CRAFT_URL + CRAFT_KEY. creates two docs in __cli-tests__:
// A links to doc B and to a block inside B.
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { CraftClient } from "../../src/lib/index.ts";
import { join } from "node:path";

const URL = process.env.CRAFT_URL || process.env.ALL_DOCS_MAIN_URL;
const KEY = process.env.CRAFT_KEY || process.env.ALL_DOCS_MAIN_API_KEY;
const HAS_CREDS = Boolean(URL && KEY);
const CLI = [process.execPath, join(import.meta.dir, "..", "..", "src/cli/main.ts")];
const env = { ...process.env, CRAFT_URL: URL ?? "http://localhost", CRAFT_KEY: KEY ?? "pdk_missing" };
const client = new CraftClient({ url: URL ?? "http://localhost", key: KEY ?? "pdk_missing" });

async function run(args: string[]) {
  const proc = Bun.spawn({ cmd: [...CLI, ...args], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, code: await proc.exited };
}

/** links are indexed live but not instantly; poll until `ok` or give up. */
async function eventually(args: string[], ok: (stdout: string) => boolean) {
  let last = await run(args);
  for (let i = 0; i < 10 && !(last.code === 0 && ok(last.stdout)); i++) {
    await Bun.sleep(2000);
    last = await run(args);
  }
  return last;
}

let folderId: string;
let docA: string;
let docB: string;
let blockInB: string;
const stamp = Date.now();

const describeLive = HAS_CREDS ? describe : describe.skip;

if (HAS_CREDS) {
  beforeAll(async () => {
    const folders = await client.folders.list();
    const existing = folders.items.find((f) => f.name === "__cli-tests__");
    folderId = existing
      ? existing.id
      : (await client.folders.create([{ name: "__cli-tests__" }])).items[0]!.id;
    const docs = await client.documents.create(
      [{ title: `links-a ${stamp}` }, { title: `links-b ${stamp}` }],
      { folderId },
    );
    docA = docs.items[0]!.id;
    docB = docs.items[1]!.id;
    const inserted = await client.blocks.append(`target block ${stamp}`, { pageId: docB });
    blockInB = inserted.items[0]!.id;
    await client.blocks.append(
      `see [links-b](block://${docB}) and [the block](block://${blockInB})`,
      { pageId: docA },
    );
  }, 60000);

  afterAll(async () => {
    try { await client.documents.delete([docA, docB]); } catch {}
  });
}

describeLive("links e2e (native /internal-links)", () => {
  test("links out <doc> lists the target document with its title", async () => {
    const r = await eventually(["links", "out", docA, "--json", "--source", "api"], (s) =>
      s.toLowerCase().includes(docB.toLowerCase()),
    );
    expect(r.code).toBe(0);
    const items = JSON.parse(r.stdout);
    const pair = items.find((i: any) => i.targetDocumentId.toLowerCase() === docB.toLowerCase());
    expect(pair.targetDocumentTitle).toBe(`links-b ${stamp}`);
    expect(pair.referenceCount).toBe(2);
  }, 60000);

  test("links in <doc> lists the source document", async () => {
    const r = await eventually(["links", "in", docB, "--json", "--source", "api"], (s) =>
      s.toLowerCase().includes(docA.toLowerCase()),
    );
    expect(r.code).toBe(0);
    const items = JSON.parse(r.stdout);
    expect(items.some((i: any) => i.sourceDocumentTitle === `links-a ${stamp}`)).toBe(true);
  }, 60000);

  test("links in <block> --doc finds the exact reference", async () => {
    const r = await eventually(
      ["links", "in", blockInB, "--doc", docB, "--level", "block", "--json", "--source", "api"],
      (s) => s.includes("sourceBlockId"),
    );
    expect(r.code).toBe(0);
    const items = JSON.parse(r.stdout);
    expect(items).toHaveLength(1);
    expect(items[0].targetBlockId.toLowerCase()).toBe(blockInB.toLowerCase());
    expect(items[0].sourceDocumentId.toLowerCase()).toBe(docA.toLowerCase());
  }, 60000);

  test("links in <block> without a known document exits 4 under --source api", async () => {
    const r = await run(["links", "in", blockInB, "--source", "api"]);
    expect(r.code).toBe(4);
    expect(r.stderr).toContain("--doc");
  }, 30000);

  test("links map --from --to returns block references", async () => {
    const r = await eventually(
      ["links", "map", "--from", docA, "--to", docB, "--level", "block", "--json"],
      (s) => s.includes("sourceBlockId"),
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).items).toHaveLength(2);
  }, 60000);
});
