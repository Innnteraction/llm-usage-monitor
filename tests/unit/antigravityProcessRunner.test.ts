import { describe, expect, it, vi } from "vitest";
import {
  AntigravityCliRunner,
  type AntigravityChildProcess,
  type AntigravitySpawn,
} from "../../src/providers/antigravity/index";

class FakeChild implements AntigravityChildProcess {
  readonly stdout = {
    on: (_event: "data", listener: (chunk: Buffer | string) => void) => {
      this.stdoutListener = listener;
    },
  };
  readonly stderr = {
    on: (_event: "data", listener: (chunk: Buffer | string) => void) => {
      this.stderrListener = listener;
    },
  };
  killed = false;
  onKill?: () => void;
  private stdoutListener: (chunk: Buffer | string) => void = () => undefined;
  private stderrListener: (chunk: Buffer | string) => void = () => undefined;
  private errorListener: (error: NodeJS.ErrnoException) => void = () => undefined;
  private closeListener: (code: number | null) => void = () => undefined;
  constructor(readonly pid?: number) {}
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): void;
  once(event: "close", listener: (code: number | null) => void): void;
  once(
    event: "error" | "close",
    listener:
      | ((error: NodeJS.ErrnoException) => void)
      | ((code: number | null) => void),
  ): void {
    if (event === "error") this.errorListener = listener as (error: NodeJS.ErrnoException) => void;
    else this.closeListener = listener as (code: number | null) => void;
  }
  kill(): boolean {
    this.killed = true;
    this.onKill?.();
    return true;
  }
  emitStdout(value: Buffer | string): void { this.stdoutListener(Buffer.isBuffer(value) ? value : Buffer.from(value)); }
  emitStderr(value: Buffer | string): void { this.stderrListener(Buffer.isBuffer(value) ? value : Buffer.from(value)); }
  emitError(error: NodeJS.ErrnoException): void { this.errorListener(error); }
  emitClose(code = 0): void { this.closeListener(code); }
}

type Call = { command: string; args: readonly string[]; options: object; child: FakeChild };

function createSpawn(
  taskkill: "close" | "error" | "nonzero" | "hang" = "close",
): { spawn: AntigravitySpawn; calls: Call[] } {
  const calls: Call[] = [];
  const spawn: AntigravitySpawn = (command, args, options) => {
    const child = new FakeChild(command === "agy.exe" ? calls.length + 40 : undefined);
    calls.push({ command, args, options, child });
    if (command === "taskkill") {
      queueMicrotask(() => {
        if (taskkill === "close") child.emitClose();
        if (taskkill === "error") child.emitError(new Error("private taskkill detail") as NodeJS.ErrnoException);
        if (taskkill === "nonzero") child.emitClose(1);
      });
    }
    return child;
  };
  return { spawn, calls };
}

async function nextCall(calls: Call[], index: number): Promise<Call> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const call = calls[index];
    if (call) return call;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("expected process call");
}

async function completeSupportedRun(calls: Call[], usage = '{"status":"success"}'): Promise<void> {
  const version = await nextCall(calls, 0);
  version.child.emitStdout("v1.1.25"); version.child.emitClose();
  const usageCall = await nextCall(calls, 1);
  usageCall.child.emitStdout(usage); usageCall.child.emitClose();
}

