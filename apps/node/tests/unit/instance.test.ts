import { createConnection, type Server } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { acquireSharedLock, sharedLockPort } from "../../src/storage/index";
import { handleInstanceConnection, instanceFailureMessage, isHiddenLaunch, requestExistingInstance } from "../../src/main/instance";

const close = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));
const directory = async (): Promise<string> => {
  // Windows can reserve parts of the dynamic port range (e.g. Hyper-V).
  for (let attempt = 0; attempt < 100; attempt++) {
    const root = path.join(tmpdir(), `instance-${randomUUID()}`);
    try { await close(await acquireSharedLock(root)); return root; }
    catch (error) {
      if (!["EACCES", "EADDRINUSE"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  throw new Error("No available fixture lock port");
};

describe("instance activation", () => {
  it("shows the existing app only for manual requests and releases the lock", async () => {
    const root = await directory();
    const show = vi.fn();
    const server = await acquireSharedLock(root, (socket) => handleInstanceConnection(socket, show));
    try {
      expect(await requestExistingInstance(root, false)).toBe("accepted");
      expect(show).not.toHaveBeenCalled();
      expect(await requestExistingInstance(root, true)).toBe("accepted");
      expect(show).toHaveBeenCalledTimes(1);
      await expect(acquireSharedLock(root)).rejects.toThrow();
    } finally { await close(server); }
    await close(await acquireSharedLock(root));
  });

  it("identifies another variant and rejects old or unrelated listeners", async () => {
    const root = await directory();
    for (const [response, expected] of [
      ["llm-usage-monitor/1 rust different\n", "other"],
      ["unexpected\n", "unavailable"], ["", "unavailable"],
      ["x".repeat(65), "unavailable"],
    ] as const) {
      const server = await acquireSharedLock(root, (socket) => {
        socket.on("error", () => socket.destroy());
        socket.once("data", () => socket.end(response));
      });
      try { expect(await requestExistingInstance(root, true)).toBe(expected); }
      finally { await close(server); }
    }
  });

  it("bounds silent peers and does not claim success", async () => {
    const root = await directory();
    const server = await acquireSharedLock(root, (socket) => { socket.resume(); });
    try { expect(await requestExistingInstance(root, true)).toBe("unavailable"); }
    finally { await close(server); }
  });

  it("does not activate for different variants, invalid or oversized requests", async () => {
    const root = await directory();
    const show = vi.fn();
    const server = await acquireSharedLock(root, (socket) => handleInstanceConnection(socket, show));
    try {
      for (const request of ["llm-usage-monitor/1 rust show\n", "invalid\n", "x".repeat(65)]) {
        const response = await new Promise<string>((resolve, reject) => {
          const socket = createConnection({ host: "127.0.0.1", port: sharedLockPort(root) });
          let data = "";
          socket.once("connect", () => socket.write(request));
          socket.on("data", (chunk) => { data += chunk.toString(); });
          socket.once("error", reject);
          socket.once("close", () => resolve(data));
        });
        expect(response).toBe(request.includes("rust") ? "llm-usage-monitor/1 node different\n" : "");
      }
      expect(show).not.toHaveBeenCalled();
    } finally { await close(server); }
  });

  it("distinguishes startup intent and failure categories", () => {
    expect(isHiddenLaunch(["--show"])).toBe(false);
    for (const flag of ["--start-hidden", "--hidden", "--autostart"]) {
      expect(isHiddenLaunch(["--show", flag])).toBe(true);
    }
    expect(instanceFailureMessage("EADDRINUSE", "other")).toContain("Rust");
    expect(instanceFailureMessage("EADDRINUSE", "unavailable")).toContain("응답");
    expect(instanceFailureMessage("EACCES", "unavailable")).toContain("권한");
  });
});
