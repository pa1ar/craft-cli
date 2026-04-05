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

  test("rate limit", () => {
    const e = new CraftError({ status: 429, path: "GET /x", body: {}, rawBody: "" });
    expect(e.kind).toBe("RATE_LIMIT");
    expect(e.toExitCode()).toBe(2);
  });
});
