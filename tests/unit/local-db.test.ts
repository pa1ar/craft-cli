// tests for src/lib/local-db.ts - uses in-memory sqlite and temp dirs only
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalStore, discoverLocalStore, validateSchema } from "../../src/lib/local-db.ts";

// --- helpers ---

const NSDATE_EPOCH = 978307200;

function createFts5Db(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE VIRTUAL TABLE BlockSearch USING fts5(
      id, content, type, entityType, customRank,
      isTodo, isTodoChecked, documentId, stamp UNINDEXED,
      exactMatchContent, tokenize='unicode61'
    )
  `);
  return db;
}

function insertRow(
  db: Database,
  row: {
    id: string;
    content: string;
    type?: string;
    entityType?: string;
    customRank?: string;
    isTodo?: string;
    isTodoChecked?: string;
    documentId?: string;
    stamp?: string;
    exactMatchContent?: string;
  },
) {
  db.run(
    `INSERT INTO BlockSearch VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.content,
      row.type ?? "text",
      row.entityType ?? "block",
      row.customRank ?? "100",
      row.isTodo ?? "0",
      row.isTodoChecked ?? "0",
      row.documentId ?? "DOC-001",
      row.stamp ?? "STAMP-1",
      row.exactMatchContent ?? row.content.toLowerCase().replace(/\s/g, ""),
    ],
  );
}

// sample PTS json matching Craft's real format
function makePtsJson(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    documentId: "DOC-INT-AAA",
    title: "Test Document",
    markdownContent: "# Test Document\n\nHello world",
    plainTextContent: "Test Document\nHello world",
    contentHash: "ABC123HASH",
    isDailyNote: false,
    tags: ["tag/one", "tag/two"],
    modified: 800000000, // nsdate
    lastViewed: 800000100,
    blockCount: 5,
    stamp: "STAMP-PTS-1",
    tagSearchContent: "",
    ...overrides,
  });
}

// --- fixtures ---

let db: Database;
let ptsDir: string;
let store: LocalStore;

beforeEach(() => {
  db = createFts5Db();

  // 2 documents
  insertRow(db, {
    id: "A0000001-0000-0000-0000-000000000001",
    content: "meeting notes april",
    entityType: "document",
    documentId: "DOC-INT-AAA",
  });
  insertRow(db, {
    id: "A0000001-0000-0000-0000-000000000002",
    content: "project roadmap",
    entityType: "document",
    documentId: "DOC-INT-BBB",
  });

  // 1 page
  insertRow(db, {
    id: "ENT-PAGE-1",
    content: "dashboard overview",
    entityType: "page",
    documentId: "DOC-INT-AAA",
  });

  // 7 blocks with various types
  insertRow(db, {
    id: "BLK-1",
    content: "hello world meeting",
    type: "text",
    documentId: "DOC-INT-AAA",
  });
  insertRow(db, {
    id: "BLK-2",
    content: "screenshot of dashboard",
    type: "image",
    documentId: "DOC-INT-AAA",
  });
  insertRow(db, {
    id: "BLK-3",
    content: "https://example.com",
    type: "url",
    documentId: "DOC-INT-AAA",
  });
  insertRow(db, {
    id: "BLK-4",
    content: "function main() {}",
    type: "code",
    documentId: "DOC-INT-BBB",
  });
  insertRow(db, {
    id: "BLK-5",
    content: "buy groceries",
    type: "text",
    isTodo: "1",
    isTodoChecked: "0",
    documentId: "DOC-INT-AAA",
  });
  insertRow(db, {
    id: "BLK-6",
    content: "write tests",
    type: "text",
    isTodo: "1",
    isTodoChecked: "1",
    documentId: "DOC-INT-BBB",
  });
  insertRow(db, {
    id: "BLK-7",
    content: "roadmap item canceled",
    type: "text",
    isTodo: "1",
    isTodoChecked: "2",
    documentId: "DOC-INT-BBB",
  });

  // pts dir with sample json files
  ptsDir = mkdtempSync(join(tmpdir(), "craft-local-db-test-"));
  writeFileSync(join(ptsDir, "document_DOC-INT-AAA.json"), makePtsJson());
  writeFileSync(
    join(ptsDir, "document_DOC-INT-BBB.json"),
    makePtsJson({
      documentId: "DOC-INT-BBB",
      title: "project roadmap",
      contentHash: "DEF456HASH",
      isDailyNote: true,
      tags: ["project/main"],
      modified: 810000000,
      lastViewed: 810000100,
      blockCount: 12,
    }),
  );

  store = LocalStore.fromDb(db, ptsDir);
});

afterEach(() => {
  store.close();
  try {
    rmSync(ptsDir, { recursive: true });
  } catch {
    // ignore
  }
});

// --- tests ---

