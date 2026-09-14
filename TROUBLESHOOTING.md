**English** | [한국어](TROUBLESHOOTING.ko.md)

# Development & Runtime Troubleshooting

## 1. Default Development Workflow (v0.9.2 Onwards)

`pnpm dev` packages the current source code via Electron Forge and executes the resulting binary under `out/`. It does not copy files into the user installation directory. After saving code changes, terminate the app via the tray menu or `Ctrl+C` and restart it. If packaging fails, previous build artifacts are never launched.

`pnpm dev:hmr` runs the standard Forge + Vite pipeline. Hot Module Replacement (HMR) applies renderer UI changes without restarting the application. Restart behavior for main/preload changes follows Forge defaults. Do not run both dev commands concurrently.

Development runs supply `LLM_USAGE_MONITOR_DEV=1` and isolate `userData` and `sessionData` into `appData/llm-usage-monitor-dev`. Configuration, cache, and single-instance locks are not shared with the production installation. In E2E environments, `LLM_USAGE_MONITOR_E2E_USER_DATA` takes precedence. Vendor credential files are never inspected or modified; CLI logins rely strictly on existing provider paths.

---

## 2. White Screen & GPU Termination: Findings & Hypotheses

### Reported Phenomenon

When running `pnpm dev` in a standard PowerShell session, some environments experienced a blank white screen or repeated GPU crashes even after relaxing Content Security Policy (CSP) and bypassing the GPU sandbox:

```text
GPU process exited unexpectedly: exit_code=-2147483645
```

`-2147483645` corresponds to `0x80000003` (`STATUS_BREAKPOINT`). This code alone cannot pinpoint a specific graphics driver, endpoint security software, or GPU sandbox restriction as the root cause.

### Findings from Investigation

