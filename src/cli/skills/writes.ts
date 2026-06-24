import { getJournal } from "../journal-singleton.ts";
import { dim } from "../format.ts";
import type { CraftClient } from "../../lib/client.ts";
import type { Block } from "../../lib/types.ts";
import type { ProposedCraftWrite, SkillArtifact, SkillRunOutput } from "./runner.ts";

export interface SkillRunWriteState {
  sourceBlockId: string;
  runBlockId?: string;
}

export async function createSkillRunBlock(
  client: CraftClient,
  sourceBlockId: string,
  skillName: string,
  commandName: string
): Promise<SkillRunWriteState> {
  const markdown = [
    "Status: started",
    `Started: ${new Date().toISOString()}`,
  ].join("\n");
  const res = await client.blocks.insert(
    [
      {
        type: "page",
        textStyle: "card",
        markdown: `Craft skill run: ${skillName}.${commandName}`,
        content: [{ type: "text", markdown }],
      },
    ],
    { position: "end", pageId: sourceBlockId }
  );
  const runBlockId = res.items[0]?.id;
  recordJournal("append", sourceBlockId, res.items.map((item: Block) => item.id), null, res.items);
  return { sourceBlockId, runBlockId };
}

export async function finishSkillRunBlock(
  client: CraftClient,
  state: SkillRunWriteState,
  output: SkillRunOutput
): Promise<void> {
  const title = `Craft skill run: ${output.status}`;
  const markdown = renderSkillRunDetailsMarkdown(output);
  if (state.runBlockId) {
    const updateRes = await client.blocks.update([{ id: state.runBlockId, markdown: title }]);
    recordJournal("update", state.sourceBlockId, [state.runBlockId], null, updateRes.items);
    const appendRes = await client.blocks.append(markdown, { pageId: state.runBlockId });
    recordJournal("append", state.runBlockId, appendRes.items.map((item: Block) => item.id), null, appendRes.items);
    return;
  }
  const res = await client.blocks.append(`${title}\n\n${markdown}`, { pageId: state.sourceBlockId });
  recordJournal("append", state.sourceBlockId, res.items.map((item: Block) => item.id), null, res.items);
}

export async function applyProposedWrites(
  client: CraftClient,
  writes: ProposedCraftWrite[] = []
): Promise<Array<{ op: string; count: number }>> {
  const applied: Array<{ op: string; count: number }> = [];
  for (const write of writes) {
    if (write.op === "append_markdown") {
      if (!write.parentId) throw new Error("append_markdown requires parentId");
      const res = await client.blocks.append(write.markdown, { pageId: write.parentId });
      recordJournal("append", write.parentId, res.items.map((item: Block) => item.id), null, res.items);
      applied.push({ op: write.op, count: res.items.length });
      continue;
    }
    if (write.op === "update_markdown") {
      if (!write.blockId) throw new Error("update_markdown requires blockId");
      const res = await client.blocks.update([{ id: write.blockId, markdown: write.markdown }]);
      recordJournal("update", write.blockId, [write.blockId], null, res.items);
      applied.push({ op: write.op, count: res.items.length });
      continue;
    }
    throw new Error(`unsupported proposed write: ${(write as ProposedCraftWrite).op}`);
  }
  return applied;
}

export function renderSkillRunMarkdown(output: SkillRunOutput): string {
  return [`## Craft skill run: ${output.status}`, "", renderSkillRunDetailsMarkdown(output)].join("\n").trimEnd();
}

export function renderSkillRunDetailsMarkdown(output: SkillRunOutput): string {
  const lines = [
    `Status: ${output.status}`,
    `Finished: ${new Date().toISOString()}`,
  ];
  if (output.error) lines.push("", `Error: ${output.error}`);
  if (output.metrics && Object.keys(output.metrics).length > 0) {
    lines.push("", "### Metrics", "```json", JSON.stringify(output.metrics, null, 2), "```");
  }
  if (output.markdown) lines.push("", "### Analysis", output.markdown);
  if (output.artifacts && output.artifacts.length > 0) {
    lines.push("", "### Artifacts", renderArtifacts(output.artifacts));
  }
  return lines.join("\n").trimEnd();
}

function renderArtifacts(artifacts: SkillArtifact[]): string {
  return artifacts
    .map((artifact) => {
      if (artifact.kind === "json") {
        return [`#### ${artifact.name}`, "```json", artifact.content ?? "{}", "```"].join("\n");
      }
      if (artifact.kind === "file") {
        return `- ${artifact.name}: ${artifact.path ?? ""}`;
      }
      return [`#### ${artifact.name}`, artifact.content ?? ""].join("\n");
    })
    .join("\n\n");
}

function recordJournal(op: string, docId: string, blockIds: string[], pre: unknown, post: unknown): void {
  try {
    getJournal().record({ op, docId, blockIds, pre, post });
  } catch (e) {
    console.error(dim(`journal warning: ${(e as Error).message}`));
  }
}
