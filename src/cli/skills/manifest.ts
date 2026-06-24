import { stat } from "node:fs/promises";

export interface SkillCommandManifest {
  name: string;
  description: string;
  entry: string;
  args?: string[];
  sourceBlockArgIndex?: number;
  estimatedCostEur?: number;
}

export interface SkillManifest {
  name: string;
  description: string;
  tags: string[];
  commands: SkillCommandManifest[];
  permissions: {
    network?: string[];
    craft?: Array<"read" | "write">;
    openai?: boolean;
    filesystem?: Array<"read" | "write">;
    subprocess?: string[];
  };
  artifacts: string[];
}

export interface SkillRef {
  manifest: SkillManifest;
  root: string;
  source: "bundled" | "local";
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export async function loadSkillManifest(root: string): Promise<SkillManifest> {
  const file = Bun.file(`${root}/manifest.json`);
  if (!(await file.exists())) throw new Error(`missing manifest.json: ${root}`);
  const raw = await file.text();
  const parsed = JSON.parse(raw);
  const result = validateSkillManifest(parsed);
  if (!result.ok) throw new Error(`invalid manifest ${root}: ${result.errors.join("; ")}`);
  return parsed as SkillManifest;
}

export function validateSkillManifest(value: unknown): ValidationResult {
  const errors: string[] = [];
  const obj = isRecord(value) ? value : null;
  if (!obj) return { ok: false, errors: ["manifest must be an object"] };

  requireString(obj, "name", errors);
  requireString(obj, "description", errors);
  requireStringArray(obj, "tags", errors);
  requireStringArray(obj, "artifacts", errors);

  if (!isRecord(obj.permissions)) {
    errors.push("permissions must be an object");
  } else {
    const permissions = obj.permissions;
    if (permissions.openai !== undefined && typeof permissions.openai !== "boolean") {
      errors.push("permissions.openai must be boolean");
    }
    if (permissions.network !== undefined && !isStringArray(permissions.network)) {
      errors.push("permissions.network must be string[]");
    }
    if (permissions.craft !== undefined) {
      if (!Array.isArray(permissions.craft) || permissions.craft.some((p) => p !== "read" && p !== "write")) {
        errors.push("permissions.craft must contain read/write");
      }
    }
    if (permissions.filesystem !== undefined) {
      if (!Array.isArray(permissions.filesystem) || permissions.filesystem.some((p) => p !== "read" && p !== "write")) {
        errors.push("permissions.filesystem must contain read/write");
      }
    }
    if (permissions.subprocess !== undefined && !isStringArray(permissions.subprocess)) {
      errors.push("permissions.subprocess must be string[]");
    }
  }

  if (!Array.isArray(obj.commands) || obj.commands.length === 0) {
    errors.push("commands must be a non-empty array");
  } else {
    for (const [index, item] of obj.commands.entries()) {
      if (!isRecord(item)) {
        errors.push(`commands.${index} must be an object`);
        continue;
      }
      requireString(item, `commands.${index}.name`, errors, "name");
      requireString(item, `commands.${index}.description`, errors, "description");
      requireString(item, `commands.${index}.entry`, errors, "entry");
      if (item.args !== undefined && !isStringArray(item.args)) {
        errors.push(`commands.${index}.args must be string[]`);
      }
      if (item.sourceBlockArgIndex !== undefined && !isNonNegativeInteger(item.sourceBlockArgIndex)) {
        errors.push(`commands.${index}.sourceBlockArgIndex must be a non-negative integer`);
      }
      if (item.estimatedCostEur !== undefined && (typeof item.estimatedCostEur !== "number" || item.estimatedCostEur < 0)) {
        errors.push(`commands.${index}.estimatedCostEur must be a non-negative number`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export async function validateBundledSkill(root: string): Promise<ValidationResult> {
  const errors: string[] = [];
  try {
    await loadSkillManifest(root);
  } catch (e) {
    errors.push((e as Error).message);
  }

  for (const rel of ["SKILL.md", "scripts", "examples", "tests"]) {
    if (!(await exists(`${root}/${rel}`))) errors.push(`missing ${rel}`);
  }

  return { ok: errors.length === 0, errors };
}

export function findSkillCommand(manifest: SkillManifest, name: string): SkillCommandManifest | undefined {
  return manifest.commands.find((command) => command.name === name);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  displayPath: string,
  errors: string[],
  key = displayPath
): void {
  if (typeof obj[key] !== "string" || obj[key] === "") errors.push(`${displayPath} must be a non-empty string`);
}

function requireStringArray(obj: Record<string, unknown>, key: string, errors: string[]): void {
  if (!isStringArray(obj[key])) errors.push(`${key} must be string[]`);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
