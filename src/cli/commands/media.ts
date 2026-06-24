import { runSkillByName } from "./skills.ts";
import { parseWithGlobals } from "../client-factory.ts";
import { jsonOutForArgs } from "../format.ts";

const HELP = `craft media

Usage:
  craft media analyze <blockId> [--estimate] [--max-cost EUR] [--json]
`;

export function buildMediaAnalyzeSkillArgs(blockId: string, rest: string[]): string[] {
  return ["media-analyze", "analyze", blockId, ...rest];
}

export async function runMedia(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(HELP.trimEnd());
    return;
  }
  if (sub !== "analyze") throw new Error(`unknown media command: ${sub}`);
  const rest = argv.slice(1);
  const args = parseWithGlobals(rest, {
    flags: {
      estimate: { type: "boolean" },
      "max-cost": { type: "number" },
    },
  });
  const blockId = args.positional[0];
  if (!blockId) throw new Error("usage: craft media analyze <blockId>");
  const skillArgs = buildMediaAnalyzeSkillArgs(blockId, args.positional.slice(1));
  const output = await runSkillByName(skillArgs[0]!, skillArgs[1]!, skillArgs.slice(2), args.flags);
  if (args.flags.json) {
    console.log(jsonOutForArgs(output, args.flags));
  } else {
    if (output.error) console.error(output.error);
    if (output.markdown) console.log(output.markdown);
    if (!output.error && !output.markdown) console.log(output.status);
  }
  if (output.status === "failed") process.exitCode = 1;
}
