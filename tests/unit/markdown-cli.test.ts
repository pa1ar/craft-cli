import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = [process.execPath, join(import.meta.dir, "../../src/cli/main.ts")];
const DOC = "11111111-1111-4111-8111-111111111111";
let root: string;
let testHome: string;
let cache: string;
let requests: string[];
let remoteMarkdown: string;
let server: ReturnType<typeof Bun.serve>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "craft-markdown-cli-"));
  testHome = join(root, "home");
  cache = join(root, "desktop");
  requests = [];
  remoteMarkdown = "<page><pageTitle>Remote</pageTitle><content>alpha\nbeta\ngamma</content></page>";
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      requests.push(`${req.method} ${url.pathname}`);
      if (req.headers.get("accept") === "text/markdown") {
        return new Response(remoteMarkdown, {
          headers: { "content-type": "text/markdown" },
        });
      }
      return Response.json({ id: DOC, type: "page", title: "Remote", content: [] });
    },
  });
  mkdirSync(join(testHome, ".config/craft-cli"), { recursive: true });
  writeFileSync(join(testHome, ".config/craft-cli/config.json"), JSON.stringify({
    default: "test",
    profiles: { test: { url: `http://127.0.0.1:${server.port}/api/v1`, key: "fixture", spaceId: "test-space" } },
  }));
});

