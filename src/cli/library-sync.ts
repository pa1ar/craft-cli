import { readFile, readdir, mkdir, rename, rm, lstat, writeFile, open, readlink } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { hash, resourcePath, type SkillPackage } from "../lib/skill-packages.ts";
import { atomicJSON, type LibraryBinding } from "./library-store.ts";

const MANIFEST = ".craft-skills.json";
interface Manifest { version: 1; source: string; files: Record<string, string>; skills: { id: string; name: string; revision: string }[]; }
interface Generation { manifest: Manifest; files: Record<string, string>; }
export function generation(packages: SkillPackage[], source: string): Generation {
  const files: Record<string, string> = {};
  for (const skill of packages) for (const [path, bytes] of Object.entries(skill.files)) files[`${skill.entry.name}/${path}`] = bytes;
  const manifest: Manifest = { version: 1, source, files: Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, hash(Buffer.from(bytes, "base64"))])), skills: packages.map(p => ({ id: p.entry.id, name: p.entry.name, revision: p.revision })).sort((a,b) => a.name.localeCompare(b.name)) };
  return { files, manifest };
}
function parseManifest(text: string | undefined, source: string): Manifest | undefined {
  if (text === undefined) return undefined;
  const value = JSON.parse(text);
  if (value.version !== 1 || value.source !== source || !value.files || !Array.isArray(value.skills)) throw new Error("mirror ownership mismatch; use a separate destination");
  for (const [path, digest] of Object.entries(value.files)) { resourcePath(path); if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) throw new Error("invalid mirror manifest"); }
  return value;
}
function changes(next: Generation, previous: Manifest | undefined, actual: Record<string, string>): string[] {
  for (const [path, digest] of Object.entries(previous?.files ?? {})) {
    if (actual[path] === undefined || hash(Buffer.from(actual[path], "base64")) !== digest) throw new Error(`managed file changed outside Craft: ${path}`);
  }
  for (const path of Object.keys(next.files)) if (actual[path] !== undefined && previous?.files[path] === undefined) throw new Error(`unmanaged file would be overwritten: ${path}`);
  return [...new Set([...Object.keys(next.files), ...Object.keys(previous?.files ?? {})])].filter(path => actual[path] !== next.files[path]).sort();
}
async function noSymlinks(path: string): Promise<void> {
  const absolute = resolve(path); const parts = absolute.split(sep).filter(Boolean); let at: string = sep;
  for (const part of parts) { at = join(at, part); try { if ((await lstat(at)).isSymbolicLink()) {
      const systemAlias = process.platform === "darwin" && ((at === "/var" && await readlink(at) === "private/var") || (at === "/tmp" && await readlink(at) === "private/tmp"));
      if (!systemAlias) throw new Error(`symlink destination refused: ${at}`);
    } } catch (e: any) { if (e.code !== "ENOENT") throw e; } }
}
async function walkFiles(root: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let entries; try { entries = await readdir(join(root, prefix), { withFileTypes: true }); } catch (e: any) { if (e.code === "ENOENT") return result; throw e; }
  for (const e of entries) {
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isSymbolicLink()) throw new Error(`symlink inside managed folder: ${path}`);
    if (e.isDirectory()) Object.assign(result, await walkFiles(root, path));
    else if (e.isFile()) result[path] = (await readFile(join(root, path))).toString("base64");
    else throw new Error(`unsupported file in mirror: ${path}`);
  }
  return result;
}
export async function syncLocal(next: Generation, destination: string, dryRun = false) {
  const root = resolve(destination); await noSymlinks(root);
  let manifestText; try { manifestText = await readFile(join(root, MANIFEST), "utf8"); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
  const previous = parseManifest(manifestText, next.manifest.source);
  const names = new Set([...next.manifest.skills.map(s => s.name), ...(previous?.skills.map(s => s.name) ?? [])]);
  const actual: Record<string, string> = {};
  for (const name of names) { resourcePath(name); Object.assign(actual, await walkFiles(root, name)); }
  // A complete folder replacement must also preserve ownership of every old file.
  for (const path of Object.keys(actual)) if (previous?.files[path] === undefined) throw new Error(`unmanaged file in generated folder: ${path}`);
  const changed = changes(next, previous, actual);
  const manifestChanged = manifestText !== JSON.stringify(next.manifest);
  if (dryRun || (!changed.length && !manifestChanged)) return { destination: root, changed, dryRun, written: false };
  await mkdir(root, { recursive: true });
  const lockPath = join(root, ".craft-skills.lock"); const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("mirror sync is locked; inspect prior transaction before removing .craft-skills.lock"); });
  const transaction = join(dirname(root), `.craft-skills-${randomUUID()}`);
  const moved: string[] = [], installed: string[] = [];
  try {
    // Recheck ownership after acquiring lock, before staging or replacement.
    let now; try { now = await readFile(join(root, MANIFEST), "utf8"); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
    if (now !== manifestText) throw new Error("mirror changed concurrently; retry sync");
    await mkdir(join(transaction, "new"), { recursive: true }); await mkdir(join(transaction, "old"));
    for (const [path, bytes] of Object.entries(next.files)) { await mkdir(dirname(join(transaction, "new", path)), { recursive: true }); await writeFile(join(transaction, "new", path), Buffer.from(bytes, "base64")); }
    const affected = new Set(changed.map(p => p.split("/")[0]!));
    for (const name of affected) {
      await noSymlinks(join(root,name));
      const current = await walkFiles(root,name);
      if (JSON.stringify(Object.entries(current).sort()) !== JSON.stringify(Object.entries(actual).filter(([p]) => p.startsWith(name + "/")).sort())) throw new Error(`folder changed concurrently: ${name}`);
      try { await rename(join(root, name), join(transaction, "old", name)); moved.push(name); } catch (e: any) { if (e.code !== "ENOENT") throw e; }
      if (next.manifest.skills.some(s => s.name === name)) { await rename(join(transaction, "new", name), join(root, name)); installed.push(name); }
    }
    await atomicJSON(join(root, MANIFEST), next.manifest);
    const archive = join(dirname(root), `.${root.split(sep).pop()}.craft-history`, randomUUID());
    await mkdir(dirname(archive), { recursive: true }); await rename(join(transaction, "old"), archive);
    return { destination: root, changed, dryRun, written: true, archive };
  } catch (error) {
    for (const name of installed.reverse()) await rm(join(root, name), { recursive: true, force: true });
    for (const name of moved.reverse()) await rename(join(transaction, "old", name), join(root, name));
    throw error;
  } finally { await rm(transaction, { recursive: true, force: true }); await lock.close(); await rm(lockPath, { force: true }); }
}

