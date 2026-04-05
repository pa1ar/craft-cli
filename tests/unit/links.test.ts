import { test, expect, describe } from "bun:test";
import { extractOutgoing, inferTitle } from "../../src/lib/links.ts";
import type { Block } from "../../src/lib/types.ts";

describe("extractOutgoing", () => {
  test("finds single link", () => {
    const tree: Block = {
      id: "root",
      type: "page",
      markdown: "root title",
      content: [
        {
          id: "b1",
          type: "text",
          markdown: "see [target doc](block://A83779F4-6CCF-4225-81DB-E8D4A303819C) for more",
        },
      ],
    };
    const links = extractOutgoing(tree);
    expect(links).toHaveLength(1);
    expect(links[0]!.blockId).toBe("A83779F4-6CCF-4225-81DB-E8D4A303819C");
    expect(links[0]!.text).toBe("target doc");
    expect(links[0]!.inBlockId).toBe("b1");
  });

  test("finds multiple links across nested blocks", () => {
    const tree: Block = {
      id: "root",
      type: "page",
      content: [
        {
          id: "b1",
          type: "text",
          markdown: "[A](block://aaaaaaaa-0000-0000-0000-000000000000) and [B](block://bbbbbbbb-0000-0000-0000-000000000000)",
        },
        {
          id: "b2",
          type: "page",
          content: [
            {
              id: "b3",
              type: "text",
              markdown: "deep [C](block://cccccccc-0000-0000-0000-000000000000)",
            },
          ],
        },
      ],
    };
    const links = extractOutgoing(tree);
    expect(links.map((l) => l.blockId).sort()).toEqual([
      "aaaaaaaa-0000-0000-0000-000000000000",
      "bbbbbbbb-0000-0000-0000-000000000000",
      "cccccccc-0000-0000-0000-000000000000",
    ]);
  });

  test("ignores http links and other markdown", () => {
    const tree: Block = {
      id: "root",
      type: "page",
      content: [
        { id: "b1", type: "text", markdown: "see [example](https://example.com) and [inner](block://11111111-2222-3333-4444-555555555555)" },
      ],
    };
    const links = extractOutgoing(tree);
    expect(links).toHaveLength(1);
    expect(links[0]!.blockId).toBe("11111111-2222-3333-4444-555555555555");
  });

  test("empty tree returns empty", () => {
    expect(extractOutgoing({ id: "x", type: "page" })).toEqual([]);
  });
});

describe("inferTitle", () => {
  test("strips heading marker", () => {
    expect(inferTitle({ id: "x", type: "page", markdown: "# My Title" })).toBe("My Title");
    expect(inferTitle({ id: "x", type: "page", markdown: "## Sub" })).toBe("Sub");
    expect(inferTitle({ id: "x", type: "page", markdown: "plain text" })).toBe("plain text");
    expect(inferTitle({ id: "x", type: "page" })).toBe("");
  });
});
