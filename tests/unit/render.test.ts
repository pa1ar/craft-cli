import { describe, expect, test } from "bun:test";
import { getAndRender, resolveDailyDate } from "../../src/cli/render.ts";
import type { LocalDocReadOutcome } from "../../src/cli/local-safe.ts";

function localOutcome(doc: LocalDocReadOutcome["doc"] = null): LocalDocReadOutcome {
  return { status: "available", timeoutMs: 10, doc };
}

function fakeClient() {
  const calls: string[] = [];
  const client = {
    blocks: {
      get: async (_id: string, opts: { format: string }) => {
        calls.push(`get:${opts.format}`);
        return opts.format === "markdown" ? "<page>\nbody\n</page>\n" : { id: "doc-1", title: "Doc" };
      },
      getDaily: async (date: string, opts: { format: string }) => {
        calls.push(`daily:${date}:${opts.format}`);
        return opts.format === "markdown" ? "<page>\nbody\n</page>\n" : { id: "daily-1", title: date };
      },
    },
    links: {
      backlinks: async () => {
        calls.push("backlinks");
        return [];
      },
      backlinksExhaustive: async () => {
        calls.push("backlinksExhaustive");
        return [];
      },
    },
  } as any;
  return { client, calls };
}

const cachedDoc = {
  id: "doc-1",
  documentId: "internal-1",
  title: "Doc",
  markdown: "# Doc\n\nbody\n",
  contentHash: "hash",
  modified: 0,
  blockCount: 1,
  isDailyNote: false,
};

describe("getAndRender source routing", () => {
  test("strict local rejects missing spaceId before any API call", async () => {
    const { client, calls } = fakeClient();
    await expect(
      getAndRender(client, { id: "doc-1", format: "markdown", source: "local" }),
    ).rejects.toThrow(/requires a resolved Craft spaceId/);
    expect(calls).toEqual([]);
  });

  test("strict local rejects API-only options", async () => {
    const { client, calls } = fakeClient();
    await expect(
      getAndRender(client, {
        id: "doc-1",
        format: "markdown",
        depth: 1,
        source: "local",
        spaceId: "space-1",
      }),
    ).rejects.toThrow(/cached markdown reads only/);
    expect(calls).toEqual([]);
  });

  test("raw markdown in auto routes to API without local normalization", async () => {
    const { client, calls } = fakeClient();
    let localCalls = 0;
    const result = await getAndRender(client, {
      id: "doc-1",
      format: "markdown",
      raw: true,
      source: "auto",
      spaceId: "space-1",
      localRead: async () => {
        localCalls++;
        return localOutcome(cachedDoc);
      },
    });
    expect(result.servedBy).toBe("api");
    expect(result.payload).toBe("<page>\nbody\n</page>\n");
    expect(localCalls).toBe(0);
    expect(calls).toEqual(["get:markdown"]);
  });

  test("exhaustive implies backlinks", async () => {
    const { client, calls } = fakeClient();
    const result = await getAndRender(client, {
      id: "doc-1",
      format: "markdown",
      exhaustive: true,
      source: "auto",
      spaceId: "space-1",
      localRead: async () => localOutcome(cachedDoc),
    });
    expect(result.backlinks).toEqual([]);
    expect(calls).toEqual(["backlinksExhaustive"]);
  });

  test("canonicalizes daily dates for both local and API paths", async () => {
    const { client, calls } = fakeClient();
    const result = await getAndRender(client, {
      date: "2026.09.03",
      format: "markdown",
      source: "api",
    });
    expect(result.servedBy).toBe("api");
    expect(calls).toEqual(["daily:2026-09-03:markdown"]);
  });

  test("rejects overflow and malformed daily dates", () => {
    expect(() => resolveDailyDate("2026-02-30")).toThrow(/out of range/);
    expect(() => resolveDailyDate("2026-09-3")).toThrow(/expected/);
  });

  test("cached content is the local source without API comparison", async () => {
    const { client, calls } = fakeClient();
    const result = await getAndRender(client, {
      id: "doc-1", format: "markdown", source: "auto", spaceId: "space-1",
      localRead: async () => localOutcome(cachedDoc),
    });
    expect(result.payload).toBe(cachedDoc.markdown);
    expect(result.servedBy).toBe("local");
    expect(calls).toEqual([]);
  });
});
