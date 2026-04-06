// experiment 2+3: performance & completeness comparison
// craft API vs SQLite FTS5 vs PlainTextSearch JSON
//
// run: bun run tests/experiments/perf-comparison.ts
//
// ID mapping (critical):
//   API document "id" = SQLite BlockSearch "id" column (the block/entity ID)
//   SQLite "documentId" column = PTS "documentId" field = PTS filename suffix
//   to go from API id -> PTS file: look up documentId in SQLite first

import { Database } from "bun:sqlite";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const CRAFT = join(import.meta.dir, "../../dist/craft");
const SPACE_ID = process.env.CRAFT_SPACE_ID;
if (!SPACE_ID) throw new Error("set CRAFT_SPACE_ID env var (e.g. from craft whoami --json)");
const APP_SUPPORT = `${process.env.HOME}/Library/Containers/com.lukilabs.lukiapp/Data/Library/Application Support/com.lukilabs.lukiapp`;
const SQLITE_PATH = `${APP_SUPPORT}/Search/SearchIndex_${SPACE_ID}.sqlite`;
const PTS_DIR = `${APP_SUPPORT}/PlainTextSearch/${SPACE_ID}`;
const ITERATIONS = 5;

// ---- helpers ----

interface TimingResult {
  avg: number;
  min: number;
  max: number;
  times: number[];
}

async function measure(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function benchmark(name: string, fn: () => Promise<void>): Promise<TimingResult> {
  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    times.push(await measure(fn));
  }
  return {
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    min: Math.min(...times),
    max: Math.max(...times),
    times,
  };
}