describe("AntigravityCliRunner", () => {
  it("runs only the fixed commands in an isolated temporary directory and preserves UTF-8 chunks", async () => {
    const { spawn, calls } = createSpawn();
    const removed: string[] = [];
    const runner = new AntigravityCliRunner({ spawn, createTempDirectory: async () => "C:/temp/agy-unique", removeEmptyDirectory: async (directory) => { removed.push(directory); } });
    const result = runner.readUsage();
    const version = await nextCall(calls, 0);
    expect(version).toMatchObject({ command: "agy.exe", args: ["--version"], options: { cwd: "C:/temp/agy-unique", shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] } });
    version.child.emitStdout("1.1.25"); version.child.emitClose();
    const usage = await nextCall(calls, 1);
    expect(usage).toMatchObject({ command: "agy.exe", args: ["--print", "/usage", "--output-format", "json", "--print-timeout", "20s"] });
    usage.child.emitStdout(Buffer.from('{"label":"')); usage.child.emitStdout(Buffer.from([0xEA, 0xB0])); usage.child.emitStdout(Buffer.from([0x80, 0x22, 0x7D])); usage.child.emitClose();
    await expect(result).resolves.toBe('{"label":"가"}');
    expect(removed).toEqual(["C:/temp/agy-unique"]);
  });

  it("rejects versions older than 1.1.11 without invoking usage, while accepting newer patches", async () => {
    const old = createSpawn();
    const oldRunner = new AntigravityCliRunner({ spawn: old.spawn, createTempDirectory: async () => "C:/temp/old", removeEmptyDirectory: async () => undefined });
    const oldResult = oldRunner.readUsage();
    (await nextCall(old.calls, 0)).child.emitStdout("1.1.10"); old.calls[0]!.child.emitClose();
    await expect(oldResult).rejects.toMatchObject({ reason: "unsupported" });
    expect(old.calls).toHaveLength(1);

    const current = createSpawn();
    const currentRunner = new AntigravityCliRunner({ spawn: current.spawn, createTempDirectory: async () => "C:/temp/new", removeEmptyDirectory: async () => undefined });
    const currentResult = currentRunner.readUsage();
    await completeSupportedRun(current.calls);
    await expect(currentResult).resolves.toBe('{"status":"success"}');
  });

  it("classifies missing executables, spawn throws, non-closing errors, and service output without exposing secrets", async () => {
    const missing = createSpawn();
    const missingRunner = new AntigravityCliRunner({ spawn: missing.spawn, createTempDirectory: async () => "C:/temp/missing", removeEmptyDirectory: async () => undefined });
    const missingResult = missingRunner.readUsage();
    (await nextCall(missing.calls, 0)).child.emitError(Object.assign(new Error("private executable detail"), { code: "ENOENT" }));
    await expect(missingResult).rejects.toMatchObject({ reason: "not_installed", message: "Antigravity CLI is not installed or is not available on PATH." });

    const thrownRunner = new AntigravityCliRunner({ spawn: () => { throw new Error("private path"); }, createTempDirectory: async () => "C:/temp/throw", removeEmptyDirectory: async () => undefined });
    await expect(thrownRunner.readUsage()).rejects.toMatchObject({ reason: "process_failed" });

    const directoryRunner = new AntigravityCliRunner({
      createTempDirectory: async () => {
        throw new Error("private directory detail");
      },
    });
    await expect(directoryRunner.readUsage()).rejects.toMatchObject({
      reason: "process_failed",
      message: "Antigravity CLI stopped during quota refresh.",
    });

    const auth = createSpawn();
    const authRunner = new AntigravityCliRunner({ spawn: auth.spawn, createTempDirectory: async () => "C:/temp/auth", removeEmptyDirectory: async () => undefined });
    const authResult = authRunner.readUsage();
    const authVersion = await nextCall(auth.calls, 0); authVersion.child.emitStderr("login required private detail"); authVersion.child.emitError(new Error("private") as NodeJS.ErrnoException);
    await expect(authResult).rejects.toMatchObject({ reason: "not_authenticated", message: "Sign in with the Antigravity CLI to view quota." });
  });

  it.each([
    ["429 rate limit", "rate_limited"],
    ["network connection failed", "network"],
    ["unexpected failure", "process_failed"],
  ] as const)("classifies nonzero CLI output as %s", async (output, reason) => {
    const fake = createSpawn();
    const runner = new AntigravityCliRunner({
      spawn: fake.spawn,
      createTempDirectory: async () => "C:/temp/nonzero",
      removeEmptyDirectory: async () => undefined,
    });
    const result = runner.readUsage();
    const version = await nextCall(fake.calls, 0);
    version.child.emitStderr(output);
    version.child.emitClose(1);
    await expect(result).rejects.toMatchObject({ reason });
  });

  it("rejects malformed usage JSON and stderr overflow as unsupported output", async () => {
    const malformed = createSpawn();
    const malformedRunner = new AntigravityCliRunner({
      spawn: malformed.spawn,
      createTempDirectory: async () => "C:/temp/malformed",
      removeEmptyDirectory: async () => undefined,
    });
    const malformedResult = malformedRunner.readUsage();
    const malformedVersion = await nextCall(malformed.calls, 0);
    malformedVersion.child.emitStdout("1.1.25");
    malformedVersion.child.emitClose();
    const malformedUsage = await nextCall(malformed.calls, 1);
    malformedUsage.child.emitStdout("not json");
    malformedUsage.child.emitClose();
    await expect(malformedResult).rejects.toMatchObject({ reason: "unsupported" });

    const overflow = createSpawn();
    const overflowRunner = new AntigravityCliRunner({
      spawn: overflow.spawn,
      createTempDirectory: async () => "C:/temp/stderr-overflow",
      removeEmptyDirectory: async () => undefined,
    });
    const overflowResult = overflowRunner.readUsage();
    const version = await nextCall(overflow.calls, 0);
    version.child.emitStdout("1.1.25");
    version.child.emitClose();
    const usage = await nextCall(overflow.calls, 1);
    usage.child.emitStderr(Buffer.alloc(256 * 1024 + 1));
    await expect(overflowResult).rejects.toMatchObject({ reason: "unsupported" });
  });

  it("preserves a missing-executable error when a child has no PID", async () => {
    const child = new FakeChild();
    const calls: Call[] = [];
    const runner = new AntigravityCliRunner({
      spawn: ((command, args, options) => {
        calls.push({ command, args, options, child });
        return child;
      }) as AntigravitySpawn,
      createTempDirectory: async () => "C:/temp/no-pid",
      removeEmptyDirectory: async () => undefined,
    });
    const result = runner.readUsage();
    await nextCall(calls, 0);
    child.emitError(Object.assign(new Error("private"), { code: "ENOENT" }));
    await expect(result).rejects.toMatchObject({ reason: "not_installed" });
    expect(calls).toHaveLength(1);
  });

  it("times out or caps output by terminating only the owned process tree", async () => {
    const timeout = createSpawn();
    const timeoutRunner = new AntigravityCliRunner({ spawn: timeout.spawn, createTempDirectory: async () => "C:/temp/timeout", removeEmptyDirectory: async () => undefined, versionTimeoutMs: 1, taskkillTimeoutMs: 10 });
    await expect(timeoutRunner.readUsage()).rejects.toMatchObject({ reason: "timeout" });
    expect(timeout.calls[1]).toMatchObject({ command: "taskkill", args: ["/pid", "40", "/t", "/f"], options: { shell: false, windowsHide: true, stdio: "ignore" } });
    expect(timeout.calls[0]!.child.killed).toBe(true);

    const usageTimeout = createSpawn();
    const usageTimeoutRunner = new AntigravityCliRunner({
      spawn: usageTimeout.spawn,
      createTempDirectory: async () => "C:/temp/usage-timeout",
      removeEmptyDirectory: async () => undefined,
      usageTimeoutMs: 1,
      taskkillTimeoutMs: 10,
    });
    const usageTimeoutResult = usageTimeoutRunner.readUsage();
    const usageVersion = await nextCall(usageTimeout.calls, 0);
    usageVersion.child.emitStdout("1.1.25");
    usageVersion.child.emitClose();
    await nextCall(usageTimeout.calls, 1);
    await expect(usageTimeoutResult).rejects.toMatchObject({ reason: "timeout" });
    expect(usageTimeout.calls[2]).toMatchObject({ command: "taskkill" });

    const overflow = createSpawn();
    const overflowRunner = new AntigravityCliRunner({ spawn: overflow.spawn, createTempDirectory: async () => "C:/temp/overflow", removeEmptyDirectory: async () => undefined });
    const overflowResult = overflowRunner.readUsage();
    const version = await nextCall(overflow.calls, 0); version.child.emitStdout("1.1.25"); version.child.emitClose();
    const usage = await nextCall(overflow.calls, 1); usage.child.emitStdout(Buffer.alloc(256 * 1024 + 1));
    await expect(overflowResult).rejects.toMatchObject({ reason: "unsupported" });
  });

  it("settles after taskkill failure and close aborts active work before preventing future runs", async () => {
    const failedKill = createSpawn("error");
    const failedKillRunner = new AntigravityCliRunner({ spawn: failedKill.spawn, createTempDirectory: async () => "C:/temp/kill", removeEmptyDirectory: async () => undefined, versionTimeoutMs: 1 });
    await expect(failedKillRunner.readUsage()).rejects.toMatchObject({ reason: "process_failed" });

    const closing = createSpawn();
    const removed: string[] = [];
    const runner = new AntigravityCliRunner({ spawn: closing.spawn, createTempDirectory: async () => "C:/temp/close", removeEmptyDirectory: async (directory) => { removed.push(directory); } });
    const reading = runner.readUsage();
    await nextCall(closing.calls, 0);
    await runner.close();
    await expect(reading).rejects.toMatchObject({ reason: "process_failed" });
    await expect(runner.readUsage()).rejects.toMatchObject({ reason: "process_failed" });
    expect(closing.calls.filter(({ command }) => command === "agy.exe")).toHaveLength(1);
    expect(removed).toEqual(["C:/temp/close"]);
  });

  it("bounds a hung taskkill and always kills the owned parent after its tree helper", async () => {
    vi.useFakeTimers();
    try {
      const fake = createSpawn("hang");
      const order: string[] = [];
      const runner = new AntigravityCliRunner({
        spawn: fake.spawn,
        createTempDirectory: async () => "C:/temp/hung-taskkill",
        removeEmptyDirectory: async () => undefined,
        versionTimeoutMs: 10,
        taskkillTimeoutMs: 10,
      });
      const result = runner.readUsage();
      await Promise.resolve();
      await Promise.resolve();
      fake.calls[0]!.child.onKill = () => order.push("parent");
      await vi.advanceTimersByTimeAsync(10);
      const taskkill = fake.calls[1]!;
      taskkill.child.onKill = () => order.push("taskkill");
      await vi.advanceTimersByTimeAsync(10);
      await expect(result).rejects.toMatchObject({ reason: "process_failed" });
      expect(order).toEqual(["taskkill", "parent"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
