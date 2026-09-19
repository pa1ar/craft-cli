// local-db.ts - read-only access to Craft's local SQLite FTS5 and PlainTextSearch JSON
// cli-only module (uses bun:sqlite). not exported from lib/index.ts

import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

// --- types ---

export interface LocalSearchResult {
  id: string;
  content: string;
  type: string;
  entityType: string;
  documentId: string;
  isTodo: boolean;
  isTodoChecked: number; // 0=unchecked, 1=done, 2=canceled
}

export interface LocalDoc {
  id: string;
  documentId: string;
  title: string;
  isDailyNote: boolean;
  tags: string[];
  modified: number; // unix timestamp
  contentHash: string;
}

export interface PTSDocument {
  documentId: string;
  title: string;
  markdownContent: string;
  plainTextContent: string;
  contentHash: string;
  isDailyNote: boolean;
  tags: string[];
  modified: number;
  lastViewed: number;
  blockCount: number;
  stamp: string;
}

/** A document rendered for reading, sourced entirely from the local store. */
export interface LocalDocMarkdown {
  id: string; // API entity id (BlockSearch.id)
  documentId: string; // internal PlainTextSearch id
  title: string;
  markdown: string;
  contentHash: string;
  modified: number;
  blockCount: number;
  isDailyNote: boolean;
}

// --- nsdate conversion ---

const NSDATE_EPOCH = 978307200; // 2001-01-01 00:00:00 UTC

function nsdateToUnix(nsdate: number): number {
  return Math.floor(nsdate + NSDATE_EPOCH);
}

// --- markdown normalization ---

/** PlainTextSearch renders the page block itself as an empty heading
 * (`# `, `#### `, ...) because the real title lives in a sibling field.
 * Replace it with the real title and clean transport artifacts. */
