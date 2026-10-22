import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { acquireSharedLock } from "../../src/storage/index";
import { handleInstanceConnection, requestExistingInstance } from "../../src/main/instance";

const executable = path.resolve(import.meta.dirname, `../../../../target/debug/cache-fixture${process.platform === "win32" ? ".exe" : ""}`);

it("identifies Node and Rust in both directions without activating the other variant", async () => {
  let root = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    root = path.join(tmpdir(), `instance-interop-${randomUUID()}`);
    try {
      const probe = await acquireSharedLock(root);
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      break;
    } catch (error) {
      if (attempt === 99 || !["EACCES", "EADDRINUSE"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  const show = vi.fn();
  const node = await acquireSharedLock(root, (socket) => handleInstanceConnection(socket, show));
  try {
    const result = await promisify(execFile)(executable, ["instance-request", root, "show"], { windowsHide: true });
    expect(result.stdout.trim()).toBe("Other");
    expect(show).not.toHaveBeenCalled();
  } finally { await new Promise<void>((resolve) => node.close(() => resolve())); }

  const rust = spawn(executable, ["instance-server", root, root], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise<void>((resolve) => rust.once("exit", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("fixture readiness timeout")), 5000);
      rust.once("error", (error) => { clearTimeout(timeout); reject(error); });
      rust.once("exit", () => { clearTimeout(timeout); reject(new Error("fixture exited before ready")); });
      rust.stdout.once("data", () => { clearTimeout(timeout); resolve(); });
    });
    expect(await requestExistingInstance(root, true)).toBe("other");
    expect(await requestExistingInstance(root, false)).toBe("other");
    const result = await promisify(execFile)(executable, ["instance-request", root, "show"], { windowsHide: true });
    expect(result.stdout.trim()).toBe("Accepted");
  } finally {
    rust.stdin.end("stop\n");
    await exited;
  }
});
