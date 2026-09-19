import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function fixture() {
  const calls: string[] = [];
  const authorizations: (string | null)[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    const url = new URL(request.url);
    calls.push(url.pathname + url.search);
    authorizations.push(request.headers.get("authorization"));
    if (url.pathname === "/api/v1/collections/library/items") return Response.json({ items: [
      { id: "item-1", title: "Example skill", properties: { kind: "skill", status: "published", name: "example-skill", description: "Use for example tasks.", tags: ["dev"] }, contentPreviewMd: "BODY MUST NOT LEAK" },
      { id: "draft", title: "Draft", properties: { kind: "skill", status: "draft", name: "draft-skill", description: "Draft only" } },
    ] });
    if (url.pathname === "/api/v1/blocks" && url.searchParams.get("id") === "item-1") return Response.json({
      id: "item-1", type: "collectionItem", title: "Example skill", markdown: "Example skill",
      content: [{ id: "body", type: "text", markdown: "Follow the example instructions." }],
    });
    return new Response("unexpected route", { status: 404 });
  } });
  cleanups.push(async () => { server.stop(true); });
  async function run(args: string[]) {
    const process = Bun.spawn({ cmd: [Bun.which("bun")!, join(import.meta.dir, "../../src/cli/main.ts"), "lib", ...args, "--url", `http://127.0.0.1:${server.port}/api/v1`],
      env: { ...globalThis.process.env, CRAFT_KEY: "unrelated-key-must-not-be-sent", CRAFT_SOURCE: "local" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    return { stdout, stderr, code };
  }
  return { calls, authorizations, run };
}

describe("remote library CLI", () => {
  test("lists compact API metadata even with a local source default and keeps credentials isolated", async () => {
    const f = fixture();
    const r = await f.run(["list", "--collection", "library", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).items.map((x: { name: string }) => x.name)).toEqual(["example-skill"]);
    expect(r.stdout).not.toContain("BODY MUST NOT LEAK");
    expect(r.stdout).not.toContain("contentPreviewMd");
    expect(f.calls).toEqual(["/api/v1/collections/library/items?maxDepth=0"]);
    expect(f.authorizations.join()).not.toContain("unrelated-key");
  });

  test("get resolves through catalog and refuses arbitrary IDs before fetching a body", async () => {
    const f = fixture();
    const missing = await f.run(["get", "outside", "--collection", "library"]);
    expect(missing.code).not.toBe(0);
    expect(f.calls.every((path) => path.includes("/collections/"))).toBe(true);
    const found = await f.run(["get", "example-skill", "--collection", "library", "--json"]);
    expect(found.code).toBe(0);
    const result = JSON.parse(found.stdout);
    expect(result.markdown).toContain("Follow the example instructions.");
    expect(result.sha256).toBe(createHash("sha256").update(result.markdown).digest("hex"));
  });

  test("export supports dry run and never overwrites existing skill directories or symlinks", async () => {
    const f = fixture();
    const root = await mkdtemp(join(tmpdir(), "craft-library-export-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const out = join(root, "generated");
    const args = ["export", "example-skill", "--collection", "library", "--out", out, "--json"];
    const dry = await f.run([...args, "--dry-run"]);
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.stdout).dryRun).toBe(true);
    expect(await Bun.file(join(out, "example-skill/SKILL.md")).exists()).toBe(false);
    const exported = await f.run(args);
    expect(exported.code).toBe(0);
    const report = JSON.parse(exported.stdout);
    const body = await readFile(report.path, "utf8");
    expect(report.sha256).toBe(createHash("sha256").update(body).digest("hex"));
    expect((await f.run(args)).code).not.toBe(0);
    expect(await readFile(report.path, "utf8")).toBe(body);
    const aliasOut = join(root, "aliases");
    await mkdir(aliasOut);
    await symlink(join(out, "example-skill"), join(aliasOut, "example-skill"));
    expect((await f.run(["export", "example-skill", "--collection", "library", "--out", aliasOut])).code).not.toBe(0);
    expect(await readFile(report.path, "utf8")).toBe(body);
  });

  test("requires explicit collection and refuses explicit local reads", async () => {
    const f = fixture();
    expect((await f.run(["list"])).code).not.toBe(0);
    expect((await f.run(["list", "--collection", "library", "--source", "local"])).code).not.toBe(0);
    expect(f.calls).toEqual([]);
  });
});
