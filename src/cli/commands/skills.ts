import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { err, jsonOutForArgs, table } from "../format.ts";
import { findSkillCommand, validateBundledSkill } from "../skills/manifest.ts";
import { discoverSkills, findSkill, searchSkills } from "../skills/registry.ts";
import { estimateSkillRun, runSkillSubprocess, type SkillRunOutput } from "../skills/runner.ts";
import { applyProposedWrites, createSkillRunBlock, finishSkillRunBlock } from "../skills/writes.ts";

const HELP = `craft skills

Usage:
  craft skills ls [--json]
  craft skills search <query> [--json]
  craft skills show <name> [--json]
  craft skills validate <path|name> [--json]
  craft skills run <name> <command> [...args] [--estimate] [--max-cost EUR] [--json]
`;

export async function runSkills(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(HELP.trimEnd());
    return;
  }

  const args = parseWithGlobals(rest, {
    flags: {
      estimate: { type: "boolean" },
      "max-cost": { type: "number" },
    },
  });

  switch (sub) {
    case "ls":
    case "list": {
      const skills = await discoverSkills();
      const payload = {
        items: skills.map((skill) => ({
          name: skill.manifest.name,
          source: skill.source,
          description: skill.manifest.description,
          commands: skill.manifest.commands.map((command) => command.name).join(","),
        })),
      };
      console.log(args.flags.json ? jsonOutForArgs(payload, args.flags) : table(payload.items, ["name", "source", "commands", "description"]));
      return;
    }

    case "search": {
      const query = args.positional.join(" ");
      if (!query) throw new Error("usage: craft skills search <query>");
      const results = searchSkills(await discoverSkills(), query);
      const payload = {
        items: results.map((skill) => ({
          name: skill.manifest.name,
          source: skill.source,
          score: skill.score,
          matches: skill.matches.join(","),
          description: skill.manifest.description,
        })),
      };
      console.log(args.flags.json ? jsonOutForArgs(payload, args.flags) : table(payload.items, ["name", "source", "matches", "description"]));
      return;
    }

    case "show": {
      const name = args.positional[0];
      if (!name) throw new Error("usage: craft skills show <name>");
      const skill = await findSkill(name);
      if (!skill) notFound(name);
      const payload = {
        ...skill!.manifest,
        source: skill!.source,
        root: skill!.root,
      };
      if (args.flags.json) {
        console.log(jsonOutForArgs(payload, args.flags));
        return;
      }
      console.log(`# ${payload.name}`);
      console.log(payload.description);
      console.log();
      console.log(table(payload.commands.map((command) => ({
        command: command.name,
        args: command.args?.join(" ") ?? "",
        cost: command.estimatedCostEur ?? 0,
        description: command.description,
      })), ["command", "args", "cost", "description"]));
      return;
    }

    case "validate": {
      const target = args.positional[0];
      if (!target) throw new Error("usage: craft skills validate <path|name>");
      const skill = await findSkill(target);
      const root = skill?.root ?? target;
      const validation = await validateBundledSkill(root);
      const payload = { target, root, ...validation };
      console.log(args.flags.json ? jsonOutForArgs(payload, args.flags) : validation.ok ? "ok" : validation.errors.map((e) => err(`- ${e}`)).join("\n"));
      process.exitCode = validation.ok ? 0 : 1;
      return;
    }

    case "run": {
      const [skillName, commandName, ...commandArgs] = args.positional;
      if (!skillName || !commandName) throw new Error("usage: craft skills run <name> <command> [...args]");
      const output = await runSkillByName(skillName, commandName, commandArgs, args.flags);
      printSkillOutput(output, args.flags);
      if (output.status === "failed") process.exitCode = 1;
      return;
    }

    default:
      throw new Error(`unknown skills command: ${sub}`);
  }
}

export async function runSkillByName(
  skillName: string,
  commandName: string,
  commandArgs: string[],
  flags: Record<string, unknown>
): Promise<SkillRunOutput & { appliedWrites?: Array<{ op: string; count: number }> }> {
  const skill = await findSkill(skillName);
  if (!skill) notFound(skillName);
  const command = findSkillCommand(skill!.manifest, commandName);
  if (!command) throw new Error(`unknown command for skill ${skillName}: ${commandName}`);

  const maxCostEur = typeof flags["max-cost"] === "number" ? flags["max-cost"] as number : 1;
  if (flags.estimate) {
    return estimateSkillRun(command, maxCostEur);
  }

  let craftContext: Parameters<typeof runSkillSubprocess>[0]["craft"];
  let runState: Awaited<ReturnType<typeof createSkillRunBlock>> | undefined;
  const sourceBlockId = command.sourceBlockArgIndex !== undefined ? commandArgs[command.sourceBlockArgIndex] : undefined;

  if (sourceBlockId) {
    const { client } = await buildClient({ positional: [], flags });
    const [json, markdown] = await Promise.all([
      client.blocks.get(sourceBlockId, { format: "json", maxDepth: -1, fetchMetadata: true }).catch(() => null),
      client.blocks.get(sourceBlockId, { format: "markdown", maxDepth: -1 }).catch(() => undefined),
    ]);
    craftContext = {
      sourceBlock: {
        id: sourceBlockId,
        json,
        markdown: typeof markdown === "string" ? markdown : undefined,
      },
    };
    runState = await createSkillRunBlock(client, sourceBlockId, skill!.manifest.name, command.name);
  }

  const output = await runSkillSubprocess({
    skill: skill!,
    command,
    args: commandArgs,
    flags,
    maxCostEur,
    craft: craftContext,
  });

  if (sourceBlockId && runState) {
    const { client } = await buildClient({ positional: [], flags });
    await finishSkillRunBlock(client, runState, output);
    const appliedWrites = await applyProposedWrites(client, output.proposedWrites);
    return { ...output, appliedWrites };
  }
  return output;
}

function printSkillOutput(output: SkillRunOutput & { appliedWrites?: Array<{ op: string; count: number }> }, flags: Record<string, unknown>): void {
  if (flags.json) {
    console.log(jsonOutForArgs(output, flags));
    return;
  }
  if (output.error) console.error(err(output.error));
  if (output.markdown) console.log(output.markdown);
  if (!output.markdown && !output.error) console.log(output.status);
  if (output.appliedWrites?.length) {
    console.log(`applied writes: ${output.appliedWrites.map((write) => `${write.op}:${write.count}`).join(", ")}`);
  }
}

function notFound(name: string): never {
  console.error(err(`skill not found: ${name}`));
  process.exit(4);
}
