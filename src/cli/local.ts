// singleton local store for CLI commands. lazy-init, cached.

import { discoverLocalStore, type LocalStore } from "../lib/local-db.ts";

let _store: LocalStore | null | undefined; // undefined = not yet tried

export function getLocalStore(opts?: { forceApi?: boolean; quiet?: boolean; spaceId?: string }): LocalStore | null {
  if (opts?.forceApi) return null;
  if (_store !== undefined) return _store;

  _store = discoverLocalStore(opts?.spaceId);
  if (_store && !opts?.quiet) {
    console.error("[local] using local Craft database");
  }
  return _store;
}

export function closeLocalStore(): void {
  _store?.close();
  _store = undefined;
}
