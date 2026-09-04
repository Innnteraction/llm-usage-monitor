import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const nodePtyRuntimeFiles = [
  "LICENSE",
  "package.json",
  path.join("lib", "conpty_console_list_agent.js"),
  path.join("lib", "eventEmitter2.js"),
  path.join("lib", "index.js"),
  path.join("lib", "interfaces.js"),
  path.join("lib", "terminal.js"),
  path.join("lib", "types.js"),
  path.join("lib", "unixTerminal.js"),
  path.join("lib", "utils.js"),
  path.join("lib", "windowsConoutConnection.js"),
  path.join("lib", "windowsPtyAgent.js"),
  path.join("lib", "windowsTerminal.js"),
  path.join("lib", "shared", "conout.js"),
  path.join("lib", "worker", "conoutSocketWorker.js"),
  path.join("prebuilds", "win32-x64", "conpty_console_list.node"),
  path.join("prebuilds", "win32-x64", "conpty.node"),
  path.join("prebuilds", "win32-x64", "pty.node"),
  path.join("prebuilds", "win32-x64", "winpty-agent.exe"),
  path.join("prebuilds", "win32-x64", "winpty.dll"),
  path.join("prebuilds", "win32-x64", "conpty", "conpty.dll"),
  path.join("prebuilds", "win32-x64", "conpty", "OpenConsole.exe"),
];

const config: ForgeConfig = {
  rebuildConfig: {
    onlyModules: [],
  },
  packagerConfig: {
    icon: path.resolve("assets", "icons", "app-icon.ico"),
    asar: {
      unpack: "**/node_modules/node-pty/**/*",
    },
    extraResource: [path.resolve("assets")],
  },
  hooks: {
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      const assetsSource = path.resolve("assets");
      const assetsDestination = path.join(buildPath, "assets");
      await cp(assetsSource, assetsDestination, { recursive: true });

      const source = path.resolve("node_modules", "node-pty");
      const destination = path.join(buildPath, "node_modules", "node-pty");
      await mkdir(destination, { recursive: true });
      await Promise.all(
        nodePtyRuntimeFiles.map(async (runtimeFile) => {
          const target = path.join(destination, runtimeFile);
          await mkdir(path.dirname(target), { recursive: true });
          await cp(path.join(source, runtimeFile), target);
        }),
      );
    },
  },
  makers: [
    new MakerSquirrel({
      name: "llm_usage_monitor",
      exe: "LLM Usage Monitor.exe",
      setupExe: "LLM-Usage-Monitor-Setup.exe",
      setupIcon: path.resolve("assets", "icons", "app-icon.ico"),
      noMsi: true,
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/entry.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "src/preload/index.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
  ],
};

export default config;
