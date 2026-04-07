// sqlite-based mutation journal for tracking write operations.
// cli-only module — uses bun:sqlite, not importable from browser/raycast.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// --- types ---

export interface Mutation {
  id: number;
  ts: string;
  op: string;
  docId: string;
  blockIds: string[];
  pre: unknown | null;
  post: unknown | null;
}

export interface RecordOpts {
  op: string;
  docId: string;
  blockIds: string[];
  pre?: unknown;
  post?: unknown;
}

export interface ListOpts {
  docId?: string;
  last?: number;
  since?: string;
}

// --- constants ---

const DEFAULT_DB_PATH = join(homedir(), ".cache", "craft-cli", "journal.db");
const PRUNE_CHANCE = 0.05; // ~1 in 20 calls triggers auto-prune
const DEFAULT_PRUNE_DAYS = 7;
const DEFAULT_LIST_LIMIT = 20;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  op TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  block_ids TEXT NOT NULL,
  pre TEXT,
  post TEXT
);
CREATE INDEX IF NOT EXISTS idx_mutations_doc ON mutations(doc_id, ts);
`;

// --- journal class ---

export class Journal {
  private db: Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? DEFAULT_DB_PATH;

    // skip mkdir for in-memory databases
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec(SCHEMA);
  }

  /** convenience factory, same as constructor */
  static open(dbPath?: string): Journal {
    return new Journal(dbPath);
  }

  /** record a mutation, returns the inserted row id */
  record(opts: RecordOpts): number {
    const stmt = this.db.prepare(
      `INSERT INTO mutations (op, doc_id, block_ids, pre, post) VALUES (?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      opts.op,
      opts.docId,
      JSON.stringify(opts.blockIds),
      opts.pre !== undefined ? JSON.stringify(opts.pre) : null,
      opts.post !== undefined ? JSON.stringify(opts.post) : null,
    );

    // auto-prune with ~1/20 probability
    if (Math.random() < PRUNE_CHANCE) {
      this.prune();
    }

    return Number(result.lastInsertRowid);
  }

  /** get the most recent mutation for a doc, or null */
  lastMutation(docId: string): Mutation | null {
    const row = this.db
      .prepare("SELECT * FROM mutations WHERE doc_id = ? ORDER BY ts DESC, id DESC LIMIT 1")
      .get(docId) as RawRow | null;

    return row ? parseRow(row) : null;
  }

  /** list mutations with optional filters */
  listMutations(opts?: ListOpts): Mutation[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (opts?.docId) {
      conditions.push("doc_id = ?");
      params.push(opts.docId);
    }
    if (opts?.since) {
      conditions.push("ts >= ?");
      params.push(opts.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts?.last ?? DEFAULT_LIST_LIMIT;
    params.push(limit);

    const sql = `SELECT * FROM mutations ${where} ORDER BY ts DESC, id DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params) as RawRow[];
    return rows.map(parseRow);
  }

  /** delete mutations older than daysToKeep, returns count deleted */
  prune(daysToKeep?: number): number {
    const days = daysToKeep ?? DEFAULT_PRUNE_DAYS;
    // use strftime with same ISO format as the ts column to ensure consistent TEXT comparison
    const result = this.db
      .prepare("DELETE FROM mutations WHERE ts < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || ? || ' days')")
      .run(days);
    return result.changes;
  }

  /** close the sqlite connection */
  close(): void {
    this.db.close();
  }
}

// --- internal helpers ---

interface RawRow {
  id: number;
  ts: string;
  op: string;
  doc_id: string;
  block_ids: string;
  pre: string | null;
  post: string | null;
}

function parseRow(row: RawRow): Mutation {
  return {
    id: row.id,
    ts: row.ts,
    op: row.op,
    docId: row.doc_id,
    blockIds: JSON.parse(row.block_ids),
    pre: row.pre !== null ? JSON.parse(row.pre) : null,
    post: row.post !== null ? JSON.parse(row.post) : null,
  };
}
