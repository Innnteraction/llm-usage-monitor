**English** | [한국어](deploy-mac.md)

# macOS Developer One-Click Deployment & Installation Guide

This document guides developers through building LLM Usage Monitor locally on macOS with a single command, deploying it to the user applications folder (`~/Applications/LLM Usage Monitor.app`), and running it as a menu bar tray resident application.

---

## Development Mode vs. Installed App (v0.9.2 Onwards)

`pnpm dev` packages the current source code and runs the binary under `out/`, isolating development data in `~/Library/Application Support/llm-usage-monitor-dev`. To update the installed application and login autostart registration, run `pnpm deploy:autostart`. For Hot Module Replacement during renderer development, use `pnpm dev:hmr`.

---

## 1. Quick Start

### Standard Deployment and Launch
From the project root, execute either of the following commands:

```bash
# Using pnpm (auto-detects OS)
pnpm run deploy

# Or run the macOS script directly
./scripts/deploy-mac.sh
```

- The app is packaged (built), generating the `out/LLM Usage Monitor-darwin-*/LLM Usage Monitor.app` bundle.
- Any currently running instance of the app is safely terminated.
- The fresh bundle is deployed to `~/Applications/LLM Usage Monitor.app`.
- macOS quarantine flags (`xattr -cr`) are stripped and ad-hoc code signing is applied automatically.
- The app launches immediately and resides in the macOS menu bar.

---

## 2. Start at Login (AutoStart) Option

To configure the application to launch automatically in the background menu bar upon macOS user login, use the `--autostart` option:

```bash
# Using pnpm
pnpm deploy:autostart

# Or run the script directly
./scripts/deploy-mac.sh --autostart
```

- Registers and loads `~/Library/LaunchAgents/com.innnteraction.llm-usage-monitor.plist`.
- You can also toggle this setting anytime via the `Start at Login` checkbox in the tray icon context menu.

---

## 3. Fast Redeploy Without Rebuilding (`--skip-build`)

If you already have a compiled bundle in the `out/` directory and want to quickly re-copy files and re-apply permissions:

```bash
# Using pnpm
pnpm deploy:quick

# Or run the script directly
./scripts/deploy-mac.sh --skip-build
```

---

## 4. Parameter Reference

| Parameter | Default | Description |
|---|---|---|
| `--autostart` | `false` | Register LaunchAgent to start on macOS user login |
| `--skip-build` | `false` | Skip the build phase and reuse existing `out/` bundle |
| `--no-start` | `false` | Do not automatically start the app after deployment |
| `--install-dir <path>` | `~/Applications` | Target installation directory (no root/sudo needed) |
| `--uninstall` | `false` | Completely remove installed app and LaunchAgent |

> [!TIP]
> To install system-wide, pass `--install-dir /Applications` (write permissions to `/Applications` may be required).

---

## 5. Uninstall (Complete Removal)

To remove the installed application and disable login autostart:

```bash
# Using pnpm
pnpm deploy:uninstall

# Or run the script directly
./scripts/deploy-mac.sh --uninstall
```

---

## 6. Troubleshooting & Operational Notes

### Claude Code CLI: One-Time Folder Trust Approval
- Claude Code prompts for confirmation ("Do you trust this folder?") for each new working directory.
- LLM Usage Monitor uses a dedicated persistent directory (`~/Library/Application Support/LLM Usage Monitor/claude-probe`) as its probe folder.
- If the popover displays `prepare folder`, click it to open a terminal and complete the one-time trust approval. This persists across reboots.

### `PATH` Environment Variable Resolution
- Even when launched as a standalone GUI application, paths including `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, and `~/.cargo/bin` are automatically detected and merged into `process.env.PATH`, ensuring reliable execution of `claude`, `codex`, and `agy` CLIs.
