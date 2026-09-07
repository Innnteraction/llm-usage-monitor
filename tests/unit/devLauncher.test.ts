import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const { runDev, packagedExecutable } = await import(pathToFileURL(path.resolve("scripts/dev.mjs")).href);

describe("packaged development launcher", () => {
  it("never runs an old executable after packaging fails", async () => {
    const spawnProcess = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { pid: 123, exitCode: null });
      queueMicrotask(() => child.emit("close", 7));
      return child;
    });
    expect(await runDev({ spawnProcess })).toBe(7);
    expect(spawnProcess).toHaveBeenCalledTimes(1);
  });

  it("launches the built executable with a separate profile and preserves its exit code", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "llm dev with spaces "));
    try {
      const executable = packagedExecutable(projectRoot);
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, "fake executable, never run");
      let count = 0;
      const spawnProcess = vi.fn(() => {
        const child = new EventEmitter();
        const code = count++ === 0 ? 0 : 23;
        queueMicrotask(() => child.emit("close", code));
        return child;
      });
      expect(await runDev({ projectRoot, spawnProcess })).toBe(23);
      const calls = spawnProcess.mock.calls as unknown as [string, string[], { cwd: string; env: NodeJS.ProcessEnv }][];
      expect(calls[1]?.[0]).toBe(executable);
      expect(calls[1]?.[1]).toEqual([]);
      expect(calls[1]?.[2].cwd).toBe(path.dirname(executable));
      expect(calls[1]?.[2].env.LLM_USAGE_MONITOR_DEV).toBe("1");
      expect(calls[1]?.[2].env.ELECTRON_RUN_AS_NODE).toBeUndefined();
      expect(packagedExecutable(projectRoot, "darwin", "arm64")).toContain(path.join("Contents", "MacOS", "LLM Usage Monitor"));
    } finally { await rm(projectRoot, { recursive: true, force: true }); }
  });

  it("reports spawn failure and unregisters signal handlers", async () => {
    const before = process.listenerCount("SIGINT");
    const spawnProcess = () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("spawn failed")));
      return child;
    };
    await expect(runDev({ spawnProcess })).rejects.toThrow("spawn failed");
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it.skipIf(process.platform !== "win32")("cancels only its owned process tree and does not start the app", async () => {
    const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null });
    const spawnProcess = vi.fn((command: string) => {
      if (command === "taskkill.exe") {
        const killer = new EventEmitter();
        queueMicrotask(() => { killer.emit("close", 0); child.emit("close", 1); });
        return killer;
      }
      queueMicrotask(() => process.emit("SIGINT"));
      return child;
    });
    expect(await runDev({ spawnProcess })).toBe(130);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess).toHaveBeenLastCalledWith("taskkill.exe", ["/pid", "12345", "/t", "/f"], {
      windowsHide: true, stdio: "ignore",
    });
  });
});
