import { describe, expect, it } from "vitest";
import { buildClaudeSetupLaunch } from "../../src/main/index";

describe("development scaffold", () => {
  it("runs the unit test toolchain", () => {
    expect(true).toBe(true);
  });

  it("builds only the fixed Claude login and trust commands", () => {
    expect(buildClaudeSetupLaunch("login")).toMatchObject({
      command: "wt.exe",
      args: expect.arrayContaining([
        "claude.exe",
        "auth",
        "login",
        "--claudeai",
      ]),
    });
    const trust = buildClaudeSetupLaunch("trust_probe", "C:\\safe-probe");
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
  });
});
