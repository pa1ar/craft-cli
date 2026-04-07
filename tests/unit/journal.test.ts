// unit tests for the mutation journal (sqlite-backed)
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Journal } from "../../src/lib/journal.ts";

describe("Journal", () => {
  let journal: Journal;

  beforeEach(() => {
    journal = new Journal(":memory:");
  });

  afterEach(() => {
    journal.close();
  });

  test("creates database and tables on first open", () => {
    // if we get here without throwing, tables were created
    const j = new Journal(":memory:");
    j.close();
  });

  test("record inserts a mutation and returns an id", () => {
    const id = journal.record({
      op: "update",
      docId: "doc-1",
      blockIds: ["b1", "b2"],
      pre: { text: "old" },
      post: { text: "new" },
    });
    expect(id).toBeGreaterThan(0);
  });

  test("record stores pre/post as JSON correctly", () => {
    const pre = { markdown: "hello", nested: { a: 1 } };
    const post = { markdown: "world", nested: { a: 2 } };
    journal.record({ op: "update", docId: "doc-1", blockIds: ["b1"], pre, post });

    const m = journal.lastMutation("doc-1");
    expect(m).not.toBeNull();
    expect(m!.pre).toEqual(pre);
    expect(m!.post).toEqual(post);
  });

  test("record with null pre (insert operation) works", () => {
    const id = journal.record({
      op: "insert",
      docId: "doc-1",
      blockIds: ["b1"],
      post: { markdown: "new block" },
    });
    expect(id).toBeGreaterThan(0);

    const m = journal.lastMutation("doc-1");
    expect(m!.pre).toBeNull();
    expect(m!.post).toEqual({ markdown: "new block" });
  });

  test("lastMutation returns most recent mutation for a doc", () => {
    journal.record({ op: "update", docId: "doc-1", blockIds: ["b1"], post: { v: 1 } });
    journal.record({ op: "update", docId: "doc-1", blockIds: ["b1"], post: { v: 2 } });
    journal.record({ op: "update", docId: "doc-1", blockIds: ["b1"], post: { v: 3 } });

    const m = journal.lastMutation("doc-1");
    expect(m!.post).toEqual({ v: 3 });
  });

  test("lastMutation returns null for unknown doc", () => {
    const m = journal.lastMutation("nonexistent");
    expect(m).toBeNull();
  });

  test("listMutations returns all mutations ordered by ts DESC", () => {
    journal.record({ op: "insert", docId: "doc-1", blockIds: ["b1"], post: { v: 1 } });
    journal.record({ op: "update", docId: "doc-1", blockIds: ["b1"], post: { v: 2 } });
    journal.record({ op: "delete", docId: "doc-2", blockIds: ["b2"], pre: { v: 3 } });

    const list = journal.listMutations();
    expect(list).toHaveLength(3);
    // most recent first
    expect(list[0].op).toBe("delete");
    expect(list[2].op).toBe("insert");
  });

  test("listMutations with docId filter returns only matching", () => {
    journal.record({ op: "insert", docId: "doc-1", blockIds: ["b1"], post: { v: 1 } });
    journal.record({ op: "update", docId: "doc-2", blockIds: ["b2"], post: { v: 2 } });
    journal.record({ op: "update", docId: "doc-1", blockIds: ["b1"], post: { v: 3 } });

    const list = journal.listMutations({ docId: "doc-1" });
    expect(list).toHaveLength(2);
    expect(list.every((m) => m.docId === "doc-1")).toBe(true);
  });

  test("listMutations with last limit works", () => {
    for (let i = 0; i < 10; i++) {
      journal.record({ op: "update", docId: "doc-1", blockIds: ["b1"], post: { v: i } });
    }

    const list = journal.listMutations({ last: 3 });
    expect(list).toHaveLength(3);
  });

  test("prune deletes old entries", () => {
    // insert mutations with manually set old timestamps
    const db = (journal as any).db;
    db.exec(`
      INSERT INTO mutations (ts, op, doc_id, block_ids, pre, post)
      VALUES
        (datetime('now', '-30 days'), 'update', 'old-doc', '["b1"]', null, '{"v":1}'),
        (datetime('now', '-10 days'), 'update', 'old-doc', '["b2"]', null, '{"v":2}')
    `);
    // also add a fresh one via record
    journal.record({ op: "update", docId: "fresh-doc", blockIds: ["b3"], post: { v: 3 } });

    const deleted = journal.prune(7);
    expect(deleted).toBe(2);

    // fresh one should remain
    const remaining = journal.listMutations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].docId).toBe("fresh-doc");
  });

  test("multiple mutations for same doc: lastMutation returns the latest", () => {
    journal.record({ op: "insert", docId: "doc-x", blockIds: ["b1"], post: { step: "first" } });
    journal.record({ op: "update", docId: "doc-x", blockIds: ["b1"], post: { step: "second" } });
    journal.record({ op: "append", docId: "doc-x", blockIds: ["b1", "b2"], post: { step: "third" } });

    const m = journal.lastMutation("doc-x");
    expect(m!.post).toEqual({ step: "third" });
    expect(m!.blockIds).toEqual(["b1", "b2"]);
    expect(m!.op).toBe("append");
  });

  test("JSON round-trip: pre/post objects survive record -> lastMutation cycle", () => {
    const complex = {
      blocks: [
        { id: "b1", markdown: "# Title", content: [{ id: "b2", markdown: "nested" }] },
      ],
      metadata: { tags: ["a", "b"], count: 42, active: true, empty: null },
    };

    journal.record({ op: "update", docId: "doc-rt", blockIds: ["b1"], pre: complex, post: complex });

    const m = journal.lastMutation("doc-rt");
    expect(m!.pre).toEqual(complex);
    expect(m!.post).toEqual(complex);
  });

  test("close works without error", () => {
    const j = new Journal(":memory:");
    expect(() => j.close()).not.toThrow();
  });
});