export function normalizePtsMarkdown(title: string, markdownContent: string): string {
  // PTS uses the page block itself as an empty heading. Remove that verified
  // transport wrapper (and its separator line), then preserve the document
  // body exactly. Trailing spaces can be Markdown hard-breaks and blank lines
  // are meaningful inside fenced code blocks.
  let md = markdownContent ?? "";
  md = md.replace(/\r\n/g, "\n");
  md = md.replace(/^#{1,6}[ \t]*\n(?:\n)?/, "");

  const heading = title.trim();
  if (!heading) return md;
  if (!md) return `# ${heading}\n`;
  const body = md.endsWith("\n") ? md : `${md}\n`;
  return `# ${heading}\n\n${body}`;
}

/** Daily notes are titled `YYYY.MM.DD` in Craft. */
export function dailyTitleForDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

// --- local store ---

export interface LocalStoreConfig {
  dbPath: string;
  ptsDir: string | null;
}

export class LocalStore {
  private db: Database;
  private ptsDir: string | null;

  constructor(config: LocalStoreConfig) {
    this.db = new Database(config.dbPath, { readonly: true });
    this.ptsDir = config.ptsDir;
  }

  // for tests: inject an already-open database
  static fromDb(db: Database, ptsDir: string | null): LocalStore {
    const store = Object.create(LocalStore.prototype) as LocalStore;
    store.db = db;
    store.ptsDir = ptsDir;
    return store;
  }

  search(
    query: string,
    opts?: { entityType?: string; limit?: number },
  ): LocalSearchResult[] {
    const limit = opts?.limit ?? 100;
    try {
      // Filter entityType in SQL. Filtering after a LIMIT drops every document
      // hit for common terms, because block rows fill the page first.
      const entityClause = opts?.entityType ? " AND entityType = ?" : "";
      const params = opts?.entityType ? [query, opts.entityType] : [query];
      const rows = this.db
        .query<any, string[]>(
          `SELECT id, content, type, entityType, documentId, isTodo, isTodoChecked
           FROM BlockSearch
           WHERE BlockSearch MATCH ?${entityClause}
           ORDER BY rank
           LIMIT ${limit}`,
        )
        .all(...params);

      let results: LocalSearchResult[] = rows.map(rowToSearchResult);

      // belt and braces: the SQL predicate is authoritative, this guards
      // against a future schema change that stores entityType loosely
      if (opts?.entityType) {
        results = results.filter((r) => r.entityType === opts.entityType);
      }

      return results.slice(0, limit);
    } catch (err) {
      console.warn(`[local-db] search error: ${(err as Error).message}`);
      return [];
    }
  }

  listDocs(opts?: { enrich?: boolean }): LocalDoc[] {
    try {
      const rows = this.db
        .query<any, []>(
          `SELECT id, content, documentId FROM BlockSearch WHERE entityType = 'document'`,
        )
        .all();

      // filter out internal pseudo-documents (non-UUID ids like block_taskInbox)
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const docs = rows.filter((row) => UUID_RE.test(row.id));

      const shouldEnrich = opts?.enrich !== false && this.ptsDir !== null;

      return docs.map((row) => {
        const pts = shouldEnrich ? this.readPts(row.documentId) : null;
        return {
          id: row.id,
          documentId: row.documentId,
          title: row.content ?? "",
          isDailyNote: pts?.isDailyNote ?? false,
          tags: pts?.tags ?? [],
          modified: pts ? nsdateToUnix(pts.modified) : 0,
          contentHash: pts?.contentHash ?? "",
        };
      });
    } catch (err) {
      console.warn(`[local-db] listDocs error: ${(err as Error).message}`);
      return [];
    }
  }

  getDocContent(entityId: string): PTSDocument | null {
    const docId = this.resolveId(entityId);
    if (!docId) return null;
    return this.getDocContentByInternalId(docId);
  }

  getDocContentByInternalId(documentId: string): PTSDocument | null {
    const raw = this.readPts(documentId);
    if (!raw) return null;
    return {
      documentId: raw.documentId,
      title: raw.title ?? "",
      markdownContent: raw.markdownContent ?? "",
      plainTextContent: raw.plainTextContent ?? "",
      contentHash: raw.contentHash ?? "",
      isDailyNote: raw.isDailyNote ?? false,
      tags: raw.tags ?? [],
      modified: nsdateToUnix(raw.modified ?? 0),
      lastViewed: nsdateToUnix(raw.lastViewed ?? 0),
      blockCount: raw.blockCount ?? 0,
      stamp: raw.stamp ?? "",
    };
  }

  /** Resolve an API entity id to its internal document id and title.
   * The BlockSearch document row keeps the title as typed; PTS `title` is a
   * normalized search form and can differ in case. */
  resolveDocRow(entityId: string): { documentId: string; title: string } | null {
    try {
      const row = this.db
        .query<{ documentId: string; content: string }, [string]>(
          `SELECT documentId, content FROM BlockSearch
           WHERE id = ? AND entityType = 'document'`,
        )
        .get(entityId);
      if (!row) return null;
      return { documentId: row.documentId, title: row.content ?? "" };
    } catch (err) {
      console.warn(`[local-db] resolveDocRow error: ${(err as Error).message}`);
      return null;
    }
  }

  /** Full document read from the local store. Returns null when the document
   * is not mirrored locally, so callers can fall back to the API. */
  getDocMarkdown(entityId: string): LocalDocMarkdown | null {
    const row = this.resolveDocRow(entityId);
    if (!row) return null;
    const pts = this.getDocContentByInternalId(row.documentId);
    if (!pts) return null;
    const title = row.title || pts.title || "";
    return {
      id: entityId,
      documentId: row.documentId,
      title,
      markdown: normalizePtsMarkdown(title, pts.markdownContent),
      contentHash: pts.contentHash,
      modified: pts.modified,
      blockCount: pts.blockCount,
      isDailyNote: pts.isDailyNote,
    };
  }

  /** Find a daily note by its `YYYY.MM.DD` title. */
  findDailyDocByTitle(title: string): { id: string; documentId: string; title: string } | null {
    try {
      const rows = this.db
        .query<{ id: string; documentId: string; content: string }, [string]>(
          `SELECT id, documentId, content FROM BlockSearch
           WHERE entityType = 'document' AND content = ?`,
        )
        .all(title);
      for (const row of rows) {
        // A title collision can be an ordinary document named like a date.
        // When PTS metadata is present, require Craft's daily-note marker;
        // older/partial caches without PTS remain readable for compatibility.
        const pts = this.readPts(row.documentId);
        if (pts && pts.isDailyNote !== true) continue;
        return { id: row.id, documentId: row.documentId, title: row.content ?? title };
      }
      return null;
    } catch (err) {
      console.warn(`[local-db] findDailyDocByTitle error: ${(err as Error).message}`);
      return null;
    }
  }

  findBlockByContent(entityId: string, text: string): LocalSearchResult[] {
    const docId = this.resolveId(entityId);
    if (!docId) return [];
    try {
      const pattern = `%${text}%`;
      const rows = this.db
        .query<any, [string, string]>(
          `SELECT id, content, type, entityType, documentId, isTodo, isTodoChecked
           FROM BlockSearch WHERE documentId = ? AND content LIKE ?`,
        )
        .all(docId, pattern);
      return rows.map(rowToSearchResult);
    } catch (err) {
      console.warn(
        `[local-db] findBlockByContent error: ${(err as Error).message}`,
      );
      return [];
    }
  }

  resolveId(entityId: string): string | null {
    try {
      const row = this.db
        .query<{ documentId: string }, [string]>(
          `SELECT documentId FROM BlockSearch WHERE id = ? AND entityType = 'document'`,
        )
        .get(entityId);
      return row?.documentId ?? null;
    } catch (err) {
      console.warn(`[local-db] resolveId error: ${(err as Error).message}`);
      return null;
    }
  }

  checkChanged(entityId: string, knownHash: string): boolean | null {
    const docId = this.resolveId(entityId);
    if (!docId) return null;
    const raw = this.readPts(docId);
    if (!raw || !raw.contentHash) return null;
    return raw.contentHash !== knownHash;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed or invalid - ignore
    }
  }

  // --- private helpers ---

  private readPts(documentId: string): any | null {
    if (!this.ptsDir) return null;
    // Craft Desktop normally uses `document_<id>.json`. A few cache exports
    // (and older Desktop builds) retain the internal id as the filename, so
    // accept that form as a read-only compatibility fallback.
    const paths = [
      join(this.ptsDir, `document_${documentId}.json`),
      join(this.ptsDir, documentId),
    ];
    for (const path of paths) {
      try {
        const raw = readFileSync(path, "utf-8");
        return JSON.parse(raw);
      } catch {
        // try the next filename variant
      }
    }
    return null;
  }
}

