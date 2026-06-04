import { afterEach, describe, expect, test } from "bun:test";
import {
  __runProcessWithTimeoutForTests,
  localTimeoutMs,
} from "../../src/cli/local-safe.ts";

describe("local-safe helper process", () => {
  const originalTimeout = process.env.CRAFT_LOCAL_TIMEOUT_MS;

  afterEach(() => {
    if (originalTimeout === undefined) delete process.env.CRAFT_LOCAL_TIMEOUT_MS;
    else process.env.CRAFT_LOCAL_TIMEOUT_MS = originalTimeout;
  });

  test("uses env timeout override", () => {
    process.env.CRAFT_LOCAL_TIMEOUT_MS = "42";
    expect(localTimeoutMs()).toBe(42);
  });

  test("kills a stuck helper instead of waiting for it", async () => {
    const started = Date.now();
    const result = await __runProcessWithTimeoutForTests(
      [process.execPath, "-e", "setTimeout(() => {}, 10000)"],
      50,
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("captures a fast helper result", async () => {
    const result = await __runProcessWithTimeoutForTests(
      [process.execPath, "-e", "console.log('ok')"],
      1000,
    );
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("ok");
  });
});