describe("discoverLocalStore", () => {
  test("returns null when path does not exist", () => {
    // monkey-patch homedir would be complex; just verify the function
    // handles missing containers gracefully by testing with a non-existent spaceId
    const result = discoverLocalStore(
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    );
    expect(result).toBeNull();
  });

  test("returns null on schema mismatch", () => {
    // create a temp db with wrong schema
    const tmpDir = mkdtempSync(join(tmpdir(), "craft-schema-test-"));
    const tmpPath = join(tmpDir, "bad.sqlite");
    const badDb = new Database(tmpPath);
    badDb.run("CREATE TABLE BlockSearch (id TEXT, content TEXT)");
    badDb.close();

    expect(validateSchema(tmpPath)).toBe(false);
    rmSync(tmpDir, { recursive: true });
  });

  test("validateSchema returns true for correct schema", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "craft-schema-good-"));
    const tmpPath = join(tmpDir, "good.sqlite");
    const goodDb = new Database(tmpPath);
    goodDb.run(`
      CREATE VIRTUAL TABLE BlockSearch USING fts5(
        id, content, type, entityType, customRank,
        isTodo, isTodoChecked, documentId, stamp UNINDEXED,
        exactMatchContent, tokenize='unicode61'
      )
    `);
    goodDb.close();

    expect(validateSchema(tmpPath)).toBe(true);
    rmSync(tmpDir, { recursive: true });
  });

  test("validateSchema returns false for nonexistent file", () => {
    expect(validateSchema("/tmp/nonexistent-craft-db.sqlite")).toBe(false);
  });
});

