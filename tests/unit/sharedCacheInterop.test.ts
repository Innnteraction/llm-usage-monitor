import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { CodexLocalUsageScanner, ClaudeLocalUsageScanner, LocalUsageCheckpointStore } from "../../src/local-usage/index";
import { acquireSharedLock } from "../../src/main/index";

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
    const last=await scanNode(); expect(last.codex.totalTokens).toBe(27); expect(last.claude.totalTokens).toBe(22);
    const raw=await readFile(index,"utf8"); expect(raw).not.toContain("synthetic-message"); expect(raw).not.toContain("fake.jsonl"); expect(raw).not.toContain(root);
    const lock=await acquireSharedLock(root);
    try { expect(() => execFileSync(executable,["lock",root,root],{windowsHide:true,stdio:"pipe"})).toThrow(); }
    finally { await new Promise<void>(resolve => lock.close(() => resolve())); }
  } finally { await rm(root,{recursive:true,force:true}); }
}, 30_000);
