// hidden helper invoked as `craft __local ...` by local-safe.ts.
// stdout is JSON for the parent process; stderr is intentionally ignored.
import { discoverLocalStore } from "../../lib/local-db.ts";

type HelperOp = "probe" | "listDocs" | "search";

export async function runLocalWorker(argv: string[]): Promise<void> {
  const op = argv[0] as HelperOp | undefined;
  const payload = parsePayload(argv[1]);

  try {
    switch (op) {
      case "probe": {
        const store = discoverLocalStore(stringValue(payload.spaceId));
        const available = store !== null;
        store?.close();
        writeOk({ available });
        return;
      }
      case "listDocs": {
        const store = discoverLocalStore(stringValue(payload.spaceId));
        if (!store) {
          writeOk({ available: false, docs: [] });
          return;
        }
        try {
          const docs = store.listDocs({ enrich: Boolean(payload.enrich) });
          writeOk({ available: true, docs });
        } finally {
          store.close();
        }
        return;
      }
      case "search": {
        const store = discoverLocalStore(stringValue(payload.spaceId));
        if (!store) {
          writeOk({ available: false, results: [] });
          return;
        }
        try {
          const query = stringValue(payload.query) ?? "";
          const results = store.search(query, {
            entityType: stringValue(payload.entityType),
            limit: numberValue(payload.limit),
          });
          writeOk({ available: true, results });
        } finally {
          store.close();
        }
        return;
      }
      default:
        writeError("unknown local helper operation");
        process.exitCode = 1;
    }
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}

function parsePayload(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function writeOk(result: unknown): void {
  console.log(JSON.stringify({ ok: true, result }));
}

function writeError(message: string): void {
  console.log(JSON.stringify({ ok: false, error: message }));
}
