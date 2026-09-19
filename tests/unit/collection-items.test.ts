import { test, expect, describe } from "bun:test";
import {
  filterCollectionItems,
  filtersFromFlags,
  flattenItemProps,
  itemsForAgentOutput,
  itemsToTableRows,
  stripItemNoise,
} from "../../src/lib/collection-items.ts";

const sample = [
  {
    id: "1",
    title: "Ready eng task",
    properties: {
      status: "Todo",
      assignee: ["forAI"],
      tldr: "Ship checklist",
      operation: { relations: [{ title: "cin platform" }] },
    },
    contentPreviewMd: "NOISE",
  },
  {
    id: "2",
    title: "Human payment",
    properties: { status: "Todo", assignee: ["pa1ar"], tldr: "Collect invoice" },
  },
  {
    id: "3",
    title: "Agent WIP",
    properties: { status: "In Progress", assignee: ["byAI"], tldr: "Pipeline" },
    contentPreviewMd: "more noise",
  },
];

describe("filterCollectionItems", () => {
  test("filters agent ready queue via assignee forAI", () => {
    const out = filterCollectionItems(sample, { status: "Todo", forai: true });
    expect(out.map((i) => i.id)).toEqual(["1"]);
  });

  test("filters pa1ar assignee", () => {
    const out = filterCollectionItems(sample, { assignee: "pa1ar" });
    expect(out.map((i) => i.id)).toEqual(["2"]);
  });

  test("status OR via comma", () => {
    const out = filterCollectionItems(sample, { status: "Todo,In Progress" });
    expect(out).toHaveLength(3);
  });

  test("text substring", () => {
    const out = filterCollectionItems(sample, { text: "payment" });
    expect(out.map((i) => i.id)).toEqual(["2"]);
  });

  test("limit", () => {
    const out = filterCollectionItems(sample, { limit: 1 });
    expect(out).toHaveLength(1);
  });
});

describe("filtersFromFlags", () => {
  test("parses bool and assignee flags", () => {
    expect(filtersFromFlags({ forai: "yes", byAI: "0", assignee: "pa1ar" })).toEqual({
      status: undefined,
      forai: true,
      byai: false,
      assignee: "pa1ar",
      props: [],
      text: undefined,
      limit: undefined,
    });
  });
});

describe("agent output shaping", () => {
  test("strips preview by default", () => {
    const cleaned = stripItemNoise(sample[0]!);
    expect(cleaned.contentPreviewMd).toBeUndefined();
  });

  test("flat lifts properties", () => {
    const [row] = itemsForAgentOutput([sample[0]!], { flat: true });
    expect(row!.status).toBe("Todo");
    expect(row!.assignee).toEqual(["forAI"]);
    expect(row!.properties).toBeUndefined();
  });

  test("table rows are compact", () => {
    const rows = itemsToTableRows(sample);
    expect(rows[0]).toMatchObject({
      id: "1",
      status: "Todo",
      assignee: "forAI",
      operation: "cin platform",
      tldr: "Ship checklist",
    });
    expect(Object.keys(rows[0]!)).not.toContain("contentPreviewMd");
  });

  test("flattenItemProps keeps nested when not dropping", () => {
    const flat = flattenItemProps(sample[0]!);
    expect(flat.properties).toBeDefined();
    expect(flat.status).toBe("Todo");
  });
});
