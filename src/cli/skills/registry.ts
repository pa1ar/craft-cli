import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { loadSkillManifest, validateBundledSkill, type SkillRef } from "./manifest.ts";

export interface DiscoverSkillsOptions {
  bundledDir?: string;
  localDir?: string;
}

export interface SkillSearchResult extends SkillRef {
  score: number;
  matches: string[];
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<SkillRef[]> {
  const bundledDir = options.bundledDir ?? findBundledSkillsDir();
  const localDir = options.localDir ?? join(homedir(), ".craft-cli", "skills");
  const [bundled, local] = await Promise.all([
    discoverFromRoot(bundledDir, "bundled", true),
    discoverFromRoot(localDir, "local", false),
  ]);
  return [...bundled, ...local].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export async function findSkill(name: string, options: DiscoverSkillsOptions = {}): Promise<SkillRef | null> {
  const skills = await discoverSkills(options);
  return skills.find((skill) => skill.manifest.name === name) ?? null;
}

export function searchSkills(skills: SkillRef[], query: string): SkillSearchResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) {
    return skills.map((skill) => ({ ...skill, score: 1, matches: [] }));
  }

  return skills
    .map((skill) => scoreSkill(skill, terms))
    .filter((result): result is SkillSearchResult => result !== null)
    .sort((a, b) => b.score - a.score || a.manifest.name.localeCompare(b.manifest.name));
}

export function findBundledSkillsDir(): string {
  const candidates = [
    process.env.CRAFT_CLI_REPO ? join(process.env.CRAFT_CLI_REPO, "skills") : null,
    join(process.cwd(), "skills"),
    join(dirname(process.execPath), "..", "skills"),
    resolve(import.meta.dir, "../../../skills"),
    resolve(import.meta.dir, "../../../../skills"),
  ].filter(Boolean) as string[];

  return candidates.find((path) => existsSync(path)) ?? candidates[1]!;
}

async function discoverFromRoot(
  root: string,
  source: SkillRef["source"],
  requireBundledShape: boolean
): Promise<SkillRef[]> {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const skills: SkillRef[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillRoot = join(root, entry.name);
    if (requireBundledShape) {
      const validation = await validateBundledSkill(skillRoot);
      if (!validation.ok) continue;
    }
    try {
      const manifest = await loadSkillManifest(skillRoot);
      skills.push({ manifest, root: skillRoot, source });
    } catch {
      // local skill directories are explicit but can be half-written; ignore invalid
    }
  }
  return skills;
}

function scoreSkill(skill: SkillRef, terms: string[]): SkillSearchResult | null {
  let score = 0;
  const matches = new Set<string>();
  const manifest = skill.manifest;
  const fields = [
    { label: "name", value: manifest.name, weight: 8 },
    { label: "description", value: manifest.description, weight: 3 },
    { label: "tag", value: manifest.tags.join(" "), weight: 5 },
    { label: "command", value: manifest.commands.map((command) => `${command.name} ${command.description}`).join(" "), weight: 6 },
  ];

  for (const term of terms) {
    for (const field of fields) {
      const haystack = field.value.toLowerCase();
      if (haystack.includes(term)) {
        score += field.weight;
        matches.add(field.label);
      }
    }
  }

  return score > 0 ? { ...skill, score, matches: Array.from(matches).sort() } : null;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}
