// live smoke test for src/lib against 1ar main space, scoped to __cli-tests__ folder.
// gated on CRAFT_URL + CRAFT_KEY env. the suite creates its own sandbox and
// deletes it in afterAll, so nothing leaks into production data.
import { describe, test as rawTest, expect, beforeAll, afterAll } from "bun:test";
import { CraftClient, CraftError } from "../../src/lib/index.ts";

// craft api is slow enough that 5s default times out multi-call tests
const test = (name: string, fn: () => Promise<void> | void) => rawTest(name, fn, 30000);

const URL = process.env.CRAFT_URL || process.env.ALL_DOCS_MAIN_URL;
const KEY = process.env.CRAFT_KEY || process.env.ALL_DOCS_MAIN_API_KEY;

if (!URL || !KEY) {
  throw new Error(
    "integration tests need CRAFT_URL + CRAFT_KEY (or ALL_DOCS_MAIN_URL + ALL_DOCS_MAIN_API_KEY) in env"
  );
}

const c = new CraftClient({ url: URL, key: KEY });
const SANDBOX = "__cli-tests__";

let sandboxId: string;
let seedDocId: string;

beforeAll(async () => {
  // reuse or create sandbox
  const folders = await c.folders.list();
  const existing = folders.items.find((f) => f.name === SANDBOX);
  if (existing) {
    sandboxId = existing.id;
  } else {
    const created = await c.folders.create([{ name: SANDBOX }]);
    sandboxId = created.items[0]!.id;
  }

  const doc = await c.documents.create(
    [{ title: `smoke ${Date.now()}` }],
    { folderId: sandboxId }
  );
  seedDocId = doc.items[0]!.id;
});

afterAll(async () => {
  // soft-delete doc, drop folder
  try {
    await c.documents.delete([seedDocId]);
  } catch {}
  try {
    await c.folders.delete([sandboxId]);
  } catch {}
});

describe("lib smoke", () => {
  test("connection returns space info", async () => {
    const info = await c.connection();
    expect(info.space.id).toBeTruthy();
    expect(info.space.name).toBeTruthy();
    expect(info.urlTemplates.app).toContain("{blockId}");
  });

  test("deeplink builds correctly", async () => {
    const link = await c.deeplink(seedDocId);
    expect(link).toContain("craftdocs://");
    expect(link).toContain(seedDocId);
  });

  test("blocks.insert + get preserves content", async () => {
    await c.blocks.insert(
      [{ type: "text", markdown: "alpha marker" }],
      { position: "end", pageId: seedDocId }
    );
    const fetched = await c.blocks.get(seedDocId, { maxDepth: -1 });
    const raw = JSON.stringify(fetched);
    expect(raw).toContain("alpha marker");
  });

  test("blocks.append to daily note (then clean up)", async () => {
    const marker = `smoke_test_daily_${Date.now()}`;
    const res = await c.blocks.append(marker, { date: "today" });
    expect(res.items.length).toBeGreaterThan(0);
    const insertedId = res.items[0]!.id;
    // clean up immediately — never leave daily-note pollution
    await c.blocks.delete([insertedId]);
  });

  test("blocks.insert refuses footgun position", async () => {
    // @ts-expect-error — intentionally bad type to prove runtime guard
    expect(() => c.blocks.insert([{ markdown: "x" }], { position: "end" })).toThrow(
      /refusing to POST/
    );
  });

  test("partial update preserves children", async () => {
    const seeded = await c.blocks.insert(
      [
        {
          type: "page",
          textStyle: "card",
          markdown: "parent",
          content: [{ type: "text", markdown: "child" }],
        },
      ],
      { position: "end", pageId: seedDocId }
    );
    const cardId = seeded.items[0]!.id;
    await c.blocks.update([{ id: cardId, markdown: "renamed" }]);
    const after: any = await c.blocks.get(cardId, { maxDepth: -1 });
    expect(after.markdown).toBe("renamed");
    expect(after.content?.length).toBe(1);
  });

  test("documents.search with regexps finds content", async () => {
    const marker = `smoke_token_${Date.now()}`;
    await c.blocks.insert(
      [{ type: "text", markdown: `${marker} unique marker` }],
      { position: "end", pageId: seedDocId }
    );
    // search index may lag a few seconds after write; poll with backoff
    let hits = { items: [] as any[] };
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      hits = await c.documents.search({ regexps: marker });
      if (hits.items.length > 0) break;
    }
    expect(hits.items.length).toBeGreaterThan(0);
  });

  test("error shapes normalized: 404 on bad block id", async () => {
    try {
      await c.blocks.get("00000000-0000-0000-0000-000000000000");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CraftError);
      expect((e as CraftError).kind).toBe("NOT_FOUND");
      expect((e as CraftError).status).toBe(404);
      expect((e as CraftError).toExitCode()).toBe(4);
    }
  });

  test("error shapes normalized: 401 on bad auth", async () => {
    const bad = new CraftClient({ url: URL, key: "pdk_bogus" });
    try {
      await bad.connection();
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CraftError);
      expect((e as CraftError).kind).toBe("AUTH");
      expect((e as CraftError).toExitCode()).toBe(3);
    }
  });

  test("markdown format returns text with <page> wrapper", async () => {
    const md = await c.blocks.get(seedDocId, { format: "markdown" });
    expect(typeof md).toBe("string");
    expect(md as string).toContain("<page");
  });

  test("documents.list with metadata includes clickableLink", async () => {
    const list = await c.documents.list({ folderId: sandboxId, fetchMetadata: true });
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items[0]!.clickableLink).toBeTruthy();
  });

  test("tasks roundtrip: add inbox → mark done → in logbook → delete", async () => {
    const added = await c.tasks.add([
      { markdown: `smoke task ${Date.now()}`, location: { type: "inbox" } },
    ]);
    const taskId = added.items[0]!.id;
    await c.tasks.update([{ id: taskId, taskInfo: { state: "done" } }]);
    const logbook = await c.tasks.list("logbook");
    expect(logbook.items.some((t) => t.id === taskId)).toBe(true);
    await c.tasks.delete([taskId]);
  });
});
