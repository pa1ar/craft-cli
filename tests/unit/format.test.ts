import { test, expect, describe } from "bun:test";
import { table, folderTree, stripPageWrapper } from "../../src/cli/format.ts";

describe("table", () => {
  test("empty", () => {
    expect(table([])).toBe("(no results)");
  });
  test("pads columns", () => {
    const out = table([
      { id: "a", name: "short" },
      { id: "bb", name: "longer name" },
    ]);
    expect(out).toContain("id");
    expect(out).toContain("name");
    expect(out).toContain("longer name");
  });
});

describe("folderTree", () => {
  test("basic nesting", () => {
    const out = folderTree([
      { id: "1", name: "A", documentCount: 5, folders: [{ id: "2", name: "B", documentCount: 2 } as any] },
    ]);
    expect(out).toContain("A");
    expect(out).toContain("B");
    expect(out).toContain("(5)");
    expect(out).toContain("(2)");
  });
});

describe("stripPageWrapper", () => {
  test("converts pageTitle to heading", () => {
    const input = `<page id="abc">
  <pageTitle>My Doc</pageTitle>
  <content>
    hello world
  </content>
</page>`;
    const out = stripPageWrapper(input);
    expect(out).toContain("# My Doc");
    expect(out).toContain("hello world");
    expect(out).not.toContain("<page");
    expect(out).not.toContain("</pageTitle>");
    expect(out).not.toContain("<content>");
  });

  test("handles daily note 4-space indent", () => {
    const input = `<page id="x">
  <pageTitle>2026.04.05</pageTitle>
  <content>
    first line
    second line
  </content>
</page>`;
    const out = stripPageWrapper(input);
    expect(out).toContain("# 2026.04.05");
    expect(out).toMatch(/^first line/m);
    expect(out).toMatch(/^second line/m);
  });
});