afterEach(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

function seedLocal(markdown = "# \n\nfirst  \nsecond\n\n```text\na\n\n\nb\n```\n") {
  const searchDir = join(cache, "Search");
  const ptsDir = join(cache, "PlainTextSearch/test-space");
  mkdirSync(searchDir, { recursive: true });
  mkdirSync(ptsDir, { recursive: true });
  const db = new Database(join(searchDir, "SearchIndex_test-space.sqlite"));
  db.run(`CREATE VIRTUAL TABLE BlockSearch USING fts5(
    id, content, type, entityType, customRank, isTodo, isTodoChecked,
    documentId, stamp UNINDEXED, exactMatchContent, tokenize='unicode61')`);
  db.run("INSERT INTO BlockSearch VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [DOC, "Local", "page", "document", "100", "0", "0", "internal-doc", "stamp", "local"]);
  db.run("INSERT INTO BlockSearch VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["table", "Collection", "collection", "block", "100", "0", "0", "internal-doc", "stamp", "collection"]);
  db.close();
  writeFileSync(join(ptsDir, "internal-doc"), JSON.stringify({
    documentId: "internal-doc", title: "local", markdownContent: markdown,
    contentHash: "fixture-hash", modified: 800000000, isDailyNote: false,
  }));
}

async function run(args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: testHome, CRAFT_LOCAL_PATH: cache };
  for (const key of ["CRAFT_URL", "CRAFT_KEY", "CRAFT_PROFILE", "CRAFT_SOURCE", "CRAFT_MODE", "CRAFT_LOCAL_STALE_WINDOW_MS", "CRAFT_FRESHNESS_DB_PATH"]) {
    delete env[key];
  }
  const child = Bun.spawn({ cmd: [...CLI, ...args], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  return { stdout, stderr, code };
}

describe("Markdown command contract", () => {
  test("cat batches cached hits, preserves duplicates, and falls back only for misses", async () => {
    seedLocal("cached-only-body");
    const missing = "22222222-2222-4222-8222-222222222222";
    const result = await run(["cat", DOC, missing, DOC, "--source", "auto"]);
    expect(result.code).toBe(0);
    expect(result.stdout.split("cached-only-body")).toHaveLength(3);
    expect(result.stdout.indexOf("cached-only-body")).toBeLessThan(result.stdout.indexOf("Remote"));
    expect(result.stdout.lastIndexOf("cached-only-body")).toBeGreaterThan(result.stdout.indexOf("Remote"));
    expect(requests).toEqual(["GET /api/v1/blocks"]);
    requests.length = 0;
    const strict = await run(["cat", DOC, missing, "--source", "local"]);
    expect(strict.code).not.toBe(0);
    expect(requests).toEqual([]);
  });

  test("read uses Desktop Markdown without requests and preserves meaningful whitespace", async () => {
    seedLocal();
    const result = await run(["read", DOC, "--source", "local"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("first  \nsecond");
    expect(result.stdout).toContain("a\n\n\nb");
    expect(requests).toEqual([]);
  });

  test("auto falls back without Desktop and shaped output matches explicit API", async () => {
    const auto = await run(["read", DOC, "--source", "auto", "--head", "2"]);
    const api = await run(["read", DOC, "--source", "api", "--head", "2"]);
    expect(auto.code).toBe(0);
    expect(api.code).toBe(0);
    expect(auto.stdout).toBe(api.stdout);
    expect(auto.stdout).toContain("Remote");
    expect(auto.stdout).not.toContain("gamma");
    expect(requests).toEqual(["GET /api/v1/blocks", "GET /api/v1/blocks"]);
  });

  test("explicit API bypasses an available Desktop document", async () => {
    seedLocal();
    const result = await run(["read", DOC, "--source", "api"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Remote");
    expect(result.stdout).not.toContain("Local");
    expect(requests).toEqual(["GET /api/v1/blocks"]);
  });

  test("explicit source takes precedence over the api shortcut", async () => {
    seedLocal();
    const result = await run(["read", DOC, "--source", "local", "--api"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("(local)");
    expect(requests).toEqual([]);
  });

  test("strict local rejects unsupported reads before making requests", async () => {
    seedLocal();
    for (const option of ["--json", "--raw", "--links", "--exhaustive"]) {
      const result = await run(["read", DOC, "--source", "local", option]);
      expect(result.code).not.toBe(0);
      expect(result.stdout).toBe("");
    }
    expect(requests).toEqual([]);
  });

  test("invalid daily date fails before local or remote retrieval", async () => {
    const result = await run(["docs", "daily", "2026-02-30", "--source", "api"]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(requests).toEqual([]);
  });

  test("Desktop cache remains the source after writes; explicit API confirms remote state", async () => {
    seedLocal("# \n\nold\n");
    remoteMarkdown = "<page>\n  <pageTitle>Local</pageTitle>\n  <content>\n    updated\n  </content>\n</page>";
    const payload = join(root, "update.json");
    writeFileSync(payload, JSON.stringify({ itemsToUpdate: [{ id: "item", title: "updated" }] }));
    expect((await run(["raw", "PUT", "/collections/table/items", "--body", payload])).code).toBe(0);
    const offline = await run(["read", DOC, "--source", "local"]);
    expect(offline.code).toBe(0);
    expect(offline.stdout).toContain("old");
    expect(offline.stderr).toContain("(local)");
    const fresh = await run(["read", DOC, "--source", "api"]);
    expect(fresh.code).toBe(0);
    expect(fresh.stdout).toContain("updated");
    expect(fresh.stderr).toContain("(api)");
    const beforeSync = await run(["read", DOC]);
    expect(beforeSync.stdout).toContain("old");
    expect(beforeSync.stderr).toContain("(local)");
    writeFileSync(join(cache, "PlainTextSearch/test-space/internal-doc"), JSON.stringify({
      documentId: "internal-doc", title: "local", markdownContent: "# \n\nupdated\n",
      contentHash: "synced", modified: 800000001, isDailyNote: false,
    }));
    const verified = await run(["read", DOC]);
    expect(verified.code).toBe(0);
    expect(verified.stderr).toContain("(local)");
    expect(verified.stdout).toContain("updated");
    const local = await run(["read", DOC, "--source", "local"]);
    expect(local.code).toBe(0);
    expect(local.stdout).toContain("updated");
    expect(local.stderr).toContain("(local)");
    expect(requests).toEqual(["PUT /api/v1/collections/table/items", "GET /api/v1/blocks"]);
  });

  test("JSON shaping fails before network and cat has one total budget", async () => {
    const invalid = await run(["cat", DOC, "--source", "api", "--json", "--head", "1"]);
    expect(invalid.code).not.toBe(0);
    expect(requests).toEqual([]);
    const bounded = await run(["cat", DOC, DOC, "--source", "api", "--budget", "25"]);
    expect(bounded.code).toBe(0);
    expect([...bounded.stdout]).toHaveLength(25);
    expect(bounded.stdout.endsWith("[truncated]")).toBe(true);
  });
});
