import path from "node:path";

export const appPath = process.env.LLM_USAGE_MONITOR_E2E_DEV === "1"
  ? path.resolve(".") : undefined;

export const executablePath = appPath ? undefined : path.resolve(
  "out", `LLM Usage Monitor-${process.platform}-${process.arch}`,
  ...(process.platform === "darwin"
    ? ["LLM Usage Monitor.app", "Contents", "MacOS", "LLM Usage Monitor"]
    : ["LLM Usage Monitor.exe"]),
);

export const appArgs = (args: string[] = []) => appPath ? [appPath, ...args] : args;
