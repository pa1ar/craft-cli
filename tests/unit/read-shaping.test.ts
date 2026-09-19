import { describe, expect, test } from "bun:test";
import {
  applyCharacterBudget,
  applyDocumentBudget,
  markdownOutline,
  parseLineRange,
  readShapeOptions,
  shapeMarkdown,
  TRUNCATION_MARKER,
} from "../../src/cli/read-shaping.ts";

describe("read shaping", () => {
  test("selects an inclusive one-based range and head", () => {
    expect(parseLineRange("2:3")).toEqual({ start: 2, end: 3 });
    expect(shapeMarkdown("one\ntwo\nthree", { lines: { start: 2, end: 3 } })).toBe("two\nthree");
    expect(shapeMarkdown("one\ntwo\nthree", { head: 2 })).toBe("one\ntwo");
  });

  test("rejects invalid and conflicting bounds", () => {
    expect(() => parseLineRange("0:2")).toThrow();
    expect(() => parseLineRange("3:2")).toThrow();
    expect(() => readShapeOptions({ lines: "1:2", head: 1 })).toThrow("cannot be combined");
    expect(() => readShapeOptions({ outline: true, lines: "1:2" })).toThrow("cannot be combined");
    expect(() => readShapeOptions({ head: 0 })).toThrow("positive integer");
  });

  test("outlines headings with source line numbers and skips fenced headings", () => {
    const markdown = "# One\nbody\n```md\n## hidden\n```\n### Three";
    expect(markdownOutline(markdown.split("\n"))).toBe("1: # One\n6: ### Three");
    expect(shapeMarkdown(markdown, { outline: true })).toBe("1: # One\n6: ### Three");
  });

  test("only closes a fence with the same marker at least as long", () => {
    const markdown = "~~~md\n# hidden\n````\n# still hidden\n~~~~\n# shown";
    expect(markdownOutline(markdown.split("\n"))).toBe("6: # shown");
  });

  test("keeps an explicit truncation marker within a character budget", () => {
    const out = applyCharacterBudget("abcdefghijklmnop", 14);
    expect(out).toHaveLength(14);
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(applyDocumentBudget(["abcdefghijkl", "mnop"], 14, "|")).toBe("abc[truncated]");
    expect(() => applyCharacterBudget("abcdef", TRUNCATION_MARKER.length - 1)).toThrow("at least");
    expect(applyCharacterBudget("😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀", 12)).toBe("😀[truncated]");
  });

  test("rejects shaping with JSON or raw output", () => {
    expect(() => readShapeOptions({ head: 2 }, "json")).toThrow("Markdown output");
    expect(() => readShapeOptions({ outline: true, raw: true })).toThrow("--raw");
  });
});
