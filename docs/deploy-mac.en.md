# macOS source installation

[한국어](deploy-mac.md) · [README](../README.md)

## Choose a variant

Supported targets: Windows x64 with 64-bit PowerShell 5.1+, and macOS Apple Silicon/Intel with system Bash. Linux, Windows ARM64 and WSL are excluded. Extract the source ZIP or clone the repository, then open the project directory. Git is optional for ZIP installations. No prebuilt app download is provided.

Node/Electron has simpler build preparation but bundles a web runtime. Rust/GPUI is expected to use less runtime memory, with more initial tooling and compilation work. No memory reduction percentage, installed size or build time is promised. Full UI parity and macOS live verification remain separate work.

This platform needs Node 24/pnpm or Rust stable/Xcode/Metal toolchain, depending on your choice. Existing incompatible tools are preserved; select a compatible version in PATH and retry.

## Install

```bash
bash scripts/install.sh --check
bash scripts/install.sh
```

The check is read-only. Installation asks for a variant, new-install startup preference, and consent. Missing tools, sources and possible administrator/reboot requirements are shown before installation. Updates preserve startup unless explicitly changed.

```bash
# Choose Rust and login startup; use node to choose Node
bash scripts/install.sh --variant rust --autostart on
# Explicit unattended consent, no immediate app launch
bash scripts/install.sh --variant rust --autostart off --non-interactive --accept-install --accept-dependencies --no-start
```

Unattended mode requires variant and installation consent, plus dependency consent if tools are missing. New installs require an explicit on/off startup choice. OS permissions, licenses and reboots are not bypassed. Declining stops installation; prepare tools manually and rerun.

## Run, update and switch

Install location: `~/Applications/LLM Usage Monitor.app`. Completion output and `install-info.json` identify the variant, version, source revision and executable (manifest is in `Contents/Resources/` on macOS). Launch from the Start menu or app bundle, then click the tray icon.

Only one app is managed. Quit from the tray before installing new source. Choosing the same variant updates it; choosing the other replaces it. Failed builds preserve the current app; failed replacement/configuration restores it. No process is forcibly terminated. Known separate Native installs are consolidated; arbitrary copies are not deleted.

Login startup uses one entry: `~/Library/LaunchAgents/com.innnteraction.llm-usage-monitor.plist`. Both tray implementations use that same entry. Changes apply on next login; development/preview executables cannot register themselves. Shared caches survive switching; variant-specific UI preferences are not converted.

## Remove and recover

```bash
bash scripts/install.sh --uninstall
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

The app installs in user space; build tools may need admin access. Actual login/reboot and macOS live UI checks are manual, not implied by automatic tests. See the [verification record](verification.md).

Missing Homebrew requires separate consent. Missing Xcode/Metal opens Apple setup and stops; complete first launch, licensing and the Metal toolchain, then rerun. Ad-hoc signing is not notarization and the installer does not disable Gatekeeper.

Migration of old login items may require System Events Automation permission.
