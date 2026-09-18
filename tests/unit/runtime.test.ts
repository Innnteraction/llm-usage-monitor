import { EventEmitter } from "node:events";
import path from "node:path";
import type { App, WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { configureRuntime, registerRendererDiagnostics, registerRuntimeDiagnostics } from "../../src/main/index";

const harness = () => {
  const app = {
    getPath: vi.fn(() => path.resolve("test-results", "runtime profiles")),
    setPath: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(), hasSwitch: () => false,
      appendArgument: vi.fn(), getSwitchValue: () => "", removeSwitch: vi.fn(),
    },
  };
  return app;
};

describe("runtime isolation", () => {
  it.each([true, false])("isolates both development entrypoints (Vite=%s)", (vite) => {
    const app = harness();
    const result = configureRuntime(app, vite ? {} : { LLM_USAGE_MONITOR_DEV: "1" }, vite, "win32");
    expect(result.isDevMode).toBe(true);
    const directory = path.resolve("test-results", "runtime profiles", "llm-usage-monitor-dev");
    expect(app.setPath.mock.calls).toEqual([["userData", directory], ["sessionData", directory]]);
  });

  it("gives explicit test data priority over development data", () => {
    const app = harness();
    const directory = path.resolve("test-results", "fake profile");
    configureRuntime(app, {
      LLM_USAGE_MONITOR_DEV: "1", LLM_USAGE_MONITOR_E2E: "1",
      LLM_USAGE_MONITOR_E2E_USER_DATA: directory,
    }, false, "win32");
    expect(app.setPath.mock.calls).toEqual([["userData", directory], ["sessionData", directory]]);
  });

  it("preserves installed app paths and ignores diagnostic override in production", () => {
    const app = harness();
    configureRuntime(app, { LLM_USAGE_MONITOR_GPU_SANDBOX: "0" }, false, "win32");
    expect(app.setPath).not.toHaveBeenCalled();
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-gpu-sandbox");
  });

  it("keeps the GPU sandbox enabled unless a development comparison explicitly bypasses it", () => {
    const app = harness();
    configureRuntime(app, { LLM_USAGE_MONITOR_DEV: "1", LLM_USAGE_MONITOR_GPU_SANDBOX: "1" }, false, "win32");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-gpu-sandbox");
    configureRuntime(app, {}, false, "darwin");
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-gpu-sandbox");
    configureRuntime(app, { LLM_USAGE_MONITOR_DEV: "1", LLM_USAGE_MONITOR_GPU_SANDBOX: "0" }, false, "win32");
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu-sandbox");
  });

  it("applies memory switches cross-platform and isolates GPU disabling to Windows", () => {
    const winApp = harness();
    configureRuntime(winApp, {}, false, "win32");
    expect(winApp.commandLine.appendSwitch).toHaveBeenCalledWith("js-flags", "--max-old-space-size=64 --expose-gc");
    expect(winApp.commandLine.appendSwitch).toHaveBeenCalledWith("renderer-process-limit", "1");
    expect(winApp.commandLine.appendSwitch).toHaveBeenCalledWith("disable-gpu");
    expect(winApp.commandLine.appendSwitch).toHaveBeenCalledWith("disable-software-rasterizer");

    const macApp = harness();
    configureRuntime(macApp, {}, false, "darwin");
    expect(macApp.commandLine.appendSwitch).toHaveBeenCalledWith("js-flags", "--max-old-space-size=64 --expose-gc");
    expect(macApp.commandLine.appendSwitch).toHaveBeenCalledWith("renderer-process-limit", "1");
    expect(macApp.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-gpu");
    expect(macApp.commandLine.appendSwitch).not.toHaveBeenCalledWith("disable-software-rasterizer");
  });
});

it("diagnoses failures without forwarding arbitrary messages or paths", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    const contents = new EventEmitter();
    const app = Object.assign(new EventEmitter(), harness());
    registerRuntimeDiagnostics(app as unknown as App, "packaged");
    registerRendererDiagnostics(contents as unknown as WebContents);
    contents.emit("console-message", { level: "error", message: "PRIVATE_SENTINEL", sourceId: "PRIVATE_SENTINEL" });
    contents.emit("preload-error", {}, "PRIVATE_SENTINEL", new Error("PRIVATE_SENTINEL"));
    contents.emit("did-fail-load", {}, -102, "PRIVATE_SENTINEL", "PRIVATE_SENTINEL", true);
    contents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 123 });
    app.emit("child-process-gone", {}, { type: "GPU", reason: "crashed", exitCode: 456 });
    const output = JSON.stringify([...errors.mock.calls, ...info.mock.calls]);
    expect(output).not.toContain("PRIVATE_SENTINEL");
    for (const event of ["did-fail-load", "preload-error", "render-process-gone", "child-process-gone", "renderer-console-error"]) {
      expect(output).toContain(event);
    }
  } finally { errors.mockRestore(); info.mockRestore(); }
});
