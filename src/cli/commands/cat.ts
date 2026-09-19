// craft cat <id> [id...] - read multiple docs, concat output
import { parseWithGlobals, buildClient } from "../client-factory.ts";
import {
  getAndRender,
  renderBacklinksMarkdown,
} from "../render.ts";
import { parallel } from "../../lib/client.ts";
import { dim, jsonOutForArgs } from "../format.ts";
import { shouldTryLocal, sourceFromArgs } from "../source.ts";
import { resolveProfile } from "../config.ts";
import { readShapeOptions, shapeMarkdown, applyDocumentBudget } from "../read-shaping.ts";
import { readLocalDocsSafe } from "../local-safe.ts";

export async function runCat(argv: string[]) {
  const args = parseWithGlobals(argv, {
    flags: {
      depth: { type: "number" },
      "no-links": { type: "boolean" },
      links: { type: "boolean" },
      raw: { type: "boolean" },
      exhaustive: { type: "boolean" },
      lines: { type: "string" },
      head: { type: "number" },
      outline: { type: "boolean" },
      budget: { type: "number" },
    },
  });

  const ids = args.positional;
  if (ids.length === 0) throw new Error("usage: craft cat <id> [id...]");
  const shape = readShapeOptions(args.flags, args.flags.json ? "json" : "markdown");

  const { client } = await buildClient(args);
  const source = sourceFromArgs(args);
  const explicitProfile = typeof args.flags.profile === "string" ? args.flags.profile : undefined;
  const spaceId = (await resolveProfile(explicitProfile)).spaceId;

  // Open the Desktop store once for this invocation. Each getAndRender call
  // still owns source routing, so misses retain their per-document API
  // fallback and strict --source local rejection semantics.
  const batch =
    shouldTryLocal(source) &&
    spaceId !== undefined &&
    !args.flags.json &&
    args.flags.depth === undefined &&
    !args.flags.raw &&
    !args.flags.links &&
    !args.flags.exhaustive
      ? await readLocalDocsSafe(ids, { spaceId })
      : null;
  const localRead = batch
    ? async (target: { id?: string; dailyTitle?: string }) => {
        if (!target.id) return { status: batch.status, timeoutMs: batch.timeoutMs, doc: null };
        return {
          status: batch.status,
          timeoutMs: batch.timeoutMs,
          doc: batch.docs[target.id] ?? null,
        };
      }
    : undefined;

  const results = await parallel(ids, async (id) => {
    const { payload, backlinks, servedBy } = await getAndRender(client, {
      id,
      depth: args.flags.depth,
      format: args.flags.json ? "json" : "markdown",
      raw: args.flags.raw,
      withLinks: !!args.flags.links,
      exhaustive: args.flags.exhaustive,
      source,
      spaceId,
      localRead,
    });
    return { id, payload, backlinks, servedBy };
  });

  if (args.flags.json) {
    console.log(jsonOutForArgs(results.map((r) => r.payload), args.flags));
    return;
  }

  if (!shape) {
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (i > 0) console.log(`\n---\n`);
      const md = r.payload as string;
      process.stdout.write(md.endsWith("\n") ? md : `${md}\n`);
      if (r.backlinks !== null) process.stdout.write(renderBacklinksMarkdown(r.backlinks));
    }
  } else {
    const shaped = results.map((r) => {
      const md = shapeMarkdown(r.payload as string, { ...shape, budget: undefined });
      let rendered = md.endsWith("\n") ? md : `${md}\n`;
      if (r.backlinks !== null) rendered += renderBacklinksMarkdown(r.backlinks);
      return rendered;
    });
    if (shape.budget !== undefined) {
      process.stdout.write(applyDocumentBudget(shaped, shape.budget));
    } else {
      for (let i = 0; i < shaped.length; i++) {
        if (i > 0) process.stdout.write("\n---\n\n");
        process.stdout.write(shaped[i]!);
      }
    }
  }

  if (!args.flags.quiet) {
    const local = results.filter((r) => r.servedBy === "local").length;
    const served = local === results.length ? "local" : local === 0 ? "api" : `${local}/${results.length} local`;
    console.error(dim(`\n${results.length} documents (${served})`));
  }
}
