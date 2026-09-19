# Windows source installation

[한국어](deploy-windows.md) · [README](../README.md)

## Choose a variant

Supported targets: Windows x64 with 64-bit PowerShell 5.1+, and macOS Apple Silicon/Intel with system Bash. Linux, Windows ARM64 and WSL are excluded. Extract the source ZIP or clone the repository, then open the project directory. Git is optional for ZIP installations. No prebuilt app download is provided.

Node/Electron has simpler build preparation but bundles a web runtime. Rust/GPUI is expected to use less runtime memory, with more initial tooling and compilation work. No memory reduction percentage, installed size or build time is promised. Full UI parity and macOS live verification remain separate work.

This platform needs Node 24/pnpm or Rust stable MSVC/Visual Studio 2022 C++ Build Tools/Windows SDK, depending on your choice. Existing incompatible tools are preserved; select a compatible version in PATH and retry.

## Install

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

The check is read-only. Installation asks for a variant, new-install startup preference, and consent. Missing tools, sources and possible administrator/reboot requirements are shown before installation. Updates preserve startup unless explicitly changed.

```powershell
# Choose Rust and login startup; use node to choose Node
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Variant rust -AutoStart on
# Explicit unattended consent, no immediate app launch
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Variant rust -AutoStart off -NonInteractive -AcceptInstall -AcceptDependencies -NoStart
```

Unattended mode requires variant and installation consent, plus dependency consent if tools are missing. New installs require an explicit on/off startup choice. OS permissions, licenses and reboots are not bypassed. Declining stops installation; prepare tools manually and rerun.

## Run, update and switch

Install location: `%LOCALAPPDATA%\Programs\llm-usage-monitor`. Completion output and `install-info.json` identify the variant, version, source revision and executable (manifest is in `Contents/Resources/` on macOS). Launch from the Start menu or app bundle, then click the tray icon.

Only one app is managed. Quit from the tray before installing new source. Choosing the same variant updates it; choosing the other replaces it. Failed builds preserve the current app; failed replacement/configuration restores it. No process is forcibly terminated. Known separate Native installs are consolidated; arbitrary copies are not deleted.

Login startup uses one entry: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run → LLM Usage Monitor`. Both tray implementations use that same entry. Changes apply on next login; development/preview executables cannot register themselves. Shared caches survive switching; variant-specific UI preferences are not converted.

## Remove and recover

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Uninstall
```

Quit first. Removal preserves shared caches, vendor credentials and build tools. Custom installation directories are not supported.

- Locked files: quit via the tray, not just the window close button, then retry.
- Download/tool installation failure: check the official source/network and rerun. The old app remains installed.
- New tool not found: reopen the terminal to refresh PATH.
- Incompatible Node: select Node 24; the installer will not remove your existing version.
- No visible window after login: the app starts in the tray; click its icon.
- Another collector already running: quit other development/copied instances sharing the cache.

Legacy `pnpm deploy*` commands enter the Node installer. Quick deployment still validates the build. Custom install-dir and desktop-shortcut flags are no longer supported by the single managed-install policy.

## Provider setup and validation

Vendor CLIs and credentials are not installed/modified by this installer. Install the CLIs you use from their official sources and sign in yourself. Claude also requires folder trust. Follow [provider setup](../README.md#provider-setup).

The app installs in user space; build tools may need admin access. Actual login/reboot and macOS live UI checks are manual, not implied by automatic tests. See the [verification record](../.work/SINGLE_INSTALL_RISKS.md).

Tool installation uses existing WinGet; if unavailable, official Node/Build Tools links are supplied. UAC/reboot may be required. Rustup is downloaded over official HTTPS and verified before execution.
