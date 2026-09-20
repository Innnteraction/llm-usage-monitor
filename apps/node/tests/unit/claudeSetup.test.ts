import type { SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { buildClaudeSetupLaunch, openClaudeSetup } from "../../src/main/index";

describe("Claude setup launch", () => {
  it("builds only the fixed Claude login and trust commands", () => {
    expect(buildClaudeSetupLaunch("login", undefined, "win32")).toMatchObject({
      command: "wt.exe",
      args: expect.arrayContaining([
        "claude.exe",
        "auth",
        "login",
        "--claudeai",
      ]),
    });
    const trust = buildClaudeSetupLaunch("trust_probe", "C:\\safe-probe", "win32");
    expect(trust.workingDirectory).toBe("C:\\safe-probe");
    expect(trust.args).toEqual(
      expect.arrayContaining([
        "claude.exe",
        "--safe-mode",
        "--restricted",
        "--strict-mcp-config",
      ]),
    );
    expect(trust.args.join(" ")).not.toContain(
      "dangerously-skip-permissions",
    );

    const macLogin = buildClaudeSetupLaunch("login", undefined, "darwin");
    expect(macLogin.command).toBe("osascript");
    expect(macLogin.args.join(" ")).toContain("claude auth login --claudeai");
    const macTrust = buildClaudeSetupLaunch("trust_probe", "/Users/safe-probe", "darwin");
    expect(macTrust.command).toBe("osascript");
    expect(macTrust.workingDirectory).toBe("/Users/safe-probe");
    expect(macTrust.args.join(" ")).toContain(
      "cd /Users/safe-probe && claude --safe-mode",
    );
    expect(macTrust.args.join(" ")).toContain("--tools ''");
    expect(macTrust.args.join(" ")).not.toContain(
      "dangerously-skip-permissions",
    );
  });

  it("spawns osascript for the macOS login action", async () => {
    type DetachedChild = {
      once(event: "spawn" | "error", listener: () => void): DetachedChild;
      unref(): void;
    };
    const child: DetachedChild = {
      once(event, listener) {
        if (event === "spawn") listener();
        return child;
      },
      unref() {},
    };
    const spawnProcess = vi.fn(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (_command: string, _args: readonly string[], _options: SpawnOptions) =>
        child,
    );
    const result = await openClaudeSetup("login", {
      platform: "darwin",
      spawnProcess,
    });
    expect(result).toEqual({ opened: true });
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnProcess.mock.calls[0]!;
    expect(command).toBe("osascript");
    expect(args[0]).toBe("-e");
    expect(args.join(" ")).toContain("claude auth login --claudeai");
    expect(options).toMatchObject({ detached: true, stdio: "ignore" });
  });
});
