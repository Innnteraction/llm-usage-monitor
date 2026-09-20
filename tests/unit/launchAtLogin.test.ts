import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { launchAtLogin } from "../../src/main/index";

it("calls the installed helper with Unicode paths and rejects a foreign manifest", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "startup-설치 "));
  const executable = path.join(root, "MacOS", "Synthetic App.exe");
  const windows = process.platform === "win32";
  const directory = windows ? path.dirname(executable) : path.join(root, "Resources");
  try {
    await mkdir(directory, { recursive: true });
    const manifest = { schemaVersion: 1, appId: "llm-usage-monitor", variant: "node", executable: path.basename(executable) };
    await writeFile(path.join(directory, "install-info.json"), "\uFEFF" + JSON.stringify(manifest));
    await writeFile(path.join(directory, windows ? "startup.ps1" : "startup.sh"), windows
      ? "param($Action,$Executable)\nif ($Executable -notlike '*Synthetic App.exe') { throw 'Wrong executable' }; if ($Action -eq 'on') { 'true' } else { 'false' }"
      : '#!/bin/bash\ncase "$2" in *"Synthetic App.exe") ;; *) exit 1;; esac\nif [ "$1" = on ]; then echo true; else echo false; fi\n');
    expect(await launchAtLogin("query", executable)).toBe(false);
    expect(await Promise.all([launchAtLogin("on", executable), launchAtLogin("off", executable)])).toEqual([true, false]);
    await writeFile(path.join(directory, "install-info.json"), JSON.stringify({ ...manifest, variant: "rust" }));
    expect(await launchAtLogin("query", executable)).toBe(false);
    await expect(launchAtLogin("on", executable)).rejects.toThrow("Install the app");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 15000);
