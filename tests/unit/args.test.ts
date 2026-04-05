import { test, expect, describe } from "bun:test";
import { parseArgs } from "../../src/cli/args.ts";

describe("parseArgs", () => {
  test("positional args", () => {
    const r = parseArgs(["a", "b", "c"]);
    expect(r.positional).toEqual(["a", "b", "c"]);
  });

  test("string flag with space", () => {
    const r = parseArgs(["--url", "https://x"], { flags: { url: { type: "string" } } });
    expect(r.flags.url).toBe("https://x");
  });

  test("string flag with equals", () => {
    const r = parseArgs(["--url=https://x"], { flags: { url: { type: "string" } } });
    expect(r.flags.url).toBe("https://x");
  });

  test("boolean flag default false", () => {
    const r = parseArgs([], { flags: { json: { type: "boolean" } } });
    expect(r.flags.json).toBe(false);
  });

  test("boolean flag set", () => {
    const r = parseArgs(["--json"], { flags: { json: { type: "boolean" } } });
    expect(r.flags.json).toBe(true);
  });

  test("number flag", () => {
    const r = parseArgs(["--depth", "3"], { flags: { depth: { type: "number" } } });
    expect(r.flags.depth).toBe(3);
  });

  test("multi flag collects", () => {
    const r = parseArgs(["--query", "a=1", "--query", "b=2"], {
      flags: { query: { type: "string", multi: true } },
    });
    expect(r.flags.query).toEqual(["a=1", "b=2"]);
  });

  test("alias", () => {
    const r = parseArgs(["-j"], { flags: { json: { type: "boolean", alias: "j" } } });
    expect(r.flags.json).toBe(true);
  });

  test("-- stops parsing", () => {
    const r = parseArgs(["--json", "--", "--not-a-flag", "literal"], {
      flags: { json: { type: "boolean" } },
    });
    expect(r.flags.json).toBe(true);
    expect(r.positional).toEqual(["--not-a-flag", "literal"]);
  });

  test("mix positional and flags", () => {
    const r = parseArgs(["get", "abc", "--depth", "2", "--json"], {
      flags: { depth: { type: "number" }, json: { type: "boolean" } },
    });
    expect(r.positional).toEqual(["get", "abc"]);
    expect(r.flags.depth).toBe(2);
    expect(r.flags.json).toBe(true);
  });
});
