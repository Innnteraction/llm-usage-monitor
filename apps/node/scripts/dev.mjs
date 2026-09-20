import { spawn } from "node:child_process";
import console from "node:console";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

export function packagedExecutable(projectRoot, platform = process.platform, arch = process.arch) {
  const directory = path.join(projectRoot, "out", `LLM Usage Monitor-${platform}-${arch}`);
  if (platform === "win32") return path.join(directory, "LLM Usage Monitor.exe");
  if (platform === "darwin") {
    return path.join(directory, "LLM Usage Monitor.app", "Contents", "MacOS", "LLM Usage Monitor");
  }
  throw new Error("개발 실행은 Windows와 macOS를 지원합니다.");
}

export async function runDev({ hmr = false, incident = undefined, projectRoot = root, spawnProcess = spawn } = {}) {
  const executable = packagedExecutable(projectRoot);
  const forge = require.resolve("@electron-forge/cli/dist/electron-forge.js");
  const env = { ...process.env, LLM_USAGE_MONITOR_DEV: "1" };
  if (incident) {
    env.LLM_USAGE_MONITOR_MOCK_INCIDENT = String(incident);
  }
  delete env.ELECTRON_RUN_AS_NODE;
  let child;
  let cancelled = false;
  let cleanup;
  const stop = () => {
    cancelled = true;
    if (!child?.pid || child.exitCode !== null || cleanup) return;
    if (process.platform === "win32") {
      // PID로 이 실행기가 시작한 프로세스 트리만 종료한다.
      cleanup = new Promise((resolve) => {
        const killer = spawnProcess("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
          windowsHide: true, stdio: "ignore",
        });
        killer.once("error", resolve);
        killer.once("close", resolve);
      });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* 이미 종료됨 */ }
    }
  };
  const run = (command, args, cwd) => new Promise((resolve, reject) => {
    child = spawnProcess(command, args, {
      cwd, env, stdio: "inherit", windowsHide: true,
      detached: process.platform !== "win32",
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    if (hmr) {
      const code = await run(process.execPath, [forge, "start"], projectRoot);
      return cancelled ? 130 : code;
    }
    console.log("[dev] 현재 소스를 패키징합니다. 변경 반영은 종료 후 pnpm dev를 다시 실행하세요.");
    const buildCode = await run(process.execPath, [forge, "package"], projectRoot);
    if (cancelled) return 130;
    if (buildCode !== 0) {
      console.error("[dev] 패키징 실패: 앱을 실행하지 않았습니다. 기존 개발 앱이 실행 중이면 종료하세요.");
      return buildCode;
    }
    if (!existsSync(executable)) throw new Error("패키징된 실행 파일을 찾을 수 없습니다.");
    console.log("[dev] 패키징된 앱을 개발 전용 프로필로 실행합니다.");
    const code = await run(executable, [], path.dirname(executable));
    return cancelled ? 130 : code;
  } finally {
    await cleanup;
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const hmr = args.includes("--hmr");
  const incidentArg = args.find(
    (arg) => arg.startsWith("--incident") || arg.startsWith("--mock-incident"),
  );
  let incident = undefined;
  if (incidentArg) {
    incident = incidentArg.includes("=") ? incidentArg.split("=")[1] : "claude";
  }

  const isAllowed = (arg) =>
    arg === "--hmr" ||
    arg.startsWith("--incident") ||
    arg.startsWith("--mock-incident");

  if (args.some((arg) => !isAllowed(arg))) {
    console.error("사용법: pnpm dev [--hmr] [--incident[=claude|codex|antigravity|all]]");
    process.exitCode = 1;
  } else {
    runDev({ hmr, incident }).then(
      (code) => { process.exitCode = code; },
      () => { console.error("[dev] 실행 실패: 의존성 설치와 빌드 산출물을 확인하세요."); process.exitCode = 1; },
    );
  }
}
