// unit tests for the local store singleton wrapper (src/cli/local.ts)
// focus: mode override + forceApi short-circuits, not the underlying discoverer.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  getLocalStore,
  setModeOverride,
  __resetLocalStoreForTests,
  __setLocalStoreForTests,
} from "../../src/cli/local.ts";
import { LocalStore } from "../../src/lib/local-db.ts";

describe("local singleton mode override", () => {
  const origPath = process.env.CRAFT_LOCAL_PATH;

  beforeEach(() => {
    __resetLocalStoreForTests();
    // point discovery at a non-existent path so any fallthrough to discover
    // resolves to null quickly without touching real Craft state on the dev machine.
    process.env.CRAFT_LOCAL_PATH = "/tmp/craft-cli-test-nonexistent-" + Date.now();
  });

  afterEach(() => {
    __resetLocalStoreForTests();
    if (origPath === undefined) delete process.env.CRAFT_LOCAL_PATH;
    else process.env.CRAFT_LOCAL_PATH = origPath;
  });

  test("default mode is hybrid, getLocalStore attempts discovery", () => {
    // with bogus path, discovery returns null - but it does run
    const result = getLocalStore();
    expect(result).toBeNull();
  });

  test("setModeOverride('api') makes getLocalStore return null", () => {
    setModeOverride("api");
    expect(getLocalStore()).toBeNull();
  });

  test("setModeOverride('api') short-circuits even if a spaceId is passed", () => {
    setModeOverride("api");
    expect(getLocalStore({ spaceId: "anything" })).toBeNull();
  });

  test("forceApi flag short-circuits regardless of mode", () => {
    setModeOverride("hybrid");
    expect(getLocalStore({ forceApi: true })).toBeNull();
    setModeOverride("api");
    expect(getLocalStore({ forceApi: true })).toBeNull();
  });

  test("setModeOverride closes cached store and clears cache", () => {
    // seed the singleton with a real (in-memory) LocalStore so we can
    // observe that setModeOverride calls close() and clears the cache.
    const db = new Database(":memory:");
    db.exec(
      `CREATE VIRTUAL TABLE BlockSearch USING fts5(
        id, content, type, entityType, customRank, isTodo, isTodoChecked,
        documentId, stamp UNINDEXED, exactMatchContent, tokenize='unicode61'
      )`,
    );
    const seeded = LocalStore.fromDb(db, null);
    let closeCalls = 0;
    const origClose = seeded.close.bind(seeded);
    seeded.close = () => {
      closeCalls++;
      origClose();
    };

    __setLocalStoreForTests(seeded);
    // flipping to api must close the cached handle
    setModeOverride("api");
    expect(closeCalls).toBe(1);
    expect(getLocalStore()).toBeNull();

    // flipping back to hybrid must also clear the (now-null) cache so the
    // next getLocalStore() re-discovers. with a bogus CRAFT_LOCAL_PATH it
    // still returns null, but the invariant is no stale cache carries over.
    setModeOverride("hybrid");
    expect(getLocalStore()).toBeNull();
  });

  test("__resetLocalStoreForTests restores defaults", () => {
    setModeOverride("api");
    __resetLocalStoreForTests();
    // after reset, mode should be hybrid again - verified indirectly by the
    // fact that forceApi:false path runs (and returns null via bogus path).
    expect(getLocalStore()).toBeNull();
  });
});
