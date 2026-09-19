// Read-only CLI benchmark. Plaintext fixtures exist only in a temporary directory.
// Usage: bun benchmarks/read-efficiency.ts BEFORE_BINARY CURRENT_BINARY PROFILE:ID [PROFILE:ID...]
// stdout contains metrics only; no document content, IDs, or credentials.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, platform, arch, release } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const [beforeArg, currentArg, ...targets] = process.argv.slice(2);
if (!beforeArg || !currentArg || targets.length === 0) {
  throw new Error("usage: bun benchmarks/read-efficiency.ts BEFORE_BINARY CURRENT_BINARY PROFILE:ID...");
}
const before = resolve(beforeArg);
const current = resolve(currentArg);
const fixtures = mkdtempSync(join(tmpdir(), "craft-markdown-fixtures-"));

async function execute(command: string[]) {
  const start = performance.now();
  const cleanLocalScenario = command.includes("--source") && command[command.indexOf("--source") + 1] === "local";
  const child = Bun.spawn(command, {
    stdout: "pipe", stderr: "pipe",
    // Benchmark clean cache hits without changing real pending-write state.
    env: cleanLocalScenario ? { ...process.env, CRAFT_FRESHNESS_DB_PATH: join(fixtures, "clean-freshness.db") } : process.env,
  });
  const timer = setTimeout(() => child.kill(), 45000);
  const [output, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(`benchmark command failed (${code}): ${stderr.slice(0, 180)}`);
  return {
    ms: performance.now() - start, output,
    source: stderr.includes("(local)") ? "local" : stderr.includes("(api)") ? "api" : null,
    bytes: Buffer.byteLength(output), characters: [...output].length,
    lines: output ? output.split("\n").length - Number(output.endsWith("\n")) : 0,
  };
}

type Sample = Omit<Awaited<ReturnType<typeof execute>>, "output">;
const cases: { name: string; document: number; command: string[]; repetitions: number; samples: Sample[] }[] = [];
const documents: { label: string; bytes: number; characters: number; lines: number }[] = [];
function add(name: string, document: number, command: string[], repetitions = 15) {
  cases.push({ name, document, command, repetitions, samples: [] });
}

try {
  for (const [index, target] of targets.entries()) {
    const colon = target.indexOf(":");
    if (colon < 1) throw new Error("targets must be PROFILE:ID");
    const profile = target.slice(0, colon);
    const id = target.slice(colon + 1);
    const base = ["docs", "get", id, "--profile", profile];
    const local = [...base, "--source", "local"];
    const fixture = join(fixtures, `document-${index + 1}.md`);
    const seed = await execute([current, ...local]);
    if (seed.source !== "local") throw new Error("expected a trusted Desktop cache hit");
    await Bun.write(fixture, seed.output);
    documents.push({ label: `document-${index + 1}`, bytes: seed.bytes, characters: seed.characters, lines: seed.lines });
    add("before-default-with-backlinks", index, [before, ...base], 5);
    add("before-api-content-only", index, [before, ...base, "--no-links"], 5);
    add("after-api-content-only", index, [current, ...base, "--source", "api"], 5);
    add("after-auto-current-freshness", index, [current, ...base, "--source", "auto"], 5);
    add("after-local-full", index, [current, ...local]);
    add("after-local-head40", index, [current, ...local, "--head", "40"]);
    add("after-local-lines20-60", index, [current, ...local, "--lines", "20:60"]);
    add("after-local-outline", index, [current, ...local, "--outline"]);
    add("after-local-budget2000", index, [current, ...local, "--budget", "2000"]);
    add("markdown-cat", index, ["/bin/cat", fixture]);
    add("markdown-head40", index, ["/usr/bin/head", "-n", "40", fixture]);
    add("markdown-lines20-60", index, ["/usr/bin/sed", "-n", "20,60p", fixture]);
  }
  // One excluded warm-up per case; each timed read starts a new CLI process.
  for (const c of cases) await execute(c.command);
  for (let round = 0; round < 15; round++) {
    // Rotate case order to reduce systematic timing/order bias.
    for (let offset = 0; offset < cases.length; offset++) {
      const c = cases[(offset + round) % cases.length]!;
      if (round >= c.repetitions) continue;
      const { output: _, ...sample } = await execute(c.command);
      c.samples.push(sample);
    }
    console.error(`completed measurement round ${round + 1}/15`);
  }
  const digest = async (path: string) => createHash("sha256").update(Buffer.from(await Bun.file(path).arrayBuffer())).digest("hex");
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(), platform: `${platform()} ${arch()} ${release()}`,
    beforeBinarySha256: await digest(before), currentBinarySha256: await digest(current),
    methodology: "Warm filesystem; fresh process per sample; one excluded warm-up; 5 network/auto or 15 local samples; full stdout drained; no UI/LLM time. Identical current-local bytes written to temporary .md fixtures. Explicit local cases use an isolated clean freshness DB; auto cases use real pending-write state.",
    documents,
    cases: cases.map(({ name, document, samples }) => {
      const times = samples.map(s => s.ms).sort((a, b) => a - b);
      return { name, document, medianMs: times[Math.floor(times.length / 2)], minMs: times[0], maxMs: times.at(-1), samples };
    }),
  }, null, 2));
} finally {
  rmSync(fixtures, { recursive: true, force: true });
}
