import { test, expect, describe } from "bun:test";
import { CraftError } from "../../src/lib/errors.ts";

describe("CraftError", () => {
  test("singular {error, code} shape", () => {
    const e = new CraftError({
      status: 401,
      path: "GET /connection",
      body: { error: "Invalid Authorization header", code: "INVALID_AUTH_HEADER" },
      rawBody: "",
    });
    expect(e.kind).toBe("AUTH");
    expect(e.status).toBe(401);
    expect(e.code).toBe("INVALID_AUTH_HEADER");
    expect(e.toExitCode()).toBe(3);
  });

  test("plural {errors: [{code, message}]} shape", () => {
    const e = new CraftError({
      status: 404,
      path: "PUT /blocks",
      body: { errors: [{ code: "NOT_FOUND_ERROR", message: "Block not found" }] },
      rawBody: "",
    });
    expect(e.kind).toBe("NOT_FOUND");
    expect(e.code).toBe("NOT_FOUND_ERROR");
    expect(e.message).toContain("Block not found");
    expect(e.toExitCode()).toBe(4);
  });

  test("validation error with details", () => {
    const e = new CraftError({
      status: 400,
      path: "GET /blocks",
      body: {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: [{ code: "custom", message: "Either 'date' or 'id' must be specified." }],
      },
      rawBody: "",
    });
    expect(e.kind).toBe("VALIDATION");
    expect(e.toExitCode()).toBe(1);
    expect(e.details).toBeTruthy();
  });

  test("html fallback", () => {
    const e = new CraftError({
      status: 404,
      path: "GET /nope",
      body: "<!DOCTYPE html><html>...",
      rawBody: "<!DOCTYPE html><html>...",
    });
    expect(e.kind).toBe("NOT_FOUND");
    expect(e.message).toContain("DOCTYPE");
  });

  test("404 on root path treated as AUTH (expired link URL)", () => {
    const e = new CraftError({
      status: 404,
      path: "GET /connection",
      body: { error: "Not found", code: "" },
      rawBody: "",
    });
    expect(e.kind).toBe("AUTH");
    expect(e.toExitCode()).toBe(3);
    expect(e.message).toContain("API link URL is invalid or expired");
  });

  test("404 on /blocks root treated as AUTH", () => {
    const e = new CraftError({
      status: 404,
      path: "GET /blocks",
      body: {},
      rawBody: "",
    });
    expect(e.kind).toBe("AUTH");
    expect(e.toExitCode()).toBe(3);
  });

  test("404 on /documents/search treated as AUTH", () => {
    const e = new CraftError({
      status: 404,
      path: "GET /documents/search?regexps=foo",
      body: {},
      rawBody: "",
    });
    expect(e.kind).toBe("AUTH");
  });

  test("404 on specific block ID still NOT_FOUND", () => {
    const e = new CraftError({
      status: 404,
      path: "PUT /blocks",
      body: { errors: [{ code: "NOT_FOUND_ERROR", message: "Block not found" }] },
      rawBody: "",
    });
    // has NOT_FOUND_ERROR code, so stays NOT_FOUND even though path matches
    expect(e.kind).toBe("NOT_FOUND");
  });

  test("404 on sub-path of a root endpoint stays NOT_FOUND (no false AUTH)", () => {
    // /documents is a root; /documents/<uuid> is a legitimate sub-path that
    // can return 404 for a real missing resource. must not be treated as AUTH.
    const e = new CraftError({
      status: 404,
      path: "GET /documents/deadbeef-uuid",
      body: { error: "not found" },
      rawBody: "",
    });
    expect(e.kind).toBe("NOT_FOUND");
    expect(e.toExitCode()).toBe(4);
  });

  test("404 on /raw typo stays NOT_FOUND (no false AUTH)", () => {
    // `craft raw GET /documents/typo` should surface as not-found, not
    // "link URL expired". only exact root-path matches trigger AUTH.
    const e = new CraftError({
      status: 404,
      path: "GET /documents/typo",
      body: "<!DOCTYPE html>404 Not Found",
      rawBody: "<!DOCTYPE html>404 Not Found",
    });
    expect(e.kind).toBe("NOT_FOUND");
  });

  test("404 on /collections (newly covered root) treated as AUTH", () => {
    const e = new CraftError({
      status: 404,
      path: "GET /collections?documentIds=x",
      body: {},
      rawBody: "",
    });
    expect(e.kind).toBe("AUTH");
  });

  test("rate limit", () => {
    const e = new CraftError({ status: 429, path: "GET /x", body: {}, rawBody: "" });
    expect(e.kind).toBe("RATE_LIMIT");
    expect(e.toExitCode()).toBe(2);
  });
});
