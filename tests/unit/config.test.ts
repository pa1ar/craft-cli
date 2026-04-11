// unit tests for config mode resolution + round-trip persistence
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMode, type Config } from "../../src/cli/config.ts";

describe("resolveMode", () => {
  const origEnv = process.env.CRAFT_MODE;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.CRAFT_MODE;
    else process.env.CRAFT_MODE = origEnv;
  });

  test("defaults to hybrid when nothing is set", () => {
    delete process.env.CRAFT_MODE;
    expect(resolveMode(null)).toEqual({ mode: "hybrid", source: "default" });
  });

  test("uses config.mode when env is absent", () => {
    delete process.env.CRAFT_MODE;
    const cfg: Config = { default: "p1", profiles: {}, mode: "api" };
    expect(resolveMode(cfg)).toEqual({ mode: "api", source: "config" });
  });

  test("CRAFT_MODE env overrides config.mode", () => {
    process.env.CRAFT_MODE = "hybrid";
    const cfg: Config = { default: "p1", profiles: {}, mode: "api" };
    expect(resolveMode(cfg)).toEqual({ mode: "hybrid", source: "env" });
  });

  test("CRAFT_MODE=api overrides hybrid config", () => {
    process.env.CRAFT_MODE = "api";
    const cfg: Config = { default: "p1", profiles: {}, mode: "hybrid" };
    expect(resolveMode(cfg)).toEqual({ mode: "api", source: "env" });
  });

  test("env is case-insensitive and trims whitespace", () => {
    process.env.CRAFT_MODE = "  API  ";
    expect(resolveMode(null)).toEqual({ mode: "api", source: "env" });
  });

  test("invalid CRAFT_MODE values are ignored", () => {
    process.env.CRAFT_MODE = "offline";
    const cfg: Config = { default: "p1", profiles: {}, mode: "api" };
    expect(resolveMode(cfg)).toEqual({ mode: "api", source: "config" });
  });

  test("invalid cfg.mode values fall through to default", () => {
    delete process.env.CRAFT_MODE;
    // cast around the type to simulate a hand-edited bad config file
    const cfg = { default: "p1", profiles: {}, mode: "offline" } as unknown as Config;
    expect(resolveMode(cfg)).toEqual({ mode: "hybrid", source: "default" });
  });

  test("config without mode field is backward compatible", () => {
    delete process.env.CRAFT_MODE;
    const cfg: Config = { default: "p1", profiles: { p1: { url: "u", key: "k" } } };
    expect(resolveMode(cfg)).toEqual({ mode: "hybrid", source: "default" });
  });
});

describe("config file round-trip with mode", () => {
  let tmp: string;
  let path: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "craft-cli-cfg-"));
    path = join(tmp, "config.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("JSON with mode field parses correctly", () => {
    const input: Config = {
      default: "main",
      profiles: { main: { url: "https://x", key: "k" } },
      mode: "api",
    };
    writeFileSync(path, JSON.stringify(input));
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Config;
    expect(parsed.mode).toBe("api");
    expect(parsed.profiles.main?.url).toBe("https://x");
  });

  test("legacy config without mode parses as Config type", () => {
    const legacy = { default: "main", profiles: { main: { url: "u", key: "k" } } };
    writeFileSync(path, JSON.stringify(legacy));
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Config;
    expect(parsed.mode).toBeUndefined();
    expect(resolveMode(parsed).mode).toBe("hybrid");
  });
});
