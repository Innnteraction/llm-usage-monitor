import type { App, WebContents } from "electron";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync } from "node:fs";

export const configureRuntime = (
  app: Pick<App, "getPath" | "setPath" | "commandLine">,
  env: NodeJS.ProcessEnv,
  devServer: boolean,
  platform = process.platform,
) => {
  const isDevMode = devServer || env.LLM_USAGE_MONITOR_DEV === "1";
  const packagedSmoke = env.LLM_USAGE_MONITOR_CLAUDE_PACKAGED_SMOKE === "1";
  const isTest = env.LLM_USAGE_MONITOR_E2E === "1" || packagedSmoke;
  const testData = isTest
    ? env.LLM_USAGE_MONITOR_E2E_USER_DATA ?? path.join(tmpdir(), `llm-usage-monitor-smoke-${process.pid}`)
    : undefined;
  const isolatedData = testData ?? (isDevMode
    ? path.join(app.getPath("appData"), "llm-usage-monitor-dev")
    : undefined);
  if (isolatedData) {
    mkdirSync(isolatedData, { recursive: true });
    app.setPath("userData", path.resolve(isolatedData));
    app.setPath("sessionData", path.resolve(isolatedData));
  }
  // 기본은 GPU 샌드박스 활성화. 0은 개발/테스트 비교에서만 쓰는 명시적 우회다.
  const gpuSandboxBypass = platform === "win32" && (isDevMode || isTest) &&
    env.LLM_USAGE_MONITOR_GPU_SANDBOX === "0";
  if (gpuSandboxBypass) app.commandLine.appendSwitch("disable-gpu-sandbox");

  // [플랫폼 공통] V8 힙 상한을 64MB로 제한하여 힙 팽창 방지 및 보조 프로세스 통합
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=64 --expose-gc");
  app.commandLine.appendSwitch("renderer-process-limit", "1");
  app.commandLine.appendSwitch("disable-features", "AudioServiceOutOfProcess,CalculateNativeWinOcclusion");

  // [Windows 전용] 2D 유틸리티 UI이므로 GPU 프로세스를 꺼서 80~110MB 즉시 절감
  // macOS에서는 Metal 컴포지팅 및 배터리/투명도 무결성을 위해 절대 적용하지 않는다.
  if (platform === "win32") {
    app.commandLine.appendSwitch("disable-gpu");
    app.commandLine.appendSwitch("disable-software-rasterizer");
  }

  return { isDevMode, gpuSandboxBypass };
};

export const registerRuntimeDiagnostics = (app: App, mode: "hmr" | "packaged" | "unpackaged"): void => {
  console.info("[runtime]", JSON.stringify({
    event: "starting", mode, electron: process.versions.electron,
    chromium: process.versions.chrome, arch: process.arch,
    gpuSandboxBypass: app.commandLine.hasSwitch("disable-gpu-sandbox"),
  }));
  app.on("child-process-gone", (_event, details) => {
    console.error("[runtime]", JSON.stringify({
      event: "child-process-gone", type: details.type,
      reason: details.reason, exitCode: details.exitCode,
    }));
  });
};

export const registerRendererDiagnostics = (contents: WebContents): void => {
  contents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
    console.error("[runtime]", JSON.stringify({ event: "did-fail-load", errorCode, isMainFrame }));
  });
  contents.on("preload-error", () => {
    console.error('[runtime] {"event":"preload-error"}');
  });
  contents.on("render-process-gone", (_event, details) => {
    console.error("[runtime]", JSON.stringify({
      event: "render-process-gone", reason: details.reason, exitCode: details.exitCode,
    }));
  });
  contents.on("console-message", (details) => {
    // 콘솔 본문·URL·파일 경로는 계정 및 민감값을 포함할 수 있어 중계하지 않는다.
    if (details.level === "error") {
      console.error('[runtime] {"event":"renderer-console-error"}');
    }
  });
};
