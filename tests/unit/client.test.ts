// mock-fetch unit tests for CraftClient: retry, error normalization, query building
import { test, expect, describe, beforeEach } from "bun:test";
import { CraftClient, parallel, retryDelayMs, walkBlocks, findBlocks } from "../../src/lib/client.ts";
import { CraftError } from "../../src/lib/errors.ts";

function mockFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  const fn = async (input: any, init: any) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    return await handler(url, init ?? {});
  };
  // typeof fetch requires a `preconnect` method; mock as no-op
  (fn as any).preconnect = () => {};
  return fn as unknown as typeof fetch;
}

describe("CraftClient.request", () => {
  test("builds query string", async () => {
    let seen: URL | null = null;
    const client = new CraftClient({
      url: "https://example/api/v1",
      key: "test",
      fetch: mockFetch((url) => {
        seen = url;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      }),
    });
    await client.request("GET", "/blocks", { query: { id: "abc", maxDepth: 2, fetchMetadata: true } });
    expect(seen!.searchParams.get("id")).toBe("abc");
    expect(seen!.searchParams.get("maxDepth")).toBe("2");
    expect(seen!.searchParams.get("fetchMetadata")).toBe("true");
  });

  test("retries on 429 then succeeds", async () => {
    let calls = 0;
    const client = new CraftClient({
      url: "https://example/api/v1",
      key: "test",
      backoffBaseMs: 1,
      fetch: mockFetch(() => {
        calls++;
        if (calls < 3) return new Response("{}", { status: 429 });
        return new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    });
    const res = await client.request("GET", "/x");
    expect(calls).toBe(3);
    expect(res).toEqual({ ok: true });
  });

  test("throws CraftError with AUTH kind on 401", async () => {
    const client = new CraftClient({
      url: "https://example/api/v1",
      key: "test",
      fetch: mockFetch(
        () =>
          new Response(
            JSON.stringify({ error: "Invalid Authorization header", code: "INVALID_AUTH_HEADER" }),
            { status: 401, headers: { "content-type": "application/json" } }
          )
      ),
    });
    try {
      await client.request("GET", "/connection");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CraftError);
      expect((e as CraftError).kind).toBe("AUTH");
    }
  });

  test("handles markdown accept", async () => {
    const client = new CraftClient({
      url: "https://example/api/v1",
      key: "test",
      fetch: mockFetch(
        () =>
          new Response("<page>content</page>", {
            status: 200,
            headers: { "content-type": "text/markdown" },
          })
      ),
    });
    const res = await client.request<string>("GET", "/blocks", { accept: "text/markdown" });
    expect(res).toBe("<page>content</page>");
  });

  test("collection view helpers use documented endpoints and payloads", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const client = new CraftClient({
      url: "https://example/api/v1",
      key: "test",
      fetch: mockFetch(async (url, init) => {
        calls.push({
          method: init.method ?? "GET",
          path: url.pathname.replace("/api/v1", ""),
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        });
        return new Response(JSON.stringify({ id: "view1", views: [] }), {
          headers: { "content-type": "application/json" },
        });
      }),
    });

    await client.collections.listViews("col1");
    await client.collections.createView("col1", { name: "Board", type: "kanban" });
    await client.collections.updateView("col1", "view1", { name: "Board 2" });
    await client.collections.setActiveView("col1", "view1");
    await client.collections.deleteView("col1", "view1");

    expect(calls).toEqual([
      { method: "GET", path: "/collections/col1/views" },
      { method: "POST", path: "/collections/col1/views", body: { view: { name: "Board", type: "kanban" } } },
      { method: "PUT", path: "/collections/col1/views/view1", body: { view: { name: "Board 2" } } },
      { method: "PUT", path: "/collections/col1/active-view", body: { viewId: "view1" } },
      { method: "DELETE", path: "/collections/col1/views/view1" },
    ]);
  });

  test("reports request timeout clearly", async () => {
    const client = new CraftClient({
      url: "https://example/api/v1",
      key: "test",
      timeoutMs: 5,
      retries: 0,
      fetch: mockFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })),
    });

    await expect(client.request("GET", "/connection")).rejects.toThrow(
      "request timed out after 5ms: GET /connection"
    );
  });
});

describe("helpers", () => {
  test("retry delay uses exponential backoff with jitter", () => {
    expect(retryDelayMs(500, 0, () => 0)).toBe(250);
    expect(retryDelayMs(500, 2, () => 0.5)).toBe(2000);
    expect(retryDelayMs(500, 2, () => 1)).toBe(3000);
  });

  test("parallel limits concurrency", async () => {
    let active = 0;
    let max = 0;
    const results = await parallel(
      Array.from({ length: 20 }, (_, i) => i),
      async (x) => {
        active++;
        if (active > max) max = active;
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return x * 2;
      },
      3
    );
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
    expect(max).toBeLessThanOrEqual(3);
  });

  test("walkBlocks visits every block", () => {
    const tree = {
      id: "1",
      content: [
        { id: "2", content: [{ id: "3" }] },
        { id: "4" },
      ],
    };
    const ids: string[] = [];
    walkBlocks(tree, (b) => ids.push(b.id));
    expect(ids).toEqual(["1", "2", "3", "4"]);
  });

  test("findBlocks filters", () => {
    const tree = {
      id: "1",
      markdown: "top",
      content: [
        { id: "2", markdown: "#tag here" },
        { id: "3", markdown: "plain" },
        { id: "4", content: [{ id: "5", markdown: "#tag deep" }] },
      ],
    };
    const hits = findBlocks(tree as any, (b: any) => typeof b.markdown === "string" && b.markdown.includes("#tag"));
    expect(hits.map((h: any) => h.id).sort()).toEqual(["2", "5"]);
  });
});
