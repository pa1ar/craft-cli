// singleton journal instance for CLI commands.
// keeps one sqlite connection alive per process.

import { Journal } from "../lib/journal.ts";

let _journal: Journal | undefined;

export function getJournal(): Journal {
  if (!_journal) _journal = Journal.open();
  return _journal;
}

export function closeJournal(): void {
  _journal?.close();
  _journal = undefined;
}