async function craftCmd(args: string): Promise<string> {
  const proc = Bun.spawn([CRAFT, ...args.split(" ")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

function fmt(ms: number): string {
  return ms.toFixed(1) + "ms";
}

// ---- setup ----

const db = new Database(SQLITE_PATH, { readonly: true });

// get all PTS JSON files
const ptsFiles = (await readdir(PTS_DIR)).filter((f) => f.endsWith(".json") && f.startsWith("document_"));

// build API-ID -> SQLite-documentId mapping (for PTS lookups)
type SqliteDocRow = { id: string; documentId: string; content: string };
const sqliteDocRows = db
  .query("SELECT id, documentId, content FROM BlockSearch WHERE entityType = 'document'")
  .all() as SqliteDocRow[];
const apiIdToInternalId = new Map<string, string>();
const internalIdToApiId = new Map<string, string>();
for (const row of sqliteDocRows) {
  apiIdToInternalId.set(row.id, row.documentId);
  internalIdToApiId.set(row.documentId, row.id);
}

async function loadPtsDocByApiId(apiId: string): Promise<any | null> {
  const internalId = apiIdToInternalId.get(apiId);
  if (!internalId) return null;
  return loadPtsDocByInternalId(internalId);
}

async function loadPtsDocByInternalId(internalId: string): Promise<any | null> {
  const fpath = join(PTS_DIR, `document_${internalId}.json`);
  try {
    return await Bun.file(fpath).json();
  } catch {
    return null;
  }
}

// pick a known doc ID from API
const lsOutput = await craftCmd("docs ls --json");
const allApiDocs: { id: string; title: string }[] = JSON.parse(lsOutput).items;
const sampleDocId = allApiDocs[0].id;
const sampleDocTitle = allApiDocs[0].title;

console.log(`=== Performance Comparison ===`);
console.log(`Iterations per test: ${ITERATIONS}`);
console.log(`Sample doc: "${sampleDocTitle}" (${sampleDocId})`);
console.log(`  -> internal ID: ${apiIdToInternalId.get(sampleDocId) ?? "NOT FOUND"}`);
console.log(`API docs count: ${allApiDocs.length}`);
console.log(`PTS JSON files: ${ptsFiles.length}`);
console.log(`SQLite doc rows: ${sqliteDocRows.length}`);
console.log("");

// ---- find terms ----

const commonTerm = "typescript";
const rareTerm = "SYNC_TEST";

// ---- experiment 2: performance ----

interface TestResult {
  operation: string;
  api: TimingResult;
  sqlite?: TimingResult;
  json?: TimingResult;
}

const results: TestResult[] = [];

// --- test 1: search common term ---
// note: SQLite FTS search across ALL entity types (block+document+page),
// then deduplicate by documentId to get unique documents
console.log("Test 1: Search common term (" + commonTerm + ")");

let apiResultCount = 0;
const apiSearch = await benchmark("API search common", async () => {
  const out = await craftCmd(`docs search ${commonTerm} --json`);
  apiResultCount = JSON.parse(out).items?.length ?? 0;
});

let sqliteResultCount = 0;
const sqliteSearch = await benchmark("SQLite search common", async () => {
  const rows = db
    .query("SELECT DISTINCT documentId FROM BlockSearch WHERE BlockSearch MATCH ?")
    .all(commonTerm) as { documentId: string }[];
  sqliteResultCount = rows.length;
});

let jsonResultCount = 0;
const jsonSearch = await benchmark("JSON search common", async () => {
  let count = 0;
  for (const f of ptsFiles) {
    const data = await Bun.file(join(PTS_DIR, f)).json();
    if (data.markdownContent?.toLowerCase().includes(commonTerm)) {
      count++;
    }
  }
  jsonResultCount = count;
});

results.push({ operation: `Search "${commonTerm}"`, api: apiSearch, sqlite: sqliteSearch, json: jsonSearch });
console.log(`  API: ${fmt(apiSearch.avg)} avg (${apiResultCount} results)`);
console.log(`  SQLite: ${fmt(sqliteSearch.avg)} avg (${sqliteResultCount} unique docs)`);
console.log(`  JSON: ${fmt(jsonSearch.avg)} avg (${jsonResultCount} results)`);
console.log("");

// --- test 2: search rare term ---
console.log("Test 2: Search rare term (" + rareTerm + ")");

let apiRareCount = 0;
const apiSearchRare = await benchmark("API search rare", async () => {
  const out = await craftCmd(`docs search ${rareTerm} --json`);
  apiRareCount = JSON.parse(out).items?.length ?? 0;
});

let sqliteRareCount = 0;
const sqliteSearchRare = await benchmark("SQLite search rare", async () => {
  const rows = db
    .query("SELECT DISTINCT documentId FROM BlockSearch WHERE BlockSearch MATCH ?")
    .all(rareTerm) as { documentId: string }[];
  sqliteRareCount = rows.length;
});

let jsonRareCount = 0;
const jsonSearchRare = await benchmark("JSON search rare", async () => {
  let count = 0;
  for (const f of ptsFiles) {
    const data = await Bun.file(join(PTS_DIR, f)).json();
    if (data.markdownContent?.includes(rareTerm)) {
      count++;
    }
  }
  jsonRareCount = count;
});

results.push({ operation: `Search "${rareTerm}"`, api: apiSearchRare, sqlite: sqliteSearchRare, json: jsonSearchRare });
console.log(`  API: ${fmt(apiSearchRare.avg)} avg (${apiRareCount} results)`);
console.log(`  SQLite: ${fmt(sqliteSearchRare.avg)} avg (${sqliteRareCount} unique docs)`);
console.log(`  JSON: ${fmt(jsonSearchRare.avg)} avg (${jsonRareCount} results)`);
console.log("");

// --- test 3: get document by ID ---
console.log("Test 3: Get document by ID (" + sampleDocId + ")");

const apiGet = await benchmark("API get doc", async () => {
  await craftCmd(`docs get ${sampleDocId}`);
});

const jsonGet = await benchmark("JSON get doc", async () => {
  await loadPtsDocByApiId(sampleDocId);
});

results.push({ operation: "Get doc by ID", api: apiGet, json: jsonGet });
console.log(`  API: ${fmt(apiGet.avg)} avg`);
console.log(`  JSON: ${fmt(jsonGet.avg)} avg`);
console.log("");

// --- test 4: list all documents ---
console.log("Test 4: List all documents");

let apiListCount = 0;
const apiList = await benchmark("API list", async () => {
  const out = await craftCmd("docs ls --json");
  apiListCount = JSON.parse(out).items.length;
});

let sqliteListCount = 0;
const sqliteList = await benchmark("SQLite list", async () => {
  const rows = db.query("SELECT id, content, documentId FROM BlockSearch WHERE entityType = 'document'").all();
  sqliteListCount = rows.length;
});

let jsonListCount = 0;
const jsonList = await benchmark("JSON list", async () => {
  let count = 0;
  for (const f of ptsFiles) {
    const data = await Bun.file(join(PTS_DIR, f)).json();
    count++;
  }
  jsonListCount = count;
});

results.push({ operation: "List all docs", api: apiList, sqlite: sqliteList, json: jsonList });
console.log(`  API: ${fmt(apiList.avg)} avg (${apiListCount} docs)`);
console.log(`  SQLite: ${fmt(sqliteList.avg)} avg (${sqliteListCount} docs)`);
console.log(`  JSON: ${fmt(jsonList.avg)} avg (${jsonListCount} docs)`);
console.log("");

// --- test 5: check document changed (content hash) ---
console.log("Test 5: Check if document changed");

const apiHash = await benchmark("API check change", async () => {
  await craftCmd(`docs get ${sampleDocId}`);
});

let ptsHash = "";
const jsonHash = await benchmark("JSON check change", async () => {
  const data = await loadPtsDocByApiId(sampleDocId);
  ptsHash = data?.contentHash ?? "";
});

results.push({ operation: "Check doc changed", api: apiHash, json: jsonHash });
console.log(`  API (full fetch): ${fmt(apiHash.avg)} avg`);
console.log(`  JSON (contentHash field): ${fmt(jsonHash.avg)} avg`);
console.log(`  PTS contentHash value: ${ptsHash}`);
console.log("");

// ---- experiment 3: data completeness ----

console.log("=== Data Completeness Comparison ===");
console.log("");

// pick 5 random docs that exist in both API and have PTS mapping
const docsWithMapping = allApiDocs.filter((d) => apiIdToInternalId.has(d.id));
const sampleDocs = docsWithMapping.sort(() => Math.random() - 0.5).slice(0, 5);

interface CompletenessResult {
  docId: string;
  internalId: string;
  title: string;
  apiHasContent: boolean;
  ptsHasContent: boolean;
  sqliteHasEntry: boolean;
  markdownSimilarity: string;
  apiLen: number;
  ptsLen: number;
  notes: string;
}

const completenessResults: CompletenessResult[] = [];

for (const doc of sampleDocs) {
  const internalId = apiIdToInternalId.get(doc.id) ?? "?";
  console.log(`Checking: "${doc.title}" (API: ${doc.id}, internal: ${internalId})`);

  // API content
  let apiContent = "";
  let apiHasContent = false;
  try {
    apiContent = await craftCmd(`docs get ${doc.id}`);
    apiHasContent = apiContent.trim().length > 0;
  } catch {
    apiHasContent = false;
  }

  // PTS content
  const ptsData = await loadPtsDocByApiId(doc.id);
  const ptsHasContent = !!(ptsData?.markdownContent?.trim().length > 0);
  const ptsMarkdown = ptsData?.markdownContent ?? "";

  // SQLite entry
  const sqliteRow = db
    .query("SELECT id, content FROM BlockSearch WHERE id = ? AND entityType = 'document'")
    .get(doc.id) as { id: string; content: string } | null;
  const sqliteHasEntry = sqliteRow !== null;

  // compare markdown content
  let markdownSimilarity = "n/a";
  const apiLen = apiContent.trim().length;
  const ptsLen = ptsMarkdown.trim().length;
  if (apiHasContent && ptsHasContent) {
    const apiNorm = apiContent.trim().replace(/\s+/g, " ");
    const ptsNorm = ptsMarkdown.trim().replace(/\s+/g, " ");
    if (apiNorm === ptsNorm) {
      markdownSimilarity = "exact";
    } else {
      const lenRatio = Math.min(apiNorm.length, ptsNorm.length) / Math.max(apiNorm.length, ptsNorm.length);
      markdownSimilarity = `${(lenRatio * 100).toFixed(0)}% length ratio`;
      // check if one is a subset of the other
      if (apiNorm.includes(ptsNorm.slice(0, 100)) || ptsNorm.includes(apiNorm.slice(0, 100))) {
        markdownSimilarity += " (shared prefix)";
      }
    }
  }

  const notes: string[] = [];
  if (!ptsHasContent) notes.push("missing from PTS");
  if (!sqliteHasEntry) notes.push("missing from SQLite");

  completenessResults.push({
    docId: doc.id,
    internalId,
    title: doc.title,
    apiHasContent,
    ptsHasContent,
    sqliteHasEntry,
    markdownSimilarity,
    apiLen,
    ptsLen,
    notes: notes.join("; ") || "ok",
  });

  console.log(`  API: ${apiHasContent ? `yes (${apiLen} chars)` : "no"}`);
  console.log(`  PTS: ${ptsHasContent ? `yes (${ptsLen} chars)` : "no"}`);
  console.log(`  SQLite: ${sqliteHasEntry ? "yes" : "no"}`);
  console.log(`  Markdown similarity: ${markdownSimilarity}`);
}

// search completeness with proper ID mapping
console.log("");
console.log("Search completeness: comparing results for 'typescript'");

const apiSearchDocs = JSON.parse(await craftCmd("docs search typescript --json")).items as { id: string; title: string }[];

// SQLite: get distinct documentId (internal), then map to API id
const sqliteSearchDocs = db
  .query("SELECT DISTINCT documentId FROM BlockSearch WHERE BlockSearch MATCH 'typescript'")
  .all() as { documentId: string }[];
const sqliteSearchApiIds = sqliteSearchDocs
  .map((r) => internalIdToApiId.get(r.documentId))
  .filter(Boolean) as string[];

// PTS: documentId in file is the internal ID
const ptsSearchApiIds: string[] = [];
for (const f of ptsFiles) {
  const data = await Bun.file(join(PTS_DIR, f)).json();
  if (data.markdownContent?.toLowerCase().includes("typescript")) {
    const apiId = internalIdToApiId.get(data.documentId);
    if (apiId) ptsSearchApiIds.push(apiId);
    else ptsSearchApiIds.push(`[unmapped:${data.documentId}]`);
  }
}

const apiSearchIds = new Set(apiSearchDocs.map((r) => r.id));
const sqliteSearchIdSet = new Set(sqliteSearchApiIds);
const ptsSearchIdSet = new Set(ptsSearchApiIds);

console.log(`  API found: ${apiSearchIds.size} docs`);
console.log(`  SQLite found: ${sqliteSearchIdSet.size} unique docs (mapped to API ids)`);
console.log(`  PTS grep found: ${ptsSearchIdSet.size} docs (mapped to API ids)`);

const apiNotInSqliteSearch = [...apiSearchIds].filter((id) => !sqliteSearchIdSet.has(id));
const apiNotInPtsSearch = [...apiSearchIds].filter((id) => !ptsSearchIdSet.has(id));
const sqliteNotInApiSearch = [...sqliteSearchIdSet].filter((id) => !apiSearchIds.has(id));
const ptsNotInApiSearch = [...ptsSearchIdSet].filter((id) => !apiSearchIds.has(id));

console.log(`  In API but not SQLite: ${apiNotInSqliteSearch.length} [${apiNotInSqliteSearch.join(", ")}]`);
console.log(`  In API but not PTS: ${apiNotInPtsSearch.length}`);
console.log(`  In SQLite but not API: ${sqliteNotInApiSearch.length}`);
console.log(`  In PTS but not API: ${ptsNotInApiSearch.length}`);

// show what API found vs what locals found
if (apiSearchDocs.length > 0) {
  console.log(`  API search returned: ${apiSearchDocs.map((d) => `"${d.title}"`).join(", ")}`);
}

// overall coverage with proper mapping
console.log("");
console.log("Overall document coverage:");
const allApiIdSet = new Set(allApiDocs.map((d) => d.id));
const allPtsInternalIds = new Set(ptsFiles.map((f) => f.replace("document_", "").replace(".json", "")));
const allPtsMappedApiIds = new Set(
  [...allPtsInternalIds].map((iid) => internalIdToApiId.get(iid)).filter(Boolean) as string[]
);
const allSqliteApiIds = new Set(sqliteDocRows.map((r) => r.id));

const apiNotInPts = [...allApiIdSet].filter((id) => !allPtsMappedApiIds.has(id));
const apiNotInSqlite = [...allApiIdSet].filter((id) => !allSqliteApiIds.has(id));
const ptsNotInApi = [...allPtsMappedApiIds].filter((id) => !allApiIdSet.has(id));
const sqliteNotInApi = [...allSqliteApiIds].filter((id) => !allApiIdSet.has(id));
const ptsUnmapped = [...allPtsInternalIds].filter((iid) => !internalIdToApiId.has(iid));

console.log(`  API total: ${allApiIdSet.size}`);
console.log(`  PTS total files: ${allPtsInternalIds.size}, mapped to API: ${allPtsMappedApiIds.size}, unmapped: ${ptsUnmapped.length}`);
console.log(`  SQLite total: ${allSqliteApiIds.size}`);
console.log(`  In API but not PTS: ${apiNotInPts.length}`);
console.log(`  In API but not SQLite: ${apiNotInSqlite.length}`);
console.log(`  In PTS but not API: ${ptsNotInApi.length}`);
console.log(`  In SQLite but not API: ${sqliteNotInApi.length}`);

// ---- FTS tokenization note ----
console.log("");
console.log("=== FTS Tokenization Notes ===");
console.log("FTS5 uses unicode61 tokenizer - strips underscores, lowercases, splits on punctuation");
console.log("Query 'SYNC_TEST' becomes tokens 'sync' + 'test' (implicit AND)");
const ftsTestResult = db
  .query("SELECT COUNT(*) as c FROM BlockSearch WHERE BlockSearch MATCH 'sync test'")
  .get() as { c: number };
console.log(`FTS match 'sync test': ${ftsTestResult.c} rows`);
const ftsTestResult2 = db
  .query("SELECT COUNT(*) as c FROM BlockSearch WHERE BlockSearch MATCH 'typescript'")
  .get() as { c: number };
console.log(`FTS match 'typescript': ${ftsTestResult2.c} rows (across all entity types)`);

// ---- output summary table ----

console.log("");
console.log("=== Summary Performance Table ===");
console.log("| Operation | API (avg) | SQLite (avg) | JSON (avg) | Speedup (fastest local vs API) |");
console.log("|---|---|---|---|---|");
for (const r of results) {
  const sqliteAvg = r.sqlite ? fmt(r.sqlite.avg) : "-";
  const jsonAvg = r.json ? fmt(r.json.avg) : "-";
  const localMin = Math.min(r.sqlite?.avg ?? Infinity, r.json?.avg ?? Infinity);
  const speedup = localMin < Infinity ? (r.api.avg / localMin).toFixed(1) + "x" : "-";
  console.log(`| ${r.operation} | ${fmt(r.api.avg)} | ${sqliteAvg} | ${jsonAvg} | ${speedup} |`);
}

// write raw JSON for processing
const output = {
  timestamp: new Date().toISOString(),
  iterations: ITERATIONS,
  sampleDoc: { id: sampleDocId, title: sampleDocTitle },
  idMapping: {
    note: "API id = SQLite 'id' column. SQLite 'documentId' = PTS 'documentId' = PTS filename. These are different ID spaces.",
    totalMappings: apiIdToInternalId.size,
  },
  counts: {
    apiDocs: allApiDocs.length,
    ptsFiles: ptsFiles.length,
    ptsMappedToApi: allPtsMappedApiIds.size,
    ptsUnmapped: ptsUnmapped.length,
    sqliteDocs: allSqliteApiIds.size,
  },
  performance: results.map((r) => ({
    operation: r.operation,
    api: r.api,
    sqlite: r.sqlite,
    json: r.json,
  })),
  completeness: completenessResults,
  searchCompleteness: {
    term: "typescript",
    apiCount: apiSearchIds.size,
    sqliteCount: sqliteSearchIdSet.size,
    ptsCount: ptsSearchIdSet.size,
    apiNotInSqlite: apiNotInSqliteSearch.length,
    apiNotInPts: apiNotInPtsSearch.length,
    sqliteNotInApi: sqliteNotInApiSearch.length,
    ptsNotInApi: ptsNotInApiSearch.length,
  },
  overallCoverage: {
    apiNotInPts: apiNotInPts.length,
    apiNotInSqlite: apiNotInSqlite.length,
    ptsNotInApi: ptsNotInApi.length,
    sqliteNotInApi: sqliteNotInApi.length,
  },
};

await Bun.write(
  "/Users/pavel/dev/tools/craft-cli/tests/experiments/perf-results.json",
  JSON.stringify(output, null, 2)
);
console.log("");
console.log("Raw results written to tests/experiments/perf-results.json");

db.close();
