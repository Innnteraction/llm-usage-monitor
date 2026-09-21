**English** | [한국어](README.ko.md)

# LLM Usage Monitor (v0.12.0)

A system tray application for macOS and Windows that monitors 5-hour and weekly quota usage alongside local token consumption for Codex, Claude Code, and Antigravity (`agy`) at a glance.

<p align="center">
  <img src="docs/images/overview-dark.png" alt="Detailed View: 3 provider cards, progress bars, reset countdowns, local token aggregation" width="480">
  <br>
  <img src="docs/images/compact-dark.png" alt="Compact Mode: Single-line summary table per provider" width="480">
  <br>
  <sub>Detailed view (top) and Compact mode (bottom). Both screenshots were captured with built-in mock data; accounts and figures are fictional.</sub>
</p>

---

## Overview

This app helps developers actively using Codex, Claude Code, and Antigravity CLIs check their account quotas and local token consumption without disrupting their workflow. It supports both macOS and Windows, with a source installer that checks dependencies and installs your selected variant. Build tools may require administrator privileges.

The application respects the credential ownership of each vendor CLI. It never directly reads, caches, or modifies auth tokens or credential files; quotas reflect only what the CLIs report. After installation, all that is required is being signed in to each CLI and granting one-time workspace folder trust for Claude Code in an isolated probe directory.

Follow the quick start guide below to install, and once all cards show the `fresh` state, you are all set.

---

## Quick Start

There are no prebuilt downloads in this installation flow. Use **Code → Download ZIP** and extract the source, or clone the repository. Run the following commands in the project directory. ZIP installation does not require Git. Neither Node nor Rust is required to start the installer.

### 1. Compare and choose

| Item | Node / Electron | Rust / GPUI |
| --- | --- | --- |
| UI | Existing web UI | Native UI |
| Build tools | Node 24 and project-pinned pnpm | Rust/Cargo; MSVC/SDK on Windows or Xcode/Metal on macOS |
| Initial setup | Relatively simple | More tooling and compilation work |
| Measured runtime memory (Windows x64) | 314–318 MiB | About 55 MiB |
| Installed files | Bundled Electron runtime and resources | Native executable and resources |

Simpler setup does not mean a smaller app package. No memory reduction percentage or build time is promised. Full UI parity and macOS live UI/login still require manual verification. The installer shows missing tools on this PC and asks you to choose; **there is no default variant**. Only one managed app is installed.