describe("search", () => {
  test("returns matching results", () => {
    const results = store.search("meeting");
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("A0000001-0000-0000-0000-000000000001");
    expect(ids).toContain("BLK-1");
  });

  test("respects entityType filter", () => {
    const results = store.search("meeting", { entityType: "document" });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("A0000001-0000-0000-0000-000000000001");
  });

  test("respects limit", () => {
    const results = store.search("*", { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test("returns empty array on bad query", () => {
    // unbalanced quotes cause fts5 parse error
    const results = store.search('bad"query"unmatched"');
    expect(results).toEqual([]);
  });
});

describe("listDocs", () => {
  test("returns documents enriched with PTS data", () => {
    const docs = store.listDocs();
    expect(docs.length).toBe(2);

    const doc1 = docs.find((d) => d.id === "A0000001-0000-0000-0000-000000000001")!;
    expect(doc1).toBeDefined();
    expect(doc1.title).toBe("meeting notes april");
    expect(doc1.isDailyNote).toBe(false);
    expect(doc1.tags).toEqual(["tag/one", "tag/two"]);
    expect(doc1.contentHash).toBe("ABC123HASH");
    expect(doc1.modified).toBe(800000000 + NSDATE_EPOCH);

    const doc2 = docs.find((d) => d.id === "A0000001-0000-0000-0000-000000000002")!;
    expect(doc2.isDailyNote).toBe(true);
    expect(doc2.tags).toEqual(["project/main"]);
  });

  test("fills defaults when PTS file is missing", () => {
    // create a store with no PTS dir
    const noPtsStore = LocalStore.fromDb(db, null);
    const docs = noPtsStore.listDocs();
    expect(docs.length).toBe(2);
    expect(docs[0].isDailyNote).toBe(false);
    expect(docs[0].tags).toEqual([]);
    expect(docs[0].modified).toBe(0);
    expect(docs[0].contentHash).toBe("");
  });

  test("filters out non-UUID pseudo-documents", () => {
    // insert internal pseudo-docs like Craft's block_taskInbox
    insertRow(db, {
      id: "block_taskInbox",
      content: "Task Inbox",
      entityType: "document",
      documentId: "INTERNAL-1",
    });
    insertRow(db, {
      id: "block_taskLogbook",
      content: "Task Logbook",
      entityType: "document",
      documentId: "INTERNAL-2",
    });

    const docs = store.listDocs();
    expect(docs.length).toBe(2); // only the 2 real UUID docs
    expect(docs.find((d) => d.id === "block_taskInbox")).toBeUndefined();
    expect(docs.find((d) => d.id === "block_taskLogbook")).toBeUndefined();
  });

  test("enrich: false skips PTS file reads", () => {
    const docs = store.listDocs({ enrich: false });
    expect(docs.length).toBe(2);
    // without enrichment, all PTS fields are defaults
    expect(docs[0].isDailyNote).toBe(false);
    expect(docs[0].tags).toEqual([]);
    expect(docs[0].contentHash).toBe("");
    expect(docs[0].modified).toBe(0);
    // but id and title still come from SQLite
    expect(docs[0].id).toBeTruthy();
    expect(docs[0].title).toBeTruthy();
  });

  test("enrich: true reads PTS data", () => {
    const docs = store.listDocs({ enrich: true });
    const doc1 = docs.find((d) => d.id === "A0000001-0000-0000-0000-000000000001")!;
    expect(doc1.isDailyNote).toBe(false);
    expect(doc1.tags).toEqual(["tag/one", "tag/two"]);
    expect(doc1.contentHash).toBe("ABC123HASH");
  });
});

describe("getDocContent", () => {
  test("resolves entity ID and reads PTS JSON", () => {
    const doc = store.getDocContent("A0000001-0000-0000-0000-000000000001");
    expect(doc).not.toBeNull();
    expect(doc!.documentId).toBe("DOC-INT-AAA");
    expect(doc!.title).toBe("Test Document");
    expect(doc!.markdownContent).toContain("Hello world");
    expect(doc!.tags).toEqual(["tag/one", "tag/two"]);
    expect(doc!.modified).toBe(800000000 + NSDATE_EPOCH);
    expect(doc!.lastViewed).toBe(800000100 + NSDATE_EPOCH);
    expect(doc!.blockCount).toBe(5);
  });

  test("returns null for unknown entity ID", () => {
    const doc = store.getDocContent("DOES-NOT-EXIST");
    expect(doc).toBeNull();
  });

  test("returns null when PTS dir is missing", () => {
    const noPtsStore = LocalStore.fromDb(db, null);
    const doc = noPtsStore.getDocContent("A0000001-0000-0000-0000-000000000001");
    expect(doc).toBeNull();
  });
});

describe("getDocContentByInternalId", () => {
  test("reads PTS directly without SQLite lookup", () => {
    const doc = store.getDocContentByInternalId("DOC-INT-BBB");
    expect(doc).not.toBeNull();
    expect(doc!.isDailyNote).toBe(true);
    expect(doc!.contentHash).toBe("DEF456HASH");
  });

  test("returns null for missing document", () => {
    const doc = store.getDocContentByInternalId("NONEXISTENT");
    expect(doc).toBeNull();
  });
});

describe("findBlockByContent", () => {
  test("finds blocks in a specific document", () => {
    const results = store.findBlockByContent("A0000001-0000-0000-0000-000000000001", "meeting");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // should find BLK-1 and A0000001-0000-0000-0000-000000000001 (both in DOC-INT-AAA with 'meeting')
    const ids = results.map((r) => r.id);
    expect(ids).toContain("BLK-1");
  });

  test("returns empty for unknown entity", () => {
    const results = store.findBlockByContent("NOPE", "anything");
    expect(results).toEqual([]);
  });
});

describe("resolveId", () => {
  test("maps entity ID to internal document ID", () => {
    expect(store.resolveId("A0000001-0000-0000-0000-000000000001")).toBe("DOC-INT-AAA");
    expect(store.resolveId("A0000001-0000-0000-0000-000000000002")).toBe("DOC-INT-BBB");
  });

  test("returns null for non-document entities", () => {
    // BLK-1 is a block, not a document
    expect(store.resolveId("BLK-1")).toBeNull();
  });

  test("returns null for unknown ID", () => {
    expect(store.resolveId("UNKNOWN")).toBeNull();
  });
});

describe("checkChanged", () => {
  test("returns false when hash matches", () => {
    const result = store.checkChanged("A0000001-0000-0000-0000-000000000001", "ABC123HASH");
    expect(result).toBe(false);
  });

  test("returns true when hash differs", () => {
    const result = store.checkChanged("A0000001-0000-0000-0000-000000000001", "OLDHASH");
    expect(result).toBe(true);
  });

  test("returns null for unknown entity", () => {
    const result = store.checkChanged("NOPE", "any");
    expect(result).toBeNull();
  });

  test("returns null when PTS dir missing", () => {
    const noPtsStore = LocalStore.fromDb(db, null);
    const result = noPtsStore.checkChanged("A0000001-0000-0000-0000-000000000001", "any");
    expect(result).toBeNull();
  });
});

describe("NSDate conversion", () => {
  test("converts known NSDate to correct unix timestamp", () => {
    // 2026-04-06 00:00:00 UTC
    // unix: 1775433600
    // nsdate: 1775433600 - 978307200 = 797126400
    const doc = store.getDocContent("A0000001-0000-0000-0000-000000000002");
    expect(doc).not.toBeNull();
    // modified nsdate = 810000000 -> unix = 810000000 + 978307200 = 1788307200
    expect(doc!.modified).toBe(1788307200);
  });
});

describe("isTodo fields", () => {
  test("parses todo flags correctly", () => {
    const results = store.search("groceries");
    const todo = results.find((r) => r.id === "BLK-5");
    expect(todo).toBeDefined();
    expect(todo!.isTodo).toBe(true);
    expect(todo!.isTodoChecked).toBe(0);
  });

  test("parses checked todo", () => {
    const results = store.search("tests");
    const done = results.find((r) => r.id === "BLK-6");
    expect(done).toBeDefined();
    expect(done!.isTodo).toBe(true);
    expect(done!.isTodoChecked).toBe(1);
  });

  test("parses canceled todo", () => {
    const results = store.search("canceled");
    const canceled = results.find((r) => r.id === "BLK-7");
    expect(canceled).toBeDefined();
    expect(canceled!.isTodoChecked).toBe(2);
  });
});
