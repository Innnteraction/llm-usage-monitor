import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { expect, it, vi } from "vitest";
import { CodexLocalUsageScanner, ClaudeLocalUsageScanner, LocalUsageCheckpointStore } from "../../src/local-usage/index";
import { acquireSharedLock, SnapshotCache, SNAPSHOT_CACHE_FILENAME } from "../../src/main/index";

it("shares token checkpoints Node → Rust → Node and excludes competing runtimes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shared-cache-fixture-"));
  const executable = path.resolve(`target/debug/cache-fixture${process.platform === "win32" ? ".exe" : ""}`);
  try {
    await mkdir(path.join(root, "codex")); await mkdir(path.join(root, "claude"));
    const index = path.join(root, "local-usage-index-v2.json");
    const codexFile = path.join(root, "codex", "fake.jsonl");
    const claudeFile = path.join(root, "claude", "fake.jsonl");
    const codex = (input: number) => JSON.stringify({ type:"event_msg", timestamp:"2026-09-01T00:00:00Z", payload:{type:"token_count",info:{total_token_usage:{input_tokens:input,output_tokens:2,cached_input_tokens:1,total_tokens:input+2}}}})+"\n";
    const claude = (output: number) => JSON.stringify({type:"assistant",timestamp:"2026-09-01T00:00:00Z",message:{id:"synthetic-message",usage:{input_tokens:10,output_tokens:output,cache_read_input_tokens:5}}})+"\n";
    await writeFile(codexFile,codex(10)); await writeFile(claudeFile,claude(2));
    const scanNode = async () => {
      const checkpointStore = new LocalUsageCheckpointStore(index);
      const signal = new AbortController().signal;
      return {codex:await new CodexLocalUsageScanner({checkpointStore,rootPath:path.join(root,"codex")}).scan(signal),claude:await new ClaudeLocalUsageScanner({checkpointStore,rootPath:path.join(root,"claude")}).scan(signal)};
    };
    const first = await scanNode();
    expect(first.codex.totalTokens).toBe(12); expect(first.claude.totalTokens).toBe(17);
    const before = JSON.parse(await readFile(index,"utf8"));
    expect((await new LocalUsageCheckpointStore(index).load()).providers.codex.summary?.calculatedAt).toBe(first.codex.calculatedAt);
    const rust = () => JSON.parse(execFileSync(executable,["scan",root,root],{encoding:"utf8",windowsHide:true}));
    const unchanged = rust();
    const after = JSON.parse(await readFile(index,"utf8"));
    for (const id of ["codex","claude"] as const) {
      expect(unchanged[id].totalTokens).toBe(first[id].totalTokens);
      const old = Object.values(before.providers[id].files)[0] as Record<string,unknown>;
      const next = Object.values(after.providers[id].files)[0] as Record<string,unknown>;
      for (const field of ["fileKey","identity","boundaryHash","offset"]) expect(next[field]).toEqual(old[field]);
    }
    await appendFile(codexFile,codex(25)); await appendFile(claudeFile,claude(7));
    await writeFile(path.join(root,"claude","duplicate.jsonl"),claude(3));
    const appended=rust(); expect(appended.codex.totalTokens).toBe(27); expect(appended.claude.totalTokens).toBe(22);
    const parser=vi.spyOn(JSON,"parse");
    const last=await scanNode();
    expect(parser.mock.calls.some(([line]) => typeof line === "string" && (line === codex(10).trim() || line === codex(25).trim() || line === claude(7).trim()))).toBe(false);
    parser.mockRestore(); expect(last.codex.totalTokens).toBe(27); expect(last.claude.totalTokens).toBe(22);
    const raw=await readFile(index,"utf8"); expect(raw).not.toContain("synthetic-message"); expect(raw).not.toContain("fake.jsonl"); expect(raw).not.toContain(root);
    // Rewrite with equal byte length, truncate, unfinished UTF-8, completion, deletion, overflow.
    await writeFile(codexFile,codex(35));
    await writeFile(claudeFile,claude(4));
    expect(rust().codex.totalTokens).toBe(37);
    expect((await scanNode()).claude.totalTokens).toBe(19);
    await writeFile(codexFile,codex(5));
    expect((await scanNode()).codex.totalTokens).toBe(7);
    expect(rust().codex.totalTokens).toBe(7);
    const utf8=Buffer.from('{"note":"'+"x".repeat(8190)+'한글"}\n');
    const split=utf8.indexOf(Buffer.from("한"))+1;
    await appendFile(codexFile,utf8.subarray(0,split));
    expect(rust().codex.totalTokens).toBe(7);
    expect((await scanNode()).codex.partial).toBe(false);
    await appendFile(codexFile,utf8.subarray(split));
    await appendFile(codexFile,codex(8));
    expect((await scanNode()).codex.totalTokens).toBe(10);
    expect(rust().codex.totalTokens).toBe(10);
    await appendFile(codexFile,codex(Number.MAX_SAFE_INTEGER+1));
    expect(rust().codex.partial).toBe(true);
    expect((await scanNode()).codex.totalTokens).toBe(10);
    await rm(codexFile);
    expect(rust().codex.totalTokens).toBe(0);
    expect((await scanNode()).codex.totalTokens).toBe(0);
    // Equal-size in-place correction must reset the aggregate too.
    await writeFile(codexFile,codex(10)); await scanNode();
    await writeFile(codexFile,codex(20));
    expect(rust().codex.totalTokens).toBe(22);
    expect((await scanNode()).codex.totalTokens).toBe(22);
    await writeFile(index,JSON.stringify({schemaVersion:999,providers:{}}));
    expect((await new LocalUsageCheckpointStore(index).load()).providers.codex.files).toEqual({});
    expect(rust().codex.totalTokens).toBe(22);
    expect((await scanNode()).codex.totalTokens).toBe(22);
    const lock=await acquireSharedLock(root);
    try { expect(() => execFileSync(executable,["lock",root,root],{windowsHide:true,stdio:"pipe"})).toThrow(); }
    finally { await new Promise<void>(resolve => lock.close(() => resolve())); }
  } finally { await rm(root,{recursive:true,force:true}); }
}, 30_000);


