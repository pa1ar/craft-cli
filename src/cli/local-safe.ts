// bounded local Craft store operations. local fs/sqlite probes can hang in
// kernel calls, so run them in a helper process the parent can kill.
import type { LocalDoc, LocalDocMarkdown, LocalSearchResult } from "../lib/local-db.ts";

export type LocalProbeStatus = "available" | "unavailable" | "timeout" | "error";

export interface LocalProbeOutcome {
  status: LocalProbeStatus;
  timeoutMs: number;
}

export interface LocalDocsOutcome {
  status: LocalProbeStatus;
  timeoutMs: number;
  docs: LocalDoc[];
}

export interface LocalSearchOutcome {
  status: LocalProbeStatus;
  timeoutMs: number;
  results: LocalSearchResult[];
}

export interface LocalDocReadOutcome {
  status: LocalProbeStatus;
  timeoutMs: number;
  doc: LocalDocMarkdown | null;
}

export interface LocalDocBatchReadOutcome {
  status: LocalProbeStatus;
  timeoutMs: number;
  docs: Record<string, LocalDocMarkdown | null>;
}

type HelperOp = "probe" | "listDocs" | "search" | "readDoc" | "readDocs";

interface ProcessResult {
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const DEFAULT_LOCAL_TIMEOUT_MS = 1500;

export function localTimeoutMs(): number {
  const raw = Number(process.env.CRAFT_LOCAL_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_LOCAL_TIMEOUT_MS;
}

export async function probeLocalStoreSafe(opts?: {
  spaceId?: string;
  timeoutMs?: number;
}): Promise<LocalProbeOutcome> {
  const timeoutMs = opts?.timeoutMs ?? localTimeoutMs();
  const result = await runLocalHelper<{ available: boolean }>(
    "probe",
    { spaceId: opts?.spaceId },
    timeoutMs,
  );
  if (result.timedOut) return { status: "timeout", timeoutMs };
  if (!result.ok) return { status: "error", timeoutMs };
  return {
    status: result.value.available ? "available" : "unavailable",
    timeoutMs,
  };
}

export async function listLocalDocsSafe(opts?: {
  enrich?: boolean;
  spaceId?: string;
  timeoutMs?: number;
}): Promise<LocalDocsOutcome> {
  const timeoutMs = opts?.timeoutMs ?? localTimeoutMs();
  const result = await runLocalHelper<{ available: boolean; docs: LocalDoc[] }>(
    "listDocs",
    { enrich: opts?.enrich, spaceId: opts?.spaceId },
    timeoutMs,
  );
  if (result.timedOut) return { status: "timeout", timeoutMs, docs: [] };
  if (!result.ok) return { status: "error", timeoutMs, docs: [] };
  return {
    status: result.value.available ? "available" : "unavailable",
    timeoutMs,
    docs: result.value.docs,
  };
}

export async function searchLocalDocsSafe(
  query: string,
  opts?: { entityType?: string; limit?: number; spaceId?: string; timeoutMs?: number },
): Promise<LocalSearchOutcome> {
  const timeoutMs = opts?.timeoutMs ?? localTimeoutMs();
  const result = await runLocalHelper<{
    available: boolean;
    results: LocalSearchResult[];
  }>(
    "search",
    {
      query,
      entityType: opts?.entityType,
      limit: opts?.limit,
      spaceId: opts?.spaceId,
    },
    timeoutMs,
  );
  if (result.timedOut) return { status: "timeout", timeoutMs, results: [] };
  if (!result.ok) return { status: "error", timeoutMs, results: [] };
  return {
    status: result.value.available ? "available" : "unavailable",
    timeoutMs,
    results: result.value.results,
  };
}

/** Read one document as markdown from the local store.
 * Pass `id` (API entity id) or `dailyTitle` (`YYYY.MM.DD`). */
export async function readLocalDocSafe(
  target: { id?: string; dailyTitle?: string },
  opts?: { spaceId?: string; timeoutMs?: number },
): Promise<LocalDocReadOutcome> {
  const timeoutMs = opts?.timeoutMs ?? localTimeoutMs();
  const result = await runLocalHelper<{
    available: boolean;
    doc: LocalDocMarkdown | null;
  }>(
    "readDoc",
    {
      id: target.id,
      dailyTitle: target.dailyTitle,
      spaceId: opts?.spaceId,
    },
    timeoutMs,
  );
  if (result.timedOut) return { status: "timeout", timeoutMs, doc: null };
  if (!result.ok) return { status: "error", timeoutMs, doc: null };
  return {
    status: result.value.available ? "available" : "unavailable",
    timeoutMs,
    doc: result.value.doc ?? null,
  };
}

/** Read several documents through one bounded helper/store lifetime. */
export async function readLocalDocsSafe(
  ids: string[],
  opts?: { spaceId?: string; timeoutMs?: number },
): Promise<LocalDocBatchReadOutcome> {
  const timeoutMs = opts?.timeoutMs ?? localTimeoutMs();
  const uniqueIds = [...new Set(ids)];
  const result = await runLocalHelper<{
    available: boolean;
    docs: Record<string, LocalDocMarkdown | null>;
  }>(
    "readDocs",
    { ids: uniqueIds, spaceId: opts?.spaceId },
    timeoutMs,
  );
  if (result.timedOut) return { status: "timeout", timeoutMs, docs: {} };
  if (!result.ok) return { status: "error", timeoutMs, docs: {} };
  return {
    status: result.value.available ? "available" : "unavailable",
    timeoutMs,
    docs: result.value.docs ?? {},
  };
}

async function runLocalHelper<T>(
  op: HelperOp,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<
  | { ok: true; timedOut: false; value: T }
  | { ok: false; timedOut: false }
  | { ok: false; timedOut: true }
> {
  const proc = await runProcessWithTimeout(
    [...selfCommand(), "__local", op, JSON.stringify(payload)],
    timeoutMs,
  );
  if (proc.timedOut) return { ok: false, timedOut: true };
  if (proc.exitCode !== 0) return { ok: false, timedOut: false };
  try {
    const parsed = JSON.parse(proc.stdout) as
      | { ok: true; result: T }
      | { ok: false; error?: string };
    if (!parsed.ok) return { ok: false, timedOut: false };
    return { ok: true, timedOut: false, value: parsed.result };
  } catch {
    return { ok: false, timedOut: false };
  }
}

function selfCommand(): string[] {
  const script = process.argv[1];
  if (script && /\.(?:ts|js|mjs|cjs)$/.test(script)) {
    return [process.execPath, script];
  }
  return [process.execPath];
}

async function runProcessWithTimeout(
  cmd: string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  const proc = Bun.spawn({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  let timer: Timer | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const exited = proc.exited.then((code) => ({ code }));
  const winner = await Promise.race([exited, timeout]);
  if (winner === "timeout") {
    proc.kill("SIGKILL");
    if (timer) clearTimeout(timer);
    void stdout.catch(() => "");
    void stderr.catch(() => "");
    return {
      timedOut: true,
      exitCode: null,
      stdout: "",
      stderr: "",
    };
  }
  if (timer) clearTimeout(timer);
  return {
    timedOut: false,
    exitCode: winner.code,
    stdout: await stdout.catch(() => ""),
    stderr: await stderr.catch(() => ""),
  };
}

// test hook only: exercises timeout behavior without touching real Craft data.
export async function __runProcessWithTimeoutForTests(
  cmd: string[],
  timeoutMs: number,
): Promise<ProcessResult> {
  return runProcessWithTimeout(cmd, timeoutMs);
}
