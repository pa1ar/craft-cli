// CraftClient — auth, request pipeline, retry, rate-limit, concurrency helpers.
// Pure fetch, no bun-only APIs. Safe to import from Raycast (Node).

import { CraftError } from "./errors.ts";
import type { ConnectionInfo } from "./types.ts";
import { makeBlocks } from "./blocks.ts";
import { makeDocuments } from "./documents.ts";
import { makeFolders } from "./folders.ts";
import { makeCollections } from "./collections.ts";
import { makeTasks } from "./tasks.ts";
import { makeUpload } from "./upload.ts";
import { makeWhiteboards } from "./whiteboards.ts";
import { makeComments } from "./comments.ts";
import { makeLinks } from "./links.ts";

export interface CraftClientOptions {
  url: string; // base url ending in /api/v1
  key: string; // pdk_...
  timeoutMs?: number; // default 30000
  retries?: number; // default 3
  backoffBaseMs?: number; // default 500
  fetch?: typeof fetch; // override for testing
}

export interface RequestOpts {
  query?: Record<string, string | number | boolean | string[] | undefined | null>;
  body?: unknown;
  rawBody?: Uint8Array;
  accept?: "application/json" | "text/markdown";
  contentType?: string;
  timeoutMs?: number;
}

export class CraftClient {
  readonly url: string;
  readonly key: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffBaseMs: number;
  private readonly fetchFn: typeof fetch;

  readonly blocks: ReturnType<typeof makeBlocks>;
  readonly documents: ReturnType<typeof makeDocuments>;
  readonly folders: ReturnType<typeof makeFolders>;
  readonly collections: ReturnType<typeof makeCollections>;
  readonly tasks: ReturnType<typeof makeTasks>;
  readonly upload: ReturnType<typeof makeUpload>;
  readonly whiteboards: ReturnType<typeof makeWhiteboards>;
  readonly comments: ReturnType<typeof makeComments>;
  readonly links: ReturnType<typeof makeLinks>;

  constructor(opts: CraftClientOptions) {
    this.url = opts.url.replace(/\/+$/, "");
    this.key = opts.key;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.retries = opts.retries ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 500;
    this.fetchFn = opts.fetch ?? globalThis.fetch;

    this.blocks = makeBlocks(this);
    this.documents = makeDocuments(this);
    this.folders = makeFolders(this);
    this.collections = makeCollections(this);
    this.tasks = makeTasks(this);
    this.upload = makeUpload(this);
    this.whiteboards = makeWhiteboards(this);
    this.comments = makeComments(this);
    this.links = makeLinks(this);
  }

  async connection(): Promise<ConnectionInfo> {
    return this.request<ConnectionInfo>("GET", "/connection");
  }

  /** Build a craftdocs:// deeplink for any blockId. Uses urlTemplates.app from /connection, cached. */
  private _deeplinkTemplate?: string;
  async deeplink(blockId: string): Promise<string> {
    if (!this._deeplinkTemplate) {
      const c = await this.connection();
      this._deeplinkTemplate = c.urlTemplates.app;
    }
    return this._deeplinkTemplate.replace("{blockId}", blockId);
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOpts = {}): Promise<T> {
    const url = new URL(this.url + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) {
          for (const item of v) url.searchParams.append(k, String(item));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      Accept: opts.accept ?? "application/json",
    };

    let body: BodyInit | undefined;
    if (opts.rawBody !== undefined) {
      // Uint8Array is a valid BodyInit at runtime; cast to satisfy lib dom types
      body = opts.rawBody as unknown as BodyInit;
      if (opts.contentType) headers["Content-Type"] = opts.contentType;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = opts.contentType ?? "application/json";
      body = JSON.stringify(opts.body);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? this.timeoutMs);

      try {
        const res = await this.fetchFn(url, {
          method,
          headers,
          body,
          signal: ac.signal,
        });
        clearTimeout(timer);

        const text = await res.text();
        const contentType = res.headers.get("content-type") || "";
        const isJson = contentType.includes("json");
        let parsed: unknown = text;
        if (isJson && text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
        }

        if (res.ok) {
          // text/markdown accept: return raw text
          if (opts.accept === "text/markdown") {
            return text as unknown as T;
          }
          return parsed as T;
        }

        // retry on 429 / 5xx
        const retriable = res.status === 429 || res.status >= 500;
        if (retriable && attempt < this.retries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.backoffBaseMs * Math.pow(2, attempt);
          await sleep(wait);
          continue;
        }

        throw new CraftError({
          status: res.status,
          path: `${method} ${path}`,
          body: parsed,
          rawBody: text,
        });
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof CraftError) throw e;
        lastError = e;
        if (attempt < this.retries) {
          await sleep(this.backoffBaseMs * Math.pow(2, attempt));
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run an async mapping over items with bounded concurrency. */
export async function parallel<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 15
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** Recursively walk a block tree, calling visit on every block. */
export function walkBlocks(root: { content?: any[] } | any, visit: (b: any) => void) {
  if (!root) return;
  visit(root);
  if (Array.isArray((root as any).content)) {
    for (const child of (root as any).content) walkBlocks(child, visit);
  }
}

/** Collect blocks matching predicate from a root tree. */
export function findBlocks<B extends { content?: B[] }>(root: B, pred: (b: B) => boolean): B[] {
  const hits: B[] = [];
  walkBlocks(root, (b) => {
    if (pred(b)) hits.push(b);
  });
  return hits;
}
