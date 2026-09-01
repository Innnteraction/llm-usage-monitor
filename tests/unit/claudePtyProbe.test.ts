import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyClaudeUsageScreen,
  resolveClaudeProbeDirectory,
} from "../../src/providers/index";

describe("Claude PTY usage screen classification", () => {
  it("uses one stable app-owned probe directory", () => {
    expect(resolveClaudeProbeDirectory("fixture-local-app-data")).toBe(
      path.resolve(
        "fixture-local-app-data",
        "LLM Usage Monitor",
        "claude-probe",
      ),
    );
  });

  it("recognizes session and weekly quota signals", () => {
    expect(
      classifyClaudeUsageScreen(
        "Usage limits\nCurrent session 12% used\nCurrent week 34% used\nResets later",
      ),
    ).toEqual({
      hasFiveHourWindow: true,
      hasWeeklyWindow: true,
      hasQuotaDetails: true,
      requiresLogin: false,
      hasTrustPrompt: false,
    });
  });

  it("does not mistake the echoed slash command for quota output", () => {
    expect(classifyClaudeUsageScreen("> /usage")).toMatchObject({
      hasFiveHourWindow: false,
      hasWeeklyWindow: false,
      hasQuotaDetails: false,
    });
  });

  it("classifies login and workspace trust prompts without retaining text", () => {
    expect(classifyClaudeUsageScreen("Please log in. Run /login.")).toMatchObject({
      requiresLogin: true,
      hasTrustPrompt: false,
    });
    expect(
      classifyClaudeUsageScreen("Do you trust this folder?"),
    ).toMatchObject({
      requiresLogin: false,
      hasTrustPrompt: true,
    });
  });
});
