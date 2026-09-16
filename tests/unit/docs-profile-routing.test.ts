import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectSpaceIndexFile } from "../../src/lib/local-db.ts";

const CLI = [process.execPath, join(import.meta.dir, "..", "..", "src/cli/main.ts")];

let root: string;
let home: string;
let localBase: string;

function createSpaceDb(spaceId: string, documentId: string, title: string) {
  const searchDir = join(localBase, "Search");
  mkdirSync(searchDir, { recursive: true });
  const db = new Database(join(searchDir, `SearchIndex_${spaceId}.sqlite`));
  db.run(`
    CREATE VIRTUAL TABLE BlockSearch USING fts5(
      id, content, type, entityType, customRank,
      isTodo, isTodoChecked, documentId, stamp UNINDEXED,
      exactMatchContent, tokenize='unicode61'
    )
  `);
  db.run(
    "INSERT INTO BlockSearch VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [documentId, title, "page", "document", "100", "0", "0", `internal-${spaceId}`, "stamp", title.toLowerCase()],
  );
  db.close();
}

function writeConfig(url = "http://127.0.0.1:1/api/v1") {
  const configDir = join(home, ".config", "craft-cli");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({
    default: "1ar",
    source: "auto",
    profiles: {
      "1ar": { url, key: "key-1ar", spaceId: "space-1ar", spaceName: "1ar" },
      ltm: { url, key: "key-ltm", spaceId: "space-ltm", spaceName: "LTM" },
    },
  }));
}

async function run(args: string[]) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    CRAFT_LOCAL_PATH: localBase,
  };
  delete env.CRAFT_URL;
  delete env.CRAFT_KEY;
  delete env.CRAFT_PROFILE;
  delete env.CRAFT_SOURCE;
  delete env.CRAFT_MODE;
  const proc = Bun.spawn({ cmd: [...CLI, ...args], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "craft-doc-routing-"));
  home = join(root, "home");
  localBase = join(root, "local");
  mkdirSync(home, { recursive: true });
  createSpaceDb("space-1ar", "11111111-1111-4111-8111-111111111111", "one ar document");
  createSpaceDb("space-ltm", "22222222-2222-4222-8222-222222222222", "ltm document");
  writeConfig();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("profile-scoped document reads", () => {
  test("local index selection prefers an exact space over composite indexes", () => {
    const files = [
      "SearchIndex_space-1ar||other-space.sqlite",
      "SearchIndex_space-1ar.sqlite",
      "SearchIndex_space-1ar||space-ltm.sqlite",
    ];
    expect(selectSpaceIndexFile(files, "space-1ar")).toBe("SearchIndex_space-1ar.sqlite");
    expect(selectSpaceIndexFile(files, "space-ltm")).toBe("SearchIndex_space-1ar||space-ltm.sqlite");
  });

  test("docs ls selects the local store for the requested profile", async () => {
    const result = await run(["docs", "ls", "--profile", "ltm", "--source", "local", "--json"]);
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.items.map((item: { title: string }) => item.title)).toEqual(["ltm document"]);
  });

  test("docs search selects the local store for the requested profile", async () => {
    const result = await run(["docs", "search", "ltm", "--profile", "ltm", "--source", "local", "--json"]);
    expect(result.code).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.items).toHaveLength(1);
    expect(output.items[0].documentId).toBe("22222222-2222-4222-8222-222222222222");
  });

  test("explicit api source bypasses local document reads", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url.pathname);
        if (url.pathname === "/api/v1/documents/search") {
          return Response.json({ items: [{ documentId: "api-document", markdown: "API match" }] });
        }
        return Response.json({ items: [{ id: "api-document", title: "API document" }] });
      },
    });
    try {
      writeConfig(`http://127.0.0.1:${server.port}/api/v1`);
      const listed = await run(["docs", "ls", "--profile", "ltm", "--source", "api", "--json"]);
      const searched = await run(["docs", "search", "API", "--profile", "ltm", "--source", "api", "--json"]);
      expect(listed.code).toBe(0);
      expect(searched.code).toBe(0);
      expect(requests).toEqual(["/api/v1/documents", "/api/v1/documents/search"]);
      expect(JSON.parse(listed.stdout).items[0].title).toBe("API document");
      expect(JSON.parse(searched.stdout).items[0].markdown).toBe("API match");
    } finally {
      server.stop(true);
    }
  });
});
