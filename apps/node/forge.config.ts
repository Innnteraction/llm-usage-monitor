import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { chmod, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const assetsRoot = path.resolve(import.meta.dirname, "../../assets");

const commonNodePtyFiles = [
  "LICENSE",
  "package.json",
  path.join("lib", "eventEmitter2.js"),
  path.join("lib", "index.js"),
  path.join("lib", "interfaces.js"),
  path.join("lib", "terminal.js"),
  path.join("lib", "types.js"),
  path.join("lib", "utils.js"),
];

const windowsNodePtyFiles = [
  path.join("lib", "conpty_console_list_agent.js"),
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

const darwinNodePtyFiles = [
  path.join("lib", "unixTerminal.js"),
  path.join("prebuilds", "darwin-arm64", "pty.node"),
  path.join("prebuilds", "darwin-arm64", "spawn-helper"),
  path.join("prebuilds", "darwin-x64", "pty.node"),
  path.join("prebuilds", "darwin-x64", "spawn-helper"),
];

const nodePtyRuntimeFiles = [
  ...commonNodePtyFiles,
  ...(process.platform === "win32" ? windowsNodePtyFiles : darwinNodePtyFiles),
];

const config: ForgeConfig = {
  rebuildConfig: {
    onlyModules: [],
  },
  packagerConfig: {
    icon:
      process.platform === "darwin"
        ? path.resolve(assetsRoot, "icons", "app-icon.icns")
        : path.resolve(assetsRoot, "icons", "app-icon.ico"),
    extendInfo: {
      LSUIElement: true,
      NSAppleEventsUsageDescription:
        "Claude Code 로그인과 probe 폴더 준비를 위해 Terminal을 엽니다.",
    },
    asar: {
      unpack: "**/node_modules/node-pty/**/*",
    },
    extraResource: [assetsRoot],
  },
  hooks: {
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      await cp(path.resolve(import.meta.dirname, "../../LICENSE"), path.join(buildPath, "LICENSE"));
      const assetsSource = assetsRoot;
      const assetsDestination = path.join(buildPath, "assets");
      await cp(assetsSource, assetsDestination, { recursive: true });

      const source = path.dirname(require.resolve("node-pty/package.json"));
      const destination = path.join(buildPath, "node_modules", "node-pty");
      await mkdir(destination, { recursive: true });
      await Promise.all(
        nodePtyRuntimeFiles.map(async (runtimeFile) => {
          const target = path.join(destination, runtimeFile);
          await mkdir(path.dirname(target), { recursive: true });
          await cp(path.join(source, runtimeFile), target);
          if (runtimeFile.endsWith("spawn-helper")) {
            await chmod(target, 0o755);
          }
        }),
      );
    },
  },
  makers: [
    ...(process.platform === "win32"
      ? [
          new MakerSquirrel({
            name: "llm_usage_monitor",
            exe: "LLM Usage Monitor.exe",
            setupExe: "LLM-Usage-Monitor-Setup.exe",
            setupIcon: path.resolve(assetsRoot, "icons", "app-icon.ico"),
            noMsi: true,
          }),
        ]
      : []),
    ...(process.platform === "darwin"
      ? [
          {
            name: "@electron-forge/maker-zip",
            config: {},
            platforms: ["darwin"] as ["darwin"],
          },
        ]
      : []),
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
