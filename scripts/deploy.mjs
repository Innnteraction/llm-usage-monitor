#!/usr/bin/env node
import console from "node:console";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const platform = process.platform;
const rawArgs = process.argv.slice(2);
const projectRoot = path.resolve(__dirname, "..");

if (platform === "darwin") {
  const scriptPath = path.join(projectRoot, "scripts", "deploy-mac.sh");
  const child = spawn("bash", [scriptPath, ...rawArgs], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  child.on("close", (code) => {
    process.exit(code ?? 0);
  });
} else if (platform === "win32") {
  const scriptPath = path.join(projectRoot, "scripts", "deploy-windows.ps1");
  const winArgs = rawArgs.map((arg) => {
    if (arg === "--autostart") return "-AutoStart";
    if (arg === "--skip-build") return "-SkipBuild";
    if (arg === "--no-start") return "-NoStart";
    if (arg === "--uninstall") return "-Uninstall";
    if (arg.startsWith("--install-dir=")) {
      throw new Error("Custom install paths are no longer supported; use scripts/install.");
    }
    return arg;
  });

  const child = spawn(
    "pwsh",
    ["-NoProfile", "-File", scriptPath, ...winArgs],
    {
      cwd: projectRoot,
      stdio: "inherit",
    },
  );
  child.on("error", (error) => {
    console.error(error.code === "ENOENT"
      ? "PowerShell 7 (pwsh) is required. Install Microsoft.PowerShell, then open a new terminal."
      : "Could not start PowerShell 7 for deployment.");
    process.exitCode = 1;
  });
  child.on("close", (code) => {
    process.exit(code ?? 1);
  });
} else {
  console.error(`Unsupported platform for deployment: ${platform}`);
  console.error("Currently supported platforms: macOS (darwin), Windows (win32)");
  process.exit(1);
}
