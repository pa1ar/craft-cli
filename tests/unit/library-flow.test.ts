import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir, symlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pickSkills } from "../../src/lib/skill-picker.ts";

// Functional command flow through a real HTTP server, filesystem and CLI processes.
test("canonical library: bind, picker, offline packages, mirrors, drift and failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "craft-library-flow-"));
  let online = true, revision = 1, name = "invoice", status = "published", bad = false, incomplete = false, bodyFailure = false;
  const calls: string[] = [];
  const props = { name: "name", type: "text" };
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
    const url = new URL(req.url); calls.push(url.pathname + url.search);
    if (!online) return new Response("offline", { status: 403 });
    if (url.pathname.endsWith("/collections")) return Response.json({ items: [{ id: "col", name: "Skills", documentId: "doc" }] });
    if (url.pathname.endsWith("/schema")) return Response.json({ properties: [props, { name: "description", type: "text" }, { name: "kind", type: "singleSelect" }, { name: "status", type: "singleSelect" }] });
    if (incomplete && url.pathname.endsWith("/collections/col/items")) return Response.json({ items: [], nextCursor: "more" });
    if (bodyFailure && url.pathname.endsWith("/blocks") && url.searchParams.get("id") === "one") return new Response("blocked body", { status: 403 });
    if (url.pathname.endsWith("/collections/col/items")) return Response.json({ items: [
      { id: "one", title: "Invoice", properties: { kind: "skill", name, status, description: "Use to prepare monthly invoices and billing statements.", tags: ["finance"] } },
      { id: "two", title: "Draft", properties: { kind: "skill", name: "draft-only", status: "draft", description: "Use for experimental billing" } },
      ...(bad ? [{ id: "bad", properties: { kind: "skill", status: "published", name: "INVALID", description: "bad" } }] : []),
    ] });
    if (url.pathname.endsWith("/collections/resources/items")) return Response.json({ items: [ { id: "script", title: "scripts/check.sh", properties: { path: "scripts/check.sh", kind: "script" } } ] });
    if (url.pathname.endsWith("/blocks")) {
      const id = url.searchParams.get("id");
      if (id === "doc") return Response.json({ id, type: "page", content: [{ id: "intro", type: "text", markdown: "Our skills guidance" }, { id: "col", type: "collection" }] });
      if (id === "intro") return Response.json({ id, type: "text", markdown: "Our skills guidance" });
      if (id === "script") return Response.json({ id, type: "collectionItem", content: [{ type: "code", rawCode: "#!/bin/sh\nprintf 'invoice verified\\n'\n" }] });
      if (id === "one") return Response.json({ id, type: "collectionItem", content: [
        { id: "body", type: "text", markdown: `Invoice rules ${revision}` },
        { id: "table", type: "table", rows: [[{value:"Field"},{value:"Rule"}],[{value:"Amount"},{value:"Verify"}]] },
        { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", type: "page", markdown: "Policy", content: [{ id:"reference", type:"text", markdown:"Use the contract rates." }] },
        { id: "resources", type: "collection", name: "Resources" },
      ] });
      if (id === "two") return Response.json({ id, type: "collectionItem", content: [{ type:"text", markdown:"Draft guidance" }] });
    }
    return new Response("unknown route", { status: 404 });
  } });
  const endpoint = `http://127.0.0.1:${server.port}/api/v1`;
  const run = async (args: string[], stdin?: string, env?: Record<string,string>) => {
    const child = Bun.spawn([Bun.which("bun")!, join(import.meta.dir, "../../src/cli/main.ts"), "lib", ...args, "--url", endpoint], {
      env: { ...process.env, CRAFT_LIB_STATE: join(root,"state"), CRAFT_SOURCE:"auto", ...env }, stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout:"pipe", stderr:"pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);
    return { out, err, code, json: () => JSON.parse(out) };
  };
  const ok = (r: Awaited<ReturnType<typeof run>>) => { expect(r.err).toBe(""); expect(r.code).toBe(0); return r.json(); };
  try {
    expect((await run(["list","--source","local","--collection","col"])).code).not.toBe(0);
    const setup = ["setup","--document","doc","--guide","intro","--out",join(root,"mirror"),"--json"];
    const binding = ok(await run(setup)); expect(ok(await run(setup))).toEqual(binding);
    expect(ok(await run(["status","--json"])).binding.document).toBe("doc");
    const picked = ok(await run(["pick","monthly invoices","--published","--max-output","1","--json"])); expect(picked.items[0].name).toBe("invoice"); expect(picked.selector.used).toBe("keywords");
    expect(ok(await run(["pick","experimental billing","--json"])).items.some((e:any)=>e.name==="draft-only")).toBe(true);
    expect(ok(await run(["pick","unrelated volcano","--published","--json"])).items).toEqual([]);
    expect((await run(["pick","invoice","--max-output","-1"])).code).not.toBe(0);
    const api = ok(await run(["get","invoice","--source","api","--json"]));
    expect(api.markdown).toContain("| Amount | Verify |"); expect(api.resources).toEqual(["references/policy.md","scripts/check.sh"]);
    expect(api.markdown).toContain("references/policy.md");
    const local = ok(await run(["get","invoice","--source","local","--json"])); expect(local.markdown).toEqual(api.markdown); expect(local.revision).toBe(api.revision);
    ok(await run(["refresh","--json"])); online = false; const before = calls.length;
    expect(ok(await run(["guide","--source","local","--json"])).guide).toBe("Our skills guidance");
    expect(ok(await run(["get","invoice","--source","local","--json"])).markdown).toEqual(api.markdown);
    expect((await run(["get","draft-only","--include-drafts","--source","local"])).err).toContain("uncached skill");
    expect(calls.length).toBe(before);
    expect((await run(["get","invoice","--source","local"],undefined,{CRAFT_LIB_STATE:join(root,"isolated")})).code).not.toBe(0);
    const unavailable = await run(["hook", "--harness", "claude", "--source", "api"], JSON.stringify({ prompt: "monthly invoices" }));
    expect(unavailable.code).toBe(0); expect(unavailable.json().hookSpecificOutput.additionalContext).toBe(""); expect(unavailable.err).toContain("hook unavailable");
    online = true;
    const hook = ok(await run(["hook","--harness","codex"],JSON.stringify({hook_event_name:"UserPromptSubmit",prompt:"monthly invoices",session_id:"session"})));
    expect(hook.hookSpecificOutput.additionalContext).toContain("Invoice rules 1");
    const hookClaude = ok(await run(["hook","--harness","claude"],JSON.stringify({prompt:"monthly invoices"}))); expect(hookClaude).toEqual(hook);
    const deferred = ok(await run(["pick","invoices","--published","--content","--budget","0","--json"])); expect(deferred.items[0].contentDeferred).toBe(true); expect(deferred.items[0].markdown).toBeUndefined();
    const out=join(root,"export"); ok(await run(["export","invoice","--out",out,"--json"])); expect(await readFile(join(out,"invoice/scripts/check.sh"),"utf8")).toContain("#!/bin/sh"); expect((await run(["export","invoice","--out",out])).code).not.toBe(0);
    const sync=ok(await run(["sync","--json"])); expect(sync.local.written).toBe(true);
    const manifestPath=join(root,"mirror/.craft-skills.json"); const firstStat=await stat(manifestPath);
    const again=ok(await run(["sync","--json"])); expect(again.local.written).toBe(false); expect((await stat(manifestPath)).mtimeMs).toBe(firstStat.mtimeMs);
    await mkdir(join(root,"mirror/manual")); await writeFile(join(root,"mirror/manual/keep.md"),"manual");
    revision=2; name="invoice-monthly"; ok(await run(["sync","--json"])); expect(await Bun.file(join(root,"mirror/invoice/SKILL.md")).exists()).toBe(false); expect(await readFile(join(root,"mirror/manual/keep.md"),"utf8")).toBe("manual");
    const skillPath=join(root,"mirror/invoice-monthly/SKILL.md"); const canonical=await readFile(skillPath,"utf8"); await writeFile(skillPath,"local edit"); expect((await run(["sync","--json"])).err).toContain("changed outside Craft"); expect(await readFile(skillPath,"utf8")).toBe("local edit"); await writeFile(skillPath,canonical);
    bad=true; expect((await run(["sync","--json"])).err).toContain("refusing sync"); expect(await readFile(skillPath,"utf8")).toBe(canonical); bad=false;
    incomplete=true; expect((await run(["sync","--json"])).code).not.toBe(0); expect(await readFile(skillPath,"utf8")).toBe(canonical); incomplete=false;
    bodyFailure=true; expect((await run(["refresh","--json"])).code).not.toBe(0); expect(ok(await run(["get",name,"--source","local","--json"])).markdown).toBe(canonical); bodyFailure=false;
    const aliases=join(root,"alias"); await symlink(join(root,"mirror"),aliases); expect((await run(["sync","--out",aliases,"--json"])).err).toContain("symlink");
    status="archived"; ok(await run(["sync","--json"])); expect(await Bun.file(skillPath).exists()).toBe(false); expect(await readFile(join(root,"mirror/manual/keep.md"),"utf8")).toBe("manual");
    expect((await readdir(join(root,".mirror.craft-history"))).length).toBeGreaterThan(1);
  } finally { server.stop(true); await rm(root,{recursive:true,force:true}); }
}, 30000);