function rowToSearchResult(row: any): LocalSearchResult {
  return {
    id: row.id ?? "",
    content: row.content ?? "",
    type: row.type ?? "",
    entityType: row.entityType ?? "",
    documentId: row.documentId ?? "",
    isTodo: row.isTodo === "1" || row.isTodo === 1 || row.isTodo === true,
    isTodoChecked: Number(row.isTodoChecked) || 0,
  };
}

// --- discovery ---

const CONTAINER_IDS = [
  "com.lukilabs.lukiapp",
  "com.lukilabs.lukiapp-setapp",
] as const;

function containerBase(containerId: string): string {
  return join(
    homedir(),
    "Library/Containers",
    containerId,
    "Data/Library/Application Support",
    containerId,
  );
}

/** exported for testing only */
export function validateSchema(dbPath: string): boolean {
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    // run a probe query to check expected columns exist
    db.query(
      `SELECT id, content, type, entityType, customRank, isTodo, isTodoChecked,
              documentId, stamp, exactMatchContent
       FROM BlockSearch LIMIT 0`,
    ).run();
    return true;
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
  }
}

export function discoverLocalStore(spaceId?: string): LocalStore | null {
  // allow overriding the app container base path via env
  const envPath = process.env.CRAFT_LOCAL_PATH;
  if (envPath) {
    return discoverInBase(envPath, spaceId);
  }

  for (const containerId of CONTAINER_IDS) {
    const base = containerBase(containerId);
    const result = discoverInBase(base, spaceId);
    if (result) return result;
  }

  return null;
}

/** Select the index whose final namespace component matches the Craft space.
 * Composite filenames use `<account-or-primary-space>||<spaceId>`, so a plain
 * substring match can route the primary space to one of its secondary spaces. */
export function selectSpaceIndexFile(sqliteFiles: string[], spaceId: string): string | undefined {
  const exact = `SearchIndex_${spaceId}.sqlite`;
  return sqliteFiles.find((file) => file === exact)
    ?? sqliteFiles.find((file) => {
      const namespace = basename(file, ".sqlite").replace("SearchIndex_", "");
      return namespace.split("||").at(-1) === spaceId;
    });
}

function discoverInBase(base: string, spaceId?: string): LocalStore | null {
  const searchDir = join(base, "Search");
  const ptsBase = join(base, "PlainTextSearch");

  if (!existsSync(searchDir)) return null;

  let sqliteFiles: string[];
  try {
    sqliteFiles = readdirSync(searchDir).filter((f) => f.endsWith(".sqlite"));
  } catch {
    return null;
  }

  if (sqliteFiles.length === 0) return null;

  // if spaceId provided, look for matching file
  if (spaceId) {
    const match = selectSpaceIndexFile(sqliteFiles, spaceId);
    if (!match) return null;
    const dbPath = join(searchDir, match);
    if (!validateSchema(dbPath)) {
      console.error(`[local-db] schema mismatch in ${dbPath}, skipping`);
      return null;
    }
    // find matching PTS dir
    const ptsDirName = basename(match, ".sqlite").replace("SearchIndex_", "");
    const ptsDir = join(ptsBase, ptsDirName);
    return new LocalStore({
      dbPath,
      ptsDir: existsSync(ptsDir) ? ptsDir : null,
    });
  }

  // no spaceId: pick the largest sqlite file (primary space)
  let best: { file: string; size: number } | null = null;
  for (const f of sqliteFiles) {
    try {
      const s = statSync(join(searchDir, f)).size;
      if (!best || s > best.size) best = { file: f, size: s };
    } catch {
      continue;
    }
  }

  if (!best) return null;

  const dbPath = join(searchDir, best.file);
  if (!validateSchema(dbPath)) {
    console.error(`[local-db] schema mismatch in ${dbPath}, skipping`);
    return null;
  }

  const ptsDirName = basename(best.file, ".sqlite").replace(
    "SearchIndex_",
    "",
  );
  const ptsDir = join(ptsBase, ptsDirName);
  return new LocalStore({
    dbPath,
    ptsDir: existsSync(ptsDir) ? ptsDir : null,
  });
}
