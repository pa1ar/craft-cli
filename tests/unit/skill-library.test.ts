import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { getLibrarySkill, listLibrary } from "../../src/lib/skill-library.ts";

function mockClient(rows: any[], body?: any) {
  const calls: any[] = [];
  return {
    calls,
    client: {
      collections: {
        getItems: async (...args: any[]) => {
          calls.push(["items", ...args]);
          return { items: rows };
        },
      },
      blocks: {
        get: async (...args: any[]) => {
          calls.push(["block", ...args]);
          return body;
        },
      },
    } as any,
  };
}

const valid = (overrides: any = {}) => ({
  id: "a",
  title: "Build API",
  properties: {
    kind: "skill",
    name: "build-api",
    description: "Build an API",
    tags: ["engineering"],
    status: "published",
  },
  contentPreviewMd: "secret preview",
  content: [{ type: "text", markdown: "secret body" }],
  ...overrides,
});

describe("skill library", () => {
  test("lists depth-zero compact metadata and filters contamination", async () => {
    const { client, calls } = mockClient([
      valid(),
      { id: "noise", title: "A note", properties: { kind: "note", status: "published" } },
      { id: "draft", title: "Draft", properties: { kind: "skill", name: "draft", description: "x", status: "draft" } },
    ]);
    const result = await listLibrary(client, "col");
    expect(calls).toEqual([["items", "col", 0]]);
    expect(result.items).toEqual([{ id: "a", name: "build-api", title: "Build API", description: "Build an API", tags: ["engineering"], status: "published" }]);
    expect(result.items[0]).not.toHaveProperty("content");
    expect(result.rejected).toEqual([]);
  });

  test("reports invalid eligible skills and removes every duplicate", async () => {
    const { client } = mockClient([
      valid(),
      valid({ id: "b", title: "Build API 2" }),
      valid({ id: "bad", properties: { kind: "skill", name: "Bad Name", description: "x", status: "published" } }),
    ]);
    const result = await listLibrary(client, "col");
    expect(result.items).toEqual([]);
    expect(result.rejected.map((x) => x.id)).toEqual(["bad", "a", "b"]);
    expect(result.rejected.map((x) => x.reason)).toContain("invalid skill name; use lowercase letters, digits, and single hyphens (max 64 characters)");
  });

  test("supports explicit legacy tag/title mode and optional drafts", async () => {
    const { client } = mockClient([
      { id: "legacy", title: "Old Skill", properties: { tags: ["skill"], description: "legacy" } },
      { id: "draft", title: "Draft Skill", properties: { kind: "skill", name: "draft-skill", description: "draft", status: "draft" } },
    ]);
    expect((await listLibrary(client, "col")).items).toEqual([]);
    expect((await listLibrary(client, "col", { legacy: true })).items[0]?.name).toBe("old-skill");
    expect((await listLibrary(client, "col", { legacy: true })).items[0]?.status).toBe("legacy");
    expect((await listLibrary(client, "col", { includeDrafts: true })).items[0]?.name).toBe("draft-skill");
  });

  test("resolves only catalog ids/names and preserves literal/code content", async () => {
    const body = {
      type: "collectionItem",
      content: [
        { type: "text", markdown: "Literal <page> and <content> tags" },
        { type: "code", language: "ts", rawCode: "const x = `literal`;\n```" },
      ],
    };
    const { client, calls } = mockClient([valid()], body);
    const result = await getLibrarySkill(client, "col", "build-api");
    expect(calls[0]).toEqual(["items", "col", 0]);
    expect(calls[1]).toEqual(["block", "a", { maxDepth: -1, format: "json" }]);
    expect(result.markdown).toContain("Literal <page> and <content> tags");
    expect(result.markdown).toContain("const x = `literal`;\n```");
    expect(result.sha256).toBe(createHash("sha256").update(result.markdown).digest("hex"));
    await expect(getLibrarySkill(client, "col", "arbitrary-id")).rejects.toThrow("validated library");
  });

  test("rejects unsupported nested media/pages instead of dropping them", async () => {
    const { client } = mockClient([valid()], { type: "collectionItem", content: [{ type: "image", url: "x" }] });
    await expect(getLibrarySkill(client, "col", "a")).rejects.toThrow("unsupported block type \"image\"");
  });

  test("supports line separators and rejects an empty body", async () => {
    const line = mockClient([valid()], { type: "collectionItem", content: [{ type: "line" }] });
    expect((await getLibrarySkill(line.client, "col", "a")).markdown).toContain("\n---\n");
    const empty = mockClient([valid()], { type: "collectionItem", content: [] });
    await expect(getLibrarySkill(empty.client, "col", "a")).rejects.toThrow("no exportable text content");
  });
});