test("Jev sees the complete eligible query and applies the cap after relevance", async () => {
  const items = Array.from({length:70},(_,i)=>({id:`item-${i}`,name:`skill-${i}`,title:`Skill ${i}`,description:"Candidate instructions",tags:[],status:"published"}));
  const seen: string[] = [];
  const mockFetch: any = async (_url:any, init:any) => {
    const request = JSON.parse(init.body); seen.push(...request.state.candidates.map((e:any)=>e.id));
    return Response.json({ answers: Object.fromEntries(request.state.candidates.map((e:any,i:number)=>[`skill_${i}`,{noul:e.id==="item-69"?0.99:0.1}])) });
  };
  const result=await pickSkills({items,rejected:[]},"request",{jev:true,key:"fixture",maxOutput:1,fetch:mockFetch});
  expect(seen).toEqual(items.map(e=>e.id)); expect(result.items[0]?.id).toBe("item-69");
  const failure:any=async()=>Response.json({}, {status:503});
  const fallback=await pickSkills({items,rejected:[]},"skill 69",{jev:true,key:"fixture",fallback:true,fetch:failure});
  expect(fallback.selector.used).toBe("keywords"); expect(fallback.selector.fallback).toContain("503");
  await expect(pickSkills({items,rejected:[]},"request",{jev:true,key:"fixture",fetch:failure})).rejects.toThrow("503");
});
