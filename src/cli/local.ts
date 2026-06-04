// singleton local store for CLI commands. lazy-init, cached.

import { discoverLocalStore, type LocalStore } from "../lib/local-db.ts";
import type { Source } from "./config.ts";

let _store: LocalStore | null | undefined; // undefined = not yet tried
let _sourceOverride: Source = "auto";

/** set persistent source override. main.ts calls this once at startup.
 * "api" makes getLocalStore always return null without invoking discovery.
 * switching sources invalidates
 * any cached discovery result so the next getLocalStore() call sees the new
 * source cleanly. */
export function setSourceOverride(source: Source): void {
  _sourceOverride = source;
  // close any open handle before invalidating the cache
  if (_store) _store.close();
  _store = undefined;
}

export function setModeOverride(mode: "hybrid" | "api"): void {
  setSourceOverride(mode === "api" ? "api" : "auto");
}

export function getSourceOverride(): Source {
  return _sourceOverride;
}

export function getLocalStore(opts?: { source?: Source; forceApi?: boolean; spaceId?: string }): LocalStore | null {
  const source = opts?.forceApi ? "api" : (opts?.source ?? _sourceOverride);
  if (source === "api") return null;
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
  _sourceOverride = "auto";
}

// test hook only — lets tests seed the singleton with a fake store so they
// can observe cache-invalidation behavior (close() called, state cleared).
export function __setLocalStoreForTests(store: LocalStore | null): void {
  _store = store;
}