async function gh(args: string[], body?: unknown): Promise<any> {
  const child = Bun.spawn(["gh", ...args], { stdin: body === undefined ? "ignore" : new Blob([JSON.stringify(body)]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit) throw new Error(`GitHub operation failed: ${stderr.trim()}`);
  return stdout.trim() ? JSON.parse(stdout) : undefined;
}
export async function syncGitHub(next: Generation, target: NonNullable<LibraryBinding["github"]>, dryRun = false) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(target.repo)) throw new Error("--github expects OWNER/REPO");
  const prefix = target.path ? resourcePath(target.path).replace(/\/$/, "") + "/" : "";
  const base = `/repos/${target.repo}`;
  const prefixBranch = `craft-skills/${hash(next.manifest.source).slice(0, 12)}`;
  let branch = target.branch;
  let activePR: any;
  let ref: any;
  let exists = true;
  if (target.mode === "pr") {
    const prs = await gh(["api", `${base}/pulls?state=open&per_page=100`]);
    if (prs.length === 100) throw new Error("PR listing may be incomplete; refusing ambiguous publication");
    const matching = prs.filter((p: any) => (p.head.ref === prefixBranch || p.head.ref.startsWith(prefixBranch + "-")) && p.base.ref === target.branch && p.head.repo?.full_name?.toLowerCase() === target.repo.toLowerCase());
    if (matching.length > 1) throw new Error("multiple generated sync PRs; resolve before publication");
    activePR = matching[0];
    const targetRef = await gh(["api", `${base}/git/ref/heads/${encodeURIComponent(target.branch)}`]);
    branch = activePR?.head.ref ?? `${prefixBranch}-${targetRef.object.sha.slice(0, 12)}`;
    try { ref = await gh(["api", `${base}/git/ref/heads/${encodeURIComponent(branch)}`]); }
    catch (e) { if (!String(e).includes("404")) throw e; exists = false; ref = targetRef; }
  } else ref = await gh(["api", `${base}/git/ref/heads/${encodeURIComponent(branch)}`]);
  async function ensurePR(): Promise<string | undefined> {
    if (target.mode !== "pr") return undefined;
    if (activePR) return activePR.html_url;
    const comparison = await gh(["api", `${base}/compare/${encodeURIComponent(target.branch)}...${encodeURIComponent(branch)}`]);
    if (comparison.ahead_by === 0) return undefined;
    const pr = await gh(["api", "--method", "POST", `${base}/pulls`, "--input", "-"], { title: "Sync published Craft skills", head: branch, base: target.branch, body: "Generated from the configured canonical Craft skills collection. Only managed files are changed." });
    return pr.html_url;
  }
  const commit = await gh(["api", `${base}/git/commits/${ref.object.sha}`]);
  const tree = await gh(["api", `${base}/git/trees/${commit.tree.sha}?recursive=1`]);
  if (tree.truncated) throw new Error("incomplete GitHub tree; refusing publication");
  const index = new Map<string, any>(tree.tree.map((e: any) => [e.path, e]));
  async function read(path: string): Promise<string | undefined> {
    const segments = (prefix + path).split("/");
    for (let i = 1; i < segments.length; i++) {
      const parent = index.get(segments.slice(0, i).join("/"));
      if (parent && parent.type !== "tree") throw new Error(`GitHub parent is not a directory: ${segments.slice(0, i).join("/")}`);
    }
    const entry = index.get(prefix + path); if (!entry) return undefined;
    if (entry.type !== "blob" || entry.mode !== "100644") throw new Error(`unsupported GitHub file mode: ${path}`);
    const blob = await gh(["api", `${base}/git/blobs/${entry.sha}`]);
    if (blob.encoding !== "base64") throw new Error("unsupported GitHub blob encoding");
    return blob.content.replace(/\s/g, "");
  }
  const manifestBytes = await read(MANIFEST);
  const text = manifestBytes ? Buffer.from(manifestBytes, "base64").toString("utf8") : undefined;
  const previous = parseManifest(text, next.manifest.source);
  const actual: Record<string, string> = {};
  for (const path of new Set([...Object.keys(next.files), ...Object.keys(previous?.files ?? {})])) { const bytes = await read(path); if (bytes !== undefined) actual[path] = bytes; }
  const changed = changes(next, previous, actual);
  const manifestChanged = text !== JSON.stringify(next.manifest);
  if (dryRun || (!changed.length && !manifestChanged)) return { repo: target.repo, branch, changed, dryRun, published: false, pullRequest: !dryRun && exists ? await ensurePR() : activePR?.html_url };
  const updates: any[] = [];
  for (const path of [...changed, ...(manifestChanged ? [MANIFEST] : [])]) {
    const bytes = path === MANIFEST ? Buffer.from(JSON.stringify(next.manifest)).toString("base64") : next.files[path];
    let sha: string | null = null;
    if (bytes !== undefined) { const blob = await gh(["api", "--method", "POST", `${base}/git/blobs`, "--input", "-"], { content: bytes, encoding: "base64" }); sha = blob.sha; }
    updates.push({ path: prefix + path, mode: "100644", type: "blob", sha });
  }
  const newTree = await gh(["api", "--method", "POST", `${base}/git/trees`, "--input", "-"], { base_tree: commit.tree.sha, tree: updates });
  const newCommit = await gh(["api", "--method", "POST", `${base}/git/commits`, "--input", "-"], { message: "Sync published Craft skills", tree: newTree.sha, parents: [ref.object.sha] });
  // A concurrent branch advance rejects the non-force update.
  await gh(["api", "--method", exists ? "PATCH" : "POST", exists ? `${base}/git/refs/heads/${encodeURIComponent(branch)}` : `${base}/git/refs`, "--input", "-"], exists ? { sha: newCommit.sha, force: false } : { ref: `refs/heads/${branch}`, sha: newCommit.sha });
  const pullRequest = await ensurePR();
  return { repo: target.repo, branch, changed, dryRun, published: true, commit: newCommit.sha, pullRequest };
}
