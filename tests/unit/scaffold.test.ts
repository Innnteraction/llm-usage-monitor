import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildClaudeSetupLaunch } from "../../src/main/index";

describe("development scaffold", () => {
  it("runs the unit test toolchain", () => {
    expect(true).toBe(true);
  });

  it("pins the renderer development server to the local 17321 port", () => {
    const config = readFileSync(
      path.resolve(import.meta.dirname, "../../vite.renderer.config.mts"),
      "utf8",
    );

    expect(config).toContain('host: "127.0.0.1"');
    expect(config).toContain("port: 17321");
    expect(config).toContain("strictPort: true");
  });

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
    expect(macLogin).toMatchObject({
      command: "open",
      args: ["-a", "Terminal"],
    });
    const macTrust = buildClaudeSetupLaunch("trust_probe", "/Users/safe-probe", "darwin");
    expect(macTrust.workingDirectory).toBe("/Users/safe-probe");
    expect(macTrust).toMatchObject({
      command: "open",
      args: ["-a", "Terminal", "/Users/safe-probe"],
    });
  });
});