- When HTML was transformed using Vite 8.2.2 and `@vitejs/plugin-react` 6.1.1, the React Refresh preamble, Vite client, and main script tags all received proper CSP nonces. **The earlier hypothesis regarding missing nonces was not reproducible under the current configuration.** [Vite CSP Documentation](https://vite.dev/guide/features#content-security-policy-csp) confirms automatic nonce injection.
- Forge 7.11.2 configures the renderer URL as `http://localhost:17321`, while the server binds to `127.0.0.1`. Explicitly setting the HMR host to `127.0.0.1` aligned the origin with permitted WebSocket connections and passed connectivity checks. This origin difference was unrelated to GPU crashes.
- Early investigations included `disable-gpu-sandbox` in the installed app and local package. Controlled comparative tests demonstrated that the packaged EXE ran reliably with the sandbox enabled, whereas the development Electron binary under the problematic path failed regardless of sandbox bypass.
- The default E2E suite was updated to execute the actual packaged executable rather than launching `app.asar` via standalone development Electron.

### Current Mitigations

- Default development execution (`pnpm dev`) avoids the Vite dev server / React Refresh / HMR WebSocket pipeline entirely, reusing the production packaging execution path.
- HMR leverages Vite's nonce support. `ws://127.0.0.1:17321` is permitted only in dev mode; development origins are never included in production CSP. Directives like `unsafe-inline`, `unsafe-eval`, and broad localhost wildcards are prohibited. Unenforceable meta CSP directives such as `frame-ancestors` have been removed.
- Global Windows `disable-gpu-sandbox` bypasses were eliminated. GPU and renderer sandboxes remain enabled by default. `LLM_USAGE_MONITOR_GPU_SANDBOX=0` is reserved strictly for deliberate dev/test comparative diagnostics and is ignored during normal production runs. `contextIsolation` and `webSecurity` are active, and `nodeIntegration` is disabled.
- Development processes log lifecycle events under the `[runtime]` prefix, distinguishing startup modes, Electron/Chromium versions, and failure stages (`did-fail-load`, `preload-error`, `render-process-gone`, `child-process-gone`, `renderer-console-error`, `startup-failed`). To prevent credential leakage, exception stack traces, URLs, and local paths are not relayed.

### Execution Folder Environment Comparison

Tests were conducted using Electron 44.1.0, the same `app.asar`, and a fresh mock-data profile:

| Execution Condition | GPU Sandbox | Observation |
| --- | --- | --- |
| Packaged executable | Active / Bypassed | Passed 5 launch/exit cycles + simultaneous multi-profile run |
| Node_modules Electron + same `app.asar` | Active / Bypassed | Crash reproduced |
| Stock Electron copied to generic workspace folder & renamed | Active | GPU & renderer crash reproduced |
| Working packaged EXE copied into problematic folder | Active | Same crash reproduced |
| Entire stock Electron copied into subfolder of working package directory | Active | Passed 5 launch/exit cycles + profile tests |
| Above working copy running Forge/Vite HMR | Active | Passed 5 launch/reload cycles, verified WebSocket & IPC |

The stock Electron executable matched the official download ZIP's SHA-256 checksum. Associated DLL, pak, and snapshot files were identical between copies. Binary corruption or driver incompatibilities alone cannot account for the discrepancy.

Inherited Windows Access Control Lists (ACLs) differed significantly between the failing workspace directory and the working package directory. The failing directory exhibited multiple inherited AppContainer SID entries. **The primary suspect is the permission and sandbox inheritance of the workspace execution folder.** (See [Codex Public Issue #27236](https://github.com/openai/codex/issues/27236) for similar reports of permission inheritance triggering Electron GPU exits).

System and user profile ACLs were left untouched. Rather than masking permission issues with relaxed CSP or disabled sandboxes, the packaging pipeline serves as the verified default development path.

### PowerShell Comparative Diagnostics

Diagnostics should always use built-in mock datasets rather than live credentials.

```powershell
pnpm package

# Baseline: Packaged binary, fresh test profile, 5 start/stop cycles
node node_modules/@playwright/test/cli.js test tests/e2e/runtime.spec.ts

# Run app.asar via development Electron binary
$env:LLM_USAGE_MONITOR_RUNTIME_MODE = 'asar'
node node_modules/@playwright/test/cli.js test tests/e2e/runtime.spec.ts

# Compare with GPU sandbox bypass while holding other variables constant
$env:LLM_USAGE_MONITOR_GPU_SANDBOX = '0'
node node_modules/@playwright/test/cli.js test tests/e2e/runtime.spec.ts
Remove-Item Env:LLM_USAGE_MONITOR_RUNTIME_MODE
node node_modules/@playwright/test/cli.js test tests/e2e/runtime.spec.ts
Remove-Item Env:LLM_USAGE_MONITOR_GPU_SANDBOX
```

---

## 3. IPC Frame Disposal Warning

The warning `Render frame was disposed before WebFrameMain could be accessed` occurs when the main process attempts to publish state to a renderer that is unmounting, reloading, or crashing. If a GPU crash occurred beforehand, this message is a secondary symptom.

Defensive checks inside `publishState` guard against destroyed windows, loading states, and crashed renderers. If an update is skipped during window load, the renderer retrieves the latest state via `getState` upon mounting and maintains synchrony via subsequent IPC subscriptions.

---

## 4. Codex CLI Process Failure (`CLI Process execution failed` / Path Discrepancies)

### Symptoms
- Querying Codex quotas fails with `CLI Process execution failed` or `not_installed`.
- Occurs when the user updates the Codex CLI or installs it to a non-standard directory (e.g., via npm, pnpm, or a standalone installer) that differs from the default hardcoded path.

### Root Cause
- `src/shared/platform.ts` previously defined the default binary name on Windows simply as `"codex"`. If the binary was not added to the global system `PATH`, or if an update installed it into a user-specific folder (such as `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`), the process runner could not resolve it.

### Resolution
- **Platform-Aware Binary Resolution** (`src/main/platform/index.ts`):
  1. `getExecutableCandidates`: Dynamically appends executable extensions (`.exe`, `.cmd`, `.bat`) in prioritized order on Windows.
  2. `getPlatformFallbackDirectories`:
     - Windows: Traverses `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, `%APPDATA%\npm`, `%LOCALAPPDATA%\pnpm`, Bun directories, Git `usr/bin`, and related tool paths.
     - macOS: Searches `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, and cargo paths.
  3. `resolveCliBinaryPath`:
     - Validates absolute paths directly if provided.
     - For relative/bare commands, queries `PATH` first; if unresolved, systematically traverses platform fallback directories and returns the verified absolute path of the executable.
  4. Both the Codex Provider (`appServerClient.ts`) and the Antigravity Provider (`processRunner.ts`) route execution through this unified resolver.