Measurement conditions (2026-09-20): five samples of the same synthetic expanded view on Windows x64, summing the process-tree Working Set. These values include shared-page double counting and vary by PC, driver, and data; they are not macOS measurements. See [conditions and limits](docs/verification.md#메모리-비교).

### 2. Check the environment, then install

Windows x64, 64-bit PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

macOS Apple Silicon / Intel:

```bash
bash scripts/install.sh --check
bash scripts/install.sh
```

Installer prompts and application UI are in English. Choose `node` (`n`) or `rust` (`r`) and whether to start at login. The same aliases work with `-Variant` / `--variant`. Review tool sources and consent before installation. The app installs in user space, but build tools may require administrator access, license acceptance or a reboot. Existing incompatible tools are not silently replaced.

### 3. Open and configure

Launch **LLM Usage Monitor** from the Windows Start menu or `~/Applications/LLM Usage Monitor.app` on macOS. It normally runs in the tray; click the icon to open it. Sign in to the vendor CLIs you use and follow the provider setup below. Missing CLIs do not prevent using other providers.

Both variants support the tray login-startup setting. Development executables cannot register startup; use the managed installation.

### 4. Update, switch or uninstall

Quit through the tray menu and rerun the installer from the new source. Selecting the same variant updates it; selecting the other replaces it. Failed builds preserve the installed app, and failed replacements restore it. Shared caches are retained; variant-specific UI preferences are not converted.

```powershell
# Windows: switch to Rust (use -Variant node for Node)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Variant rust
# Remove app only; retain cache, credentials and build tools
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Uninstall
```

```bash
# macOS: switch to Node (use --variant rust for Rust)
bash scripts/install.sh --variant node
bash scripts/install.sh --uninstall
```

Legacy `pnpm deploy*` commands enter the Node installer. `deploy:quick` also revalidates the build rather than trusting stale artifacts. Options and recovery: [Windows](docs/deploy-windows.en.md) · [macOS](docs/deploy-mac.en.md).

---

## Provider Setup

Check the status indicator at the top-right of each provider card:

| Status | Meaning |
| --- | --- |
| `● fresh` | Recent refresh succeeded. Setup is complete. |
| `● stale` | Refresh failed. The last successful values are retained and the cause is displayed. |
| `● unavailable` | Has not succeeded yet. Follow the steps below. |

### Claude Code: One-Time Folder Trust Approval

Claude Code prompts for trust confirmation whenever it encounters a new working directory. To query quotas non-invasively, the app runs `claude` in safe mode inside an isolated empty directory. You only need to approve this folder once. The app will never answer prompts on your behalf or modify Claude configuration files.

| OS | Dedicated Folder |
| --- | --- |
| macOS | `~/Library/Application Support/LLM Usage Monitor/claude-probe` |
| Windows | `%LOCALAPPDATA%\LLM Usage Monitor\claude-probe` |

1. When opening the app, the Claude Code card will show `● unavailable`, the message `Workspace trust confirmation required.`, and a `prepare folder` button.
2. Click `prepare folder`. A terminal window (Terminal.app on macOS, Windows Terminal on Windows) will open and run `claude` inside the dedicated folder.
3. In response to the terminal prompt `Do you trust this folder?`, select **Yes**.
4. Type `/exit` at the Claude prompt to close the session.
5. Click `refresh` in the app or wait up to 60 seconds. The card will update to `● fresh` with 5-hour and 7-day gauges populated. This approval persists permanently.

If you are not logged in, the card displays `Sign in with the CLI to view quota.` and a `sign in` button. Clicking it runs `claude auth login --claudeai` in a terminal window. After signing in, proceed from step 1 above.

If clicking the button fails to open a terminal:
- **Windows**: Ensure Windows Terminal (`wt.exe`) is installed.
- **macOS**: When prompted on first launch to allow LLM Usage Monitor to control Terminal, grant permission. If denied, navigate to System Settings → Privacy & Security → Automation and enable Terminal permissions for LLM Usage Monitor.
- Alternatively, run the following safe-mode command manually in the dedicated folder from your terminal and complete steps 3–5:

```bash
claude --safe-mode --ax-screen-reader --restricted --strict-mcp-config --tools ""
```

For security principles regarding credentials, see the [Anthropic Credential Boundary Decision](docs/decisions/0001-anthropic-credential-boundary.md).

### Codex

If signed in to either the `codex` CLI or the **Codex Desktop app**, it works out of the box.

- **Codex Desktop App Detection**: Even if the standalone CLI is not installed, if the Codex Desktop app is present, the app automatically locates the binary in default paths (e.g., `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`) and reads session logs from `~/.codex/sessions`. It tracks both account quotas and local tokens without manual `PATH` configuration.
- **Maintaining Sign-in**: If your session expires, the card shows `Sign in with the CLI to view quota.` Run `codex login` in your terminal or log back in via the Desktop app.

### Antigravity (Optional)

If `agy` 1.1.11 or higher is in your `PATH` and signed in, a third card appears automatically. If the CLI is not found, the card indicates `CLI is not installed.` without affecting the other providers.

- **Unified IDE & CLI Tracking**: When your Antigravity standalone IDE or VS Code extension shares the same Google Account with the `agy` CLI, model usage is seamlessly aggregated into the account quota, indicated by `source Antigravity CLI, IDE` in the footer.
- **Account Switch Support (`switch`)**: Click the `switch` button next to the account email label to launch an interactive terminal guiding you through `/logout` and logging in with a different Google Account.
- **Easy Sign-In (`sign in`)**: If the CLI is unauthenticated, a `sign in` button appears in the error section to trigger the browser OAuth login directly from the terminal.

---

## Key Features

- **Integrated Quota Tracking for 3 Major AI Tools**
  - Codex: 7-day weekly quota and additional model limits.
  - Claude Code: 5-hour session limit, 7-day weekly quota, and Fable model limits.
  - Antigravity: Gemini family 5-hour and weekly limits, plus Claude/GPT quotas.
- **Dual UI Modes**
  - Detailed View: Per-provider accounts, progress bars, reset countdowns, and 2-line local token telemetry.
  - Compact Mode: One-line summarized table across all providers (`Ctrl/Cmd+Shift+C`).
- **Always on Top (Pin) & Drag Anywhere**
  - Click and drag anywhere in the window (header, empty card spaces, gauge bars) to reposition freely. The app remembers its last position.
  - Pin on top (`Ctrl/Cmd+Shift+P`) keeps the window visible over other apps, persisting across restarts.
- **Local Token Analytics**
  - Independent of account quotas, tracks this machine's CLI session logs (JSONL) via chunk streaming and checkpoints (total tokens, input/output, cache read/write).
- **TUI-Inspired Polish**
  - OS dark/light automatic synchronization and manual toggle (`Ctrl/Cmd+Shift+L`).
  - Terminal-style color-wave shimmer on refresh.
  - 0–9% values are padded to two digits (`05%`) to preserve gauge and table alignment.
  - Tooltips disappear immediately when the pointer leaves the window.
- **Strict Credential Boundaries**
  - Respects vendor CLI ownership; never directly inspects or alters auth tokens or credentials.

---

## Shortcuts & Controls

Keyboard shortcuts are active when the application window has focus. You can also view these in-app by clicking the <kbd>?</kbd> button in the top-right corner.

| Feature | Windows | macOS | Top-Bar Button |
| --- | --- | --- | --- |
| Toggle Compact Mode | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | Square (Collapse − / Expand +) |
| Toggle Dark / Light Theme | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> | Moon (Dark) / Sun (Light) icon |
| Toggle Always on Top (Pin) | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> | Pin icon (filled when active) |
| View Shortcuts & Info | - | - | <kbd>?</kbd> icon (opens popover) |
| Close Popover | <kbd>Esc</kbd> | <kbd>Esc</kbd> | Click outside window (when unpinned) |

Mouse Controls and Tray Menu:

- **Move Window**: Click and drag anywhere (header, card backgrounds, gauge bars). Text selection is disabled during drag for smooth repositioning, and coordinates are saved automatically.
- **Detailed Tooltips**: Hover over or focus any gauge, number, or action button to view precise details.
- **Tray Context Menu**: Right-click the tray icon for `Open`, `Refresh`, `Reset to default position`, `Start at Login` (Windows: `Start with Windows`), and `Quit`.

---

## Local Development & Testing

Node source, tests and build configuration live in `apps/node`; Rust lives in `apps/rust`. Shared fixtures are in `shared/fixtures`, and installation scripts stay in `scripts`. `.work` is local-only and is not required to build. See the [development guide](docs/development.md) for ownership, commands and output paths.

Rust-only development does not require Node:

```sh
cargo test --locked --all-targets
cargo run --locked --release --bin llm-usage-monitor -- --demo
```

```bash
pnpm install

# Package current sources and run locally (without installing to user folder)
pnpm dev

# Optional: Vite HMR to instantly preview UI changes
pnpm dev:hmr

# Runtime E2E verification of launch, quit, and profile isolation (mock data)
pnpm test:e2e:runtime

# Unit and integration test suite
pnpm test

# Type checking and ESLint
pnpm typecheck
pnpm lint

# Production packaging (apps/node/out/)
pnpm package

# Create distribution installers (Squirrel .exe for Windows, .zip for macOS)
pnpm make

# Regenerate README screenshots (mock data; requires pnpm package first)
pnpm screenshot:readme
```

Read-only smoke tests targeting real vendor CLIs can be run separately via `pnpm test:smoke:codex`, `pnpm test:smoke:claude-pty`, and `pnpm test:smoke:local-usage`.

`pnpm dev` uses the same Forge packaging as production and executes the compiled binary directly. To apply code modifications, exit the app via the tray context menu or `Ctrl+C`, then run the command again (closing the window minimizes it to the tray). If packaging fails, the previous build is never run.

Both development commands isolate configuration and Chromium data under `appData/llm-usage-monitor-dev`, while the shared cache lock still prevents concurrent collectors using the same cache. Existing vendor CLI logins are reused without modifying installed folders, shortcuts, or autostart entries.

For diagnosis procedures regarding GPU unexpected termination and blank window issues, see the [Troubleshooting Guide](TROUBLESHOOTING.md) ([한국어](TROUBLESHOOTING.ko.md)).

---

## Documentation & References

- Deployment: [macOS Deployment Guide](docs/deploy-mac.md) ([English](docs/deploy-mac.en.md)) · [Windows Deployment Guide](docs/deploy-windows.md) ([English](docs/deploy-windows.en.md))
- [Product Concept & Design Principles](docs/product-concept.md) (Korean)
- [Anthropic Credential Boundary Decision](docs/decisions/0001-anthropic-credential-boundary.md) (Korean)
- Provider Contracts: [Codex](docs/providers/codex.md) · [Claude Code](docs/providers/claude.md) · [Antigravity](docs/providers/antigravity.md)
- [Architecture Evidence & Module Boundary Analysis](docs/architecture-evidence.md) (Korean)
- [Architecture Assessment & Decomposition Plan](docs/architecture-assessment.md) (Korean)
- [v1 Development Roadmap](docs/plan/v1-roadmap.md) (Korean)

---

## License

This project is licensed under the [MIT License](LICENSE).