it("round-trips sanitized quota, rejects corrupt versions, and recovers after writer termination", async () => {
  const root=await mkdtemp(path.join(tmpdir(),"quota-cross-fixture-"));
  const executable=path.resolve(`target/debug/cache-fixture${process.platform === "win32" ? ".exe" : ""}`);
  try {
    const fixture=JSON.parse(await readFile(path.resolve(".work/parity-reference/snapshot.json"),"utf8"));
    const file=path.join(root,SNAPSHOT_CACHE_FILENAME);
    const cache=new SnapshotCache(file);
    await cache.save(fixture);
    const original=await readFile(file,"utf8");
    const restored=JSON.parse(execFileSync(executable,["quota",root,root],{encoding:"utf8",windowsHide:true}));
    expect(restored).toHaveLength(3);
    expect(restored.every((p:{status:string})=>p.status==="stale")).toBe(true);
    const node=await cache.load();
    expect(node.map(p=>p.quotaWindows)).toEqual(restored.map((p:{quotaWindows:unknown})=>p.quotaWindows));
    expect(Date.parse(node[0]?.lastSuccessfulAt ?? "")).toBe(Date.parse(fixture.providers[0].lastSuccessfulAt));
    expect(await readFile(file,"utf8")).not.toContain("accountLabel");
    expect(await readFile(file,"utf8")).not.toContain("serviceStatus");
    for (const invalid of ["{broken", JSON.stringify({schemaVersion:999,providers:[]})]) {
      await writeFile(file,invalid);
      expect(await cache.load()).toEqual([]);
      expect(JSON.parse(execFileSync(executable,["quota",root,root],{encoding:"utf8",windowsHide:true}))).toEqual([]);
    }
    await writeFile(file,original);
    const child=spawn(executable,["incomplete-write",root,root],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
    try {
      await new Promise<void>((resolve,reject)=>{ child.once("error",reject);child.stdout.once("data",()=>resolve());child.once("exit",()=>reject(new Error("fixture exited before temporary write"))); });
      await expect(acquireSharedLock(root)).rejects.toThrow();
      const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));
      child.kill(); await exited;
    } finally { if(child.exitCode===null && child.signalCode===null) child.kill(); }
    expect(await readFile(file,"utf8")).toBe(original);
    expect(await cache.load()).toHaveLength(3);
    const lock=await acquireSharedLock(root);
    await new Promise<void>(resolve=>lock.close(()=>resolve()));
    // A file where a directory is required produces a deterministic write failure.
    const blocked=path.join(root,"blocked");await writeFile(blocked,"fixture");
    await expect(new SnapshotCache(path.join(blocked,SNAPSHOT_CACHE_FILENAME)).save(fixture)).resolves.toBeUndefined();
    const failedIndex=new LocalUsageCheckpointStore(path.join(blocked,"local-usage-index-v2.json"));
    await expect(failedIndex.updateProvider("codex",()=>({files:{}}))).resolves.toBeDefined();
    const failedScan=JSON.parse(execFileSync(executable,["scan",blocked,root],{encoding:"utf8",windowsHide:true}));
    expect(failedScan.codex.totalTokens).toBe(0);
  } finally {await rm(root,{recursive:true,force:true});}
},30_000);
