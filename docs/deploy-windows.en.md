**English** | [한국어](deploy-windows.md)

# Windows Developer One-Click Deployment & Installation Guide

This document guides developers through building LLM Usage Monitor locally on Windows with a single command, deploying it to the user programs folder (`%LOCALAPPDATA%\Programs\llm-usage-monitor`), and running it as a system tray resident application.

---

## Development Mode vs. Installed App (v0.9.2 Onwards)

`pnpm dev` packages the current source code and runs the binary under `out/`. Development data is isolated in `%APPDATA%\llm-usage-monitor-dev` without overwriting the production installation or autostart shortcuts. To update your local installation, run `pnpm deploy:autostart`. For HMR development, use `pnpm dev:hmr` (refer to the [Troubleshooting Guide](../TROUBLESHOOTING.md) for permission notes regarding standalone Electron).

After installation, verify the installed version with:

```powershell
(Get-Item "$env:LOCALAPPDATA\Programs\llm-usage-monitor\LLM Usage Monitor.exe").VersionInfo.ProductVersion
```

---

## 1. Quick Start

### Standard Deployment and Launch
From the project root, execute either of the following commands:

```powershell
# First time or after pulling latest changes to sync dependencies
pnpm install

# Using pnpm
pnpm deploy

# Or run the PowerShell script directly
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1
```

- The app is packaged (built).
- Any currently running instance is safely terminated.
- Fresh files are deployed to `%LOCALAPPDATA%\Programs\llm-usage-monitor`.
- A Start Menu shortcut for `LLM Usage Monitor` is created.
- The app launches immediately and docks in the system notification tray.

---

## 2. Start with Windows (AutoStart) Option

To configure the application to launch automatically in the background tray upon Windows user login, use the `-AutoStart` option:

```powershell
# Using pnpm
pnpm deploy:autostart

# Or run the PowerShell script directly
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1 -AutoStart
```

- A shortcut is registered in the Windows Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`).
- You can also view and toggle the autostart status at any time in the Task Manager under the `Startup apps` tab.

---

## 3. Fast Redeploy Without Rebuilding (`-SkipBuild`)

If you already have a compiled binary in `out/LLM Usage Monitor-win32-x64` and want to copy files and recreate shortcuts quickly:

```powershell
# Using pnpm
pnpm deploy:quick

# Or run the PowerShell script directly
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1 -SkipBuild
```

---

## 4. Parameter Reference

| Parameter | Default | Description |
|---|---|---|
| `-AutoStart` | `$false` | Create a shortcut in the Startup folder to run on Windows login |
| `-SkipBuild` | `$false` | Skip the build phase and reuse existing `out/` build artifacts |
| `-NoStart` | `$false` | Do not automatically start the app after deployment |
| `-CreateDesktopShortcut` | `$false` | Create a shortcut on the Desktop |
| `-InstallDir <Path>` | `%LOCALAPPDATA%\Programs\llm-usage-monitor` | Target installation directory (no UAC / admin privileges needed) |
| `-Uninstall` | `$false` | Completely remove installed files, Start Menu, and Startup shortcuts |

---

## 5. Uninstall (Complete Removal)

To clean up all installed files and shortcuts after testing:

```powershell
pnpm deploy:uninstall

# Or run the PowerShell script directly
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-windows.ps1 -Uninstall
```
