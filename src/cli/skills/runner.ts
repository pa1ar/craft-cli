import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join } from "node:path";
import type { SkillCommandManifest, SkillRef } from "./manifest.ts";

export interface SkillRunInput {
  skill: {
    name: string;
    root: string;
    source: string;
  };
  command: {
    name: string;
    args: string[];
  };
  flags: Record<string, unknown>;
  limits: {
    maxCostEur: number;
  };
  craft?: {
    sourceBlock?: {
      id: string;
      markdown?: string;
      json?: unknown;
    };
  };
}

export interface SkillArtifact {
  name: string;
  kind: "markdown" | "text" | "json" | "file";
  content?: string;
  path?: string;
}

export interface ProposedCraftWrite {
  op: "append_markdown" | "update_markdown";
  parentId?: string;
  blockId?: string;
  markdown: string;
}

export interface SkillRunOutput {
  status: "ok" | "partial" | "failed";
  markdown?: string;
  artifacts?: SkillArtifact[];
  metrics?: {
    model?: string;
    estimatedCostEur?: number;
    actualCostEur?: number;
    [key: string]: unknown;
  };
  proposedWrites?: ProposedCraftWrite[];
  error?: string;
}

export interface RunSkillOptions {
  skill: SkillRef;
  command: SkillCommandManifest;
  args: string[];
  flags?: Record<string, unknown>;
  maxCostEur?: number;
  craft?: SkillRunInput["craft"];
  env?: Record<string, string | undefined>;
}

export async function runSkillSubprocess(options: RunSkillOptions): Promise<SkillRunOutput> {
  const maxCostEur = options.maxCostEur ?? 1;
  const estimate = options.command.estimatedCostEur ?? 0;
  if (estimate > maxCostEur) {
    return {
      status: "failed",
      error: `estimated cost EUR ${estimate.toFixed(2)} exceeds cap EUR ${maxCostEur.toFixed(2)}`,
      metrics: { estimatedCostEur: estimate },
    };
  }

  const entryPath = join(options.skill.root, options.command.entry);
  const input: SkillRunInput = {
    skill: {
      name: options.skill.manifest.name,
      root: options.skill.root,
      source: options.skill.source,
    },
    command: {
      name: options.command.name,
      args: options.args,
    },
    flags: options.flags ?? {},
    limits: { maxCostEur },
    craft: options.craft,
  };

  const proc = Bun.spawn([resolveBunExecutable(), entryPath], {
    cwd: options.skill.root,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...(options.env ?? {}),
      CRAFT_SKILL_ROOT: options.skill.root,
    },
  });

  proc.stdin.write(JSON.stringify(input));
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return {
      status: "failed",
      error: stderr.trim() || `skill exited with code ${exitCode}`,
    };
  }

  try {
    const parsed = JSON.parse(stdout) as SkillRunOutput;
    return normalizeSkillOutput(parsed);
  } catch (e) {
    return {
      status: "failed",
      error: `invalid skill JSON stdout: ${(e as Error).message}`,
    };
  }
}

export function resolveBunExecutable(
  env: NodeJS.ProcessEnv = process.env,
  execPath = process.execPath
): string {
  const pathCandidates = (env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, "bun"));
  const home = env.HOME ?? homedir();
  const candidates = [
    env.BUN_PATH,
    process.versions.bun && basename(execPath).startsWith("bun") ? execPath : undefined,
    ...pathCandidates,
    home ? join(home, ".bun", "bin", "bun") : undefined,
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) ?? "bun";
}

export function estimateSkillRun(command: SkillCommandManifest, maxCostEur = 1): SkillRunOutput {
  const estimatedCostEur = command.estimatedCostEur ?? 0;
  return {
    status: estimatedCostEur > maxCostEur ? "failed" : "ok",
    markdown: `Estimated cost: EUR ${estimatedCostEur.toFixed(2)}. Cap: EUR ${maxCostEur.toFixed(2)}.`,
    metrics: { estimatedCostEur },
    error: estimatedCostEur > maxCostEur
      ? `estimated cost EUR ${estimatedCostEur.toFixed(2)} exceeds cap EUR ${maxCostEur.toFixed(2)}`
      : undefined,
  };
}

function normalizeSkillOutput(output: SkillRunOutput): SkillRunOutput {
  if (!["ok", "partial", "failed"].includes(output.status)) {
    return { status: "failed", error: "skill output status must be ok, partial, or failed" };
  }
  if (output.metrics?.actualCostEur !== undefined && output.metrics.actualCostEur < 0) {
    return { status: "failed", error: "skill output actualCostEur must be non-negative" };
  }
  return {
    ...output,
    artifacts: output.artifacts ?? [],
    proposedWrites: output.proposedWrites ?? [],
  };
}
