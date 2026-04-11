// singleton local store for CLI commands. lazy-init, cached.

import { discoverLocalStore, type LocalStore } from "../lib/local-db.ts";
import type { Mode } from "./config.ts";

let _store: LocalStore | null | undefined; // undefined = not yet tried
let _modeOverride: Mode = "hybrid";

/** set persistent mode override. main.ts calls this once at startup
 * after resolving CRAFT_MODE env + config.mode. "api" makes getLocalStore
 * always return null without invoking discovery. switching modes invalidates
 * any cached discovery result so the next getLocalStore() call sees the new
 * mode cleanly. */
export function setModeOverride(mode: Mode): void {
  _modeOverride = mode;
  // close any open handle before invalidating the cache
  if (_store) _store.close();
  _store = undefined;
}

export function getLocalStore(opts?: { forceApi?: boolean; spaceId?: string }): LocalStore | null {
  if (opts?.forceApi) return null;
  if (_modeOverride === "api") return null;
  if (_store !== undefined) return _store;

  _store = discoverLocalStore(opts?.spaceId);
  return _store;
}

export function closeLocalStore(): void {
  _store?.close();
  _store = undefined;
}

// test hook only — lets tests reset the singleton between cases.
export function __resetLocalStoreForTests(): void {
  _store = undefined;
  _modeOverride = "hybrid";
}

// test hook only — lets tests seed the singleton with a fake store so they
// can observe cache-invalidation behavior (close() called, state cleared).
export function __setLocalStoreForTests(store: LocalStore | null): void {
  _store = store;
}
