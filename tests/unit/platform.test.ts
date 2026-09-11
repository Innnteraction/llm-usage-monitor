import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getAlwaysOnTopLevel,
  getLaunchAtLoginLabel,
  setupPlatformDock,
  ensurePlatformPath,
  buildTerminalLaunch,
  killProcessTree,
  getExecutableCandidates,
  getPlatformFallbackDirectories,
  findCliBinaryPath,
  resolveCliBinaryPath,
} from "../../src/main/platform/index";
import {
  isMacOS,
  isWindows,
  resolveCliBinary,
  getModifierKeyLabel,
  getModifierKeySymbol,
  isShortcutMatch,
} from "../../src/shared/platform";

describe("shared platform utilities", () => {
  describe("OS detection", () => {
    it("detects macOS by platform string and userAgent", () => {
      expect(isMacOS("darwin", "")).toBe(true);
      expect(isMacOS("win32", "")).toBe(false);
      expect(isMacOS("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
      expect(isMacOS("", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    });

    it("detects Windows by platform string and userAgent", () => {
      expect(isWindows("win32", "")).toBe(true);
      expect(isWindows("darwin", "")).toBe(false);
      expect(isWindows("", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(true);
      expect(isWindows("", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
    });
  });

  describe("resolveCliBinary", () => {
    it("resolves Windows binary extensions correctly", () => {
      expect(resolveCliBinary("claude", "win32")).toBe("claude.exe");
      expect(resolveCliBinary("antigravity", "win32")).toBe("agy.exe");
      expect(resolveCliBinary("codex", "win32")).toBe("codex.exe");
      expect(resolveCliBinary("custom", "win32")).toBe("custom.cmd");
    });

    it("resolves POSIX / macOS binary names correctly", () => {
      expect(resolveCliBinary("claude", "darwin")).toBe("claude");
      expect(resolveCliBinary("antigravity", "darwin")).toBe("agy");
      expect(resolveCliBinary("codex", "darwin")).toBe("codex");
      expect(resolveCliBinary("custom", "darwin")).toBe("custom");
    });
  });

  describe("modifier key presentation and shortcuts", () => {
    it("formats modifier key labels and symbols per OS", () => {
      expect(getModifierKeyLabel(true)).toBe("Cmd");
      expect(getModifierKeyLabel(false)).toBe("Ctrl");
      expect(getModifierKeySymbol(true)).toBe("⌘⇧");
      expect(getModifierKeySymbol(false)).toBe("Ctrl⇧");
    });

    it("matches Windows keyboard shortcuts with Ctrl+Shift", () => {
      const validWin = {
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
        repeat: false,
        isComposing: false,
        code: "KeyC",
      };
      expect(isShortcutMatch(validWin, "KeyC", false)).toBe(true);
      expect(isShortcutMatch(validWin, "KeyT", false)).toBe(false);

      // Meta key on Windows is rejected
      expect(isShortcutMatch({ ...validWin, metaKey: true }, "KeyC", false)).toBe(false);
      // Alt key is rejected
      expect(isShortcutMatch({ ...validWin, altKey: true }, "KeyC", false)).toBe(false);
      // Repeat is rejected
      expect(isShortcutMatch({ ...validWin, repeat: true }, "KeyC", false)).toBe(false);
    });

    it("matches macOS keyboard shortcuts with Cmd+Shift", () => {
      const validMac = {
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false,
        repeat: false,
        isComposing: false,
        code: "KeyT",
      };
      expect(isShortcutMatch(validMac, "KeyT", true)).toBe(true);
      expect(isShortcutMatch(validMac, "KeyC", true)).toBe(false);

      // Ctrl key on Mac is rejected
      expect(isShortcutMatch({ ...validMac, ctrlKey: true }, "KeyT", true)).toBe(false);
    });
  });
});

describe("main process platform adapter", () => {
  describe("getAlwaysOnTopLevel", () => {
    it("returns screen-saver on Windows and status on macOS", () => {
      expect(getAlwaysOnTopLevel("win32")).toBe("screen-saver");
      expect(getAlwaysOnTopLevel("darwin")).toBe("status");
      expect(getAlwaysOnTopLevel("linux")).toBe("floating");
    });
  });

  describe("getLaunchAtLoginLabel", () => {
    it("returns English label by default on Windows and macOS/Linux", () => {
      expect(getLaunchAtLoginLabel("win32")).toBe("Start on Windows login");
      expect(getLaunchAtLoginLabel("darwin")).toBe("Start at login");
      expect(getLaunchAtLoginLabel("linux")).toBe("Start at login");
    });

    it("returns Korean label when requested", () => {
      expect(getLaunchAtLoginLabel("win32", "ko")).toBe("Windows 로그인 시 시작");
      expect(getLaunchAtLoginLabel("darwin", "ko")).toBe("로그인 시 시작");
      expect(getLaunchAtLoginLabel("linux", "ko")).toBe("로그인 시 시작");
    });
  });

  describe("setupPlatformDock", () => {
    it("hides dock on macOS when available", () => {
      const hide = vi.fn();
      setupPlatformDock({ dock: { hide } }, "darwin");
      expect(hide).toHaveBeenCalledOnce();
    });

    it("ignores dock on Windows", () => {
      const hide = vi.fn();
      setupPlatformDock({ dock: { hide } }, "win32");
      expect(hide).not.toHaveBeenCalled();
    });
  });

  describe("ensurePlatformPath", () => {
    it("does not modify PATH on Windows", () => {
      const current = "C:\\Windows\\System32;C:\\Program Files\\nodejs";
      expect(ensurePlatformPath(current, "win32")).toBe(current);
    });

    it("appends standard Mac paths when missing on macOS", () => {
      const current = "/usr/bin:/bin";
      const result = ensurePlatformPath(current, "darwin", "/Users/testuser");
      expect(result).toContain("/opt/homebrew/bin");
      expect(result).toContain("/usr/local/bin");
      expect(result).toContain(path.posix.join("/Users/testuser", ".local", "bin"));
      expect(result).toContain(current);
    });

    it("does not duplicate paths that already exist on macOS", () => {
      const current = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/Users/testuser/.local/bin",
        "/Users/testuser/.cargo/bin",
        "/usr/bin",
      ].join(path.posix.delimiter);
      expect(ensurePlatformPath(current, "darwin", "/Users/testuser")).toBe(current);
    });
  });

  describe("buildTerminalLaunch", () => {
    it("builds Windows Terminal launch for login and probe", () => {
      const login = buildTerminalLaunch("login", "C:\\probe", "win32");
      expect(login.command).toBe("wt.exe");
      expect(login.args).toContain("claude.exe");
      expect(login.args).toContain("auth");

      const probe = buildTerminalLaunch("trust_probe", "C:\\probe", "win32");
      expect(probe.command).toBe("wt.exe");
      expect(probe.workingDirectory).toBe("C:\\probe");
    });

    it("builds macOS Terminal.app launch that runs the fixed login and probe commands", () => {
      const login = buildTerminalLaunch("login", "/Users/test/probe dir", "darwin");
      expect(login.command).toBe("osascript");
      expect(login.args[0]).toBe("-e");
      expect(login.args[1]).toBe(
        'tell application "Terminal" to do script "claude auth login --claudeai"',
      );
      expect(login.args[3]).toBe('tell application "Terminal" to activate');
      expect(login.workingDirectory).toBeUndefined();

      const probe = buildTerminalLaunch("trust_probe", "/Users/test/probe dir", "darwin");
      expect(probe.command).toBe("osascript");
      expect(probe.args[1]).toBe(
        "tell application \"Terminal\" to do script \"cd '/Users/test/probe dir' && claude --safe-mode --ax-screen-reader --restricted --strict-mcp-config --tools ''\"",
      );
      expect(probe.args[3]).toBe('tell application "Terminal" to activate');
      expect(probe.workingDirectory).toBe("/Users/test/probe dir");
      expect(probe.args.join(" ")).not.toContain("dangerously-skip-permissions");
    });

    it("escapes quotes in the macOS probe directory for shell and AppleScript", () => {
      const probe = buildTerminalLaunch(
        "trust_probe",
        '/Users/test/it\'s "probe"',
        "darwin",
      );
      expect(probe.args[1]).toContain(
        "cd '/Users/test/it'\\\\''s \\\"probe\\\"' &&",
      );
    });
  });

  describe("killProcessTree", () => {
    it("returns false for invalid pids", async () => {
      expect(await killProcessTree(0)).toBe(false);
      expect(await killProcessTree(-1)).toBe(false);
      expect(await killProcessTree(NaN)).toBe(false);
    });

    it("spawns taskkill on Windows", async () => {
      const spawnMock = vi.fn().mockImplementation(() => {
        const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
        const child = {
          once: (event: string, cb: (...args: unknown[]) => void) => {
            listeners[event] ??= [];
            listeners[event].push(cb);
            return child;
          },
          kill: vi.fn(),
        };
        setTimeout(() => {
          listeners["close"]?.[0]?.(0);
        }, 5);
        return child;
      });

      const success = await killProcessTree(1234, {
        platform: "win32",
        spawn: spawnMock as unknown as typeof import("node:child_process").spawn,
      });
      expect(success).toBe(true);
      expect(spawnMock).toHaveBeenCalledWith(
        "taskkill",
        ["/pid", "1234", "/t", "/f"],
        expect.any(Object),
      );
    });

    it("uses process.kill on POSIX / macOS", async () => {
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      const success = await killProcessTree(5678, { platform: "darwin" });
      expect(success).toBe(true);
      expect(killSpy).toHaveBeenCalledWith(-5678, "SIGKILL");
      killSpy.mockRestore();
    });
  });

  describe("binary resolution and discovery", () => {
    describe("getExecutableCandidates", () => {
      it("returns Windows executable candidate names with priority on .exe", () => {
        expect(getExecutableCandidates("codex", "win32")).toEqual([
          "codex.exe",
          "codex.cmd",
          "codex.bat",
          "codex",
        ]);
        expect(getExecutableCandidates("antigravity", "win32")).toEqual([
          "agy.exe",
          "agy.cmd",
          "agy.bat",
          "agy",
        ]);
        expect(getExecutableCandidates("claude", "win32")).toEqual([
          "claude.exe",
          "claude.cmd",
          "claude.bat",
          "claude",
        ]);
        expect(getExecutableCandidates("custom", "win32")).toEqual([
          "custom.exe",
          "custom.cmd",
          "custom.bat",
          "custom",
        ]);
      });

      it("returns POSIX candidate names on non-Windows", () => {
        expect(getExecutableCandidates("codex", "darwin")).toEqual(["codex"]);
        expect(getExecutableCandidates("antigravity", "darwin")).toEqual(["agy"]);
        expect(getExecutableCandidates("claude", "linux")).toEqual(["claude"]);
      });
    });

    describe("getPlatformFallbackDirectories", () => {
      it("includes OpenAI/Codex/bin and other standard directories on Windows", () => {
        const dirs = getPlatformFallbackDirectories("win32", {
          LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
          APPDATA: "C:\\Users\\test\\AppData\\Roaming",
          USERPROFILE: "C:\\Users\\test",
          ProgramFiles: "C:\\Program Files",
        });

        expect(dirs).toContain(
          path.join("C:\\Users\\test\\AppData\\Local", "Programs", "OpenAI", "Codex", "bin"),
        );
        expect(dirs).toContain(
          path.join("C:\\Users\\test\\AppData\\Local", "Programs", "Codex", "bin"),
        );
        expect(dirs).toContain(
          path.join("C:\\Program Files", "OpenAI", "Codex", "bin"),
        );
        expect(dirs).toContain(
          path.join("C:\\Users\\test\\AppData\\Local", "pnpm"),
        );
        expect(dirs).toContain(
          path.join("C:\\Users\\test\\AppData\\Roaming", "npm"),
        );
      });

      it("includes standard Homebrew and local bin paths on macOS", () => {
        const dirs = getPlatformFallbackDirectories("darwin", {
          HOME: "/Users/testuser",
        });
        expect(dirs).toContain("/opt/homebrew/bin");
        expect(dirs).toContain("/usr/local/bin");
        expect(dirs).toContain("/Users/testuser/.local/bin");
      });
    });

    describe("findCliBinaryPath", () => {
      it("finds the candidate in PATH directory on Windows", () => {
        const mockFiles = new Set([
          "C:\\bin\\codex.exe",
        ]);

        const result = findCliBinaryPath("codex", {
          platform: "win32",
          env: { PATH: "C:\\bin;C:\\Windows" },
          fsExists: (p) => mockFiles.has(p),
        });

        expect(result).toBe("C:\\bin\\codex.exe");
      });

      it("finds candidate in fallback directory when PATH does not contain it", () => {
        const mockFiles = new Set([
          path.join("C:\\Users\\test\\AppData\\Local", "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
        ]);

        const result = findCliBinaryPath("codex", {
          platform: "win32",
          env: {
            PATH: "C:\\Windows\\System32",
            LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
          },
          fsExists: (p) => mockFiles.has(p),
        });

        expect(result).toBe(
          path.join("C:\\Users\\test\\AppData\\Local", "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
        );
      });

      it("prefers .exe over .cmd when both exist in directory", () => {
        const mockFiles = new Set([
          "C:\\bin\\codex.exe",
          "C:\\bin\\codex.cmd",
        ]);

        const result = findCliBinaryPath("codex", {
          platform: "win32",
          env: { PATH: "C:\\bin" },
          fsExists: (p) => mockFiles.has(p),
        });

        expect(result).toBe("C:\\bin\\codex.exe");
      });

      it("supports fallback to .cmd if only .cmd exists", () => {
        const mockFiles = new Set([
          "C:\\bin\\codex.cmd",
        ]);

        const result = findCliBinaryPath("codex", {
          platform: "win32",
          env: { PATH: "C:\\bin" },
          fsExists: (p) => mockFiles.has(p),
        });

        expect(result).toBe("C:\\bin\\codex.cmd");
      });

      it("returns undefined if executable cannot be found", () => {
        const result = findCliBinaryPath("nonexistent_cli", {
          platform: "win32",
          env: { PATH: "C:\\bin" },
          fsExists: () => false,
        });

        expect(result).toBeUndefined();
      });
    });

    describe("resolveCliBinaryPath", () => {
      it("returns found full path when executable exists", () => {
        const mockFiles = new Set(["C:\\tools\\codex.exe"]);
        const result = resolveCliBinaryPath("codex", {
          platform: "win32",
          env: { PATH: "C:\\tools" },
          fsExists: (p) => mockFiles.has(p),
        });
        expect(result).toBe("C:\\tools\\codex.exe");
      });

      it("falls back to default resolveCliBinary filename when not found", () => {
        const result = resolveCliBinaryPath("codex", {
          platform: "win32",
          env: { PATH: "C:\\tools" },
          fsExists: () => false,
        });
        expect(result).toBe("codex.exe");
      });
    });
  });
});
