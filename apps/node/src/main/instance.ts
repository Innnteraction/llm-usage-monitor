import { createConnection, type Socket } from "node:net";
import { sharedLockPort } from "../storage/index";

// Keep this small wire contract in sync with shell/instance.rs.
const PREFIX = "llm-usage-monitor/1";
const TIMEOUT_MS = 1500;
const MAX_BYTES = 64;

export const isHiddenLaunch = (args: readonly string[]): boolean =>
  args.some((arg) => ["--start-hidden", "--hidden", "--autostart"].includes(arg));

export const handleInstanceConnection = (socket: Socket, show: () => void): void => {
  const timeout = setTimeout(() => socket.destroy(), TIMEOUT_MS);
  socket.once("close", () => clearTimeout(timeout));
  socket.on("error", () => socket.destroy());
  let request = "";
  socket.on("data", (chunk: Buffer) => {
    request += chunk.toString("latin1");
    if (request.length > MAX_BYTES) { socket.destroy(); return; }
    if (!request.includes("\n")) return;
    const match = /^llm-usage-monitor\/1 (node|rust) (show|hidden)\n$/.exec(request);
    if (!match) { socket.destroy(); return; }
    socket.removeAllListeners("data");
    if (match[1] !== "node") {
      socket.end(`${PREFIX} node different\n`);
      return;
    }
    if (match[2] === "show") show();
    socket.end(`${PREFIX} node ok\n`);
  });
};

export type ExistingInstance = "accepted" | "other" | "unavailable";
export const requestExistingInstance = (directory: string, show: boolean): Promise<ExistingInstance> =>
  new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: sharedLockPort(directory) });
    const finish = (result: ExistingInstance): void => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(result);
    };
    const timeout = setTimeout(() => finish("unavailable"), TIMEOUT_MS);
    let response = "";
    socket.once("connect", () => socket.write(`${PREFIX} node ${show ? "show" : "hidden"}\n`));
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("latin1");
      if (response.length > MAX_BYTES) { finish("unavailable"); return; }
      if (!response.includes("\n")) return;
      finish(response === `${PREFIX} node ok\n` ? "accepted"
        : response === `${PREFIX} rust different\n` ? "other" : "unavailable");
    });
    socket.once("error", () => finish("unavailable"));
    socket.once("close", () => finish("unavailable"));
  });

export const instanceFailureMessage = (code: unknown, result: ExistingInstance): string => {
  if (result === "other") return "Rust 버전이 실행 중입니다. 트레이 메뉴에서 종료한 뒤 Node 버전을 실행하세요.";
  if (code === "EADDRINUSE") return "실행 잠금 포트가 사용 중이지만 앱의 응답을 확인하지 못했습니다. 구버전 앱이 실행 중이거나 다른 프로그램이 포트를 사용 중일 수 있습니다. 트레이의 앱을 확인하세요.";
  return "실행 잠금을 확보하지 못했습니다. 로컬 네트워크 권한 또는 포트 사용 제한을 확인하세요.";
};
