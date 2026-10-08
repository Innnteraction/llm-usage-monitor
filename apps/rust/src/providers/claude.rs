use crate::core::types::{
    ProviderAuthKind, ProviderError, ProviderId, ProviderSnapshot, ProviderSource, QuotaKind,
    QuotaWindow, SnapshotStatus,
};
use chrono::{DateTime, Datelike, Duration as ChronoDuration, Local, TimeZone, Utc};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use regex::Regex;
use serde::Deserialize;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

const CLAUDE_SAFE_SESSION_ARGS: &[&str] = &[
    "--safe-mode",
    "--ax-screen-reader",
    "--restricted",
    "--strict-mcp-config",
    "--tools",
    "",
];

const MAX_CAPTURE_CHARS: usize = 512 * 1024;
const STARTUP_IDLE: Duration = Duration::from_millis(5000);
const RESPONSE_IDLE: Duration = Duration::from_millis(1500);
const PROBE_TIMEOUT: Duration = Duration::from_secs(25);
const EXIT_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
pub struct ClaudeParsedWindow {
    pub kind: QuotaKind,
    pub label: String,
    pub used_percent: f64,
    pub resets_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
struct ClaudeAuthStatusJson {
    #[serde(default)]
    email: Option<String>,
    #[serde(rename = "authType", default)]
    auth_type: Option<String>,
}

pub struct ClaudeProvider {
    command_name: String,
}

impl Default for ClaudeProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl ClaudeProvider {
    pub fn new() -> Self {
        let command_name = env::var("CLAUDE_CLI_PATH").unwrap_or_else(|_| "claude".to_string());
        Self { command_name }
    }

    pub fn with_command(command_name: String) -> Self {
        Self { command_name }
    }

    pub async fn fetch_quota(&self) -> ProviderSnapshot {
        let fetched_at = Utc::now();
        let cmd = self.command_name.clone();

        // 1. Run PTY probe in blocking thread (portable-pty is synchronous)
        let pty_res = tokio::task::spawn_blocking(move || run_claude_pty_probe(&cmd)).await;

        let probe = match pty_res {
            Ok(res) => res,
            Err(_) => {
                return failure_snapshot(
                    fetched_at,
                    "process_failed",
                    "Claude PTY task panicked or failed.",
                );
            }
        };

        if probe.status != "supported" {
            let (code, msg) = match probe.status {
                "not_installed" => (
                    "not_installed",
                    "Install the Claude Code CLI to view quota.",
                ),
                "not_authenticated" => (
                    "not_authenticated",
                    "Sign in with the Claude Code CLI to view quota.",
                ),
                "blocked_prompt" => (
                    "workspace_trust_required",
                    "Claude Code CLI requires workspace trust approval.",
                ),
                "timeout" => (
                    "timeout",
                    "Claude Code CLI did not respond before the timeout.",
                ),
                "process_failed" => (
                    "process_failed",
                    "Claude Code CLI stopped during quota refresh.",
                ),
                "rate_limited" => (
                    "rate_limited",
                    "Claude Code usage request was rate limited.",
                ),
                "network" => (
                    "network",
                    "Claude Code could not fetch usage. Check the network connection.",
                ),
                _ => (
                    "unsupported_output",
                    "Claude Code CLI returned an unsupported quota response.",
                ),
            };
            return failure_snapshot(fetched_at, code, msg);
        }

        // 2. Parse usage screen into QuotaWindows
        let parsed_windows = probe.quota_windows;
        let mut quota_windows = Vec::new();

        for w in parsed_windows {
            let id = match w.kind {
                QuotaKind::FiveHour => "claude-five-hour".to_string(),
                QuotaKind::Weekly => "claude-weekly".to_string(),
                QuotaKind::ModelWeekly | QuotaKind::Other => {
                    let slug = w
                        .label
                        .to_lowercase()
                        .replace(|c: char| !c.is_alphanumeric(), "-");
                    format!("claude-{}", slug)
                }
            };

            quota_windows.push(QuotaWindow {
                id,
                kind: w.kind,
                label: w.label,
                used_percent: Some(w.used_percent),
                resets_at: w.resets_at,
                source: ProviderSource::ClaudeCli,
                status: SnapshotStatus::Fresh,
            });
        }

        // 3. Attempt to get account label via `claude auth status --json`
        let account_info = self.read_auth_status().await;
        let account_label = account_info.as_ref().and_then(|a| a.email.clone());
        let auth_kind = match account_info.as_ref().and_then(|a| a.auth_type.as_deref()) {
            Some("oauth") | Some("subscription") => Some(ProviderAuthKind::Subscription),
            Some("api_key") => Some(ProviderAuthKind::ApiKey),
            Some("enterprise") => Some(ProviderAuthKind::Enterprise),
            _ => Some(ProviderAuthKind::Subscription),
        };

        ProviderSnapshot {
            provider_id: ProviderId::Claude,
            account_label,
            auth_kind,
            status: SnapshotStatus::Fresh,
            fetched_at,
            last_successful_at: Some(fetched_at),
            quota_windows,
            local_usage: None,
            error: None,
            service_status: None,
        }
    }

    async fn read_auth_status(&self) -> Option<ClaudeAuthStatusJson> {
        let output = tokio::time::timeout(
            Duration::from_secs(5),
            super::background_command(&self.command_name)
                .kill_on_drop(true)
                .args(["auth", "status", "--json"])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .output(),
        )
        .await
        .ok()?
        .ok()?;

        if output.status.success() {
            serde_json::from_slice(&output.stdout).ok()
        } else {
            None
        }
    }
}

fn resolve_claude_probe_dir() -> PathBuf {
    if let Ok(dir) = env::var("CLAUDE_PROBE_DIRECTORY") {
        return PathBuf::from(dir);
    }
    let base = dirs::data_local_dir().unwrap_or_else(|| env::temp_dir());
    base.join("LLM Usage Monitor").join("claude-probe")
}

struct ClaudeProbeResult {
    status: &'static str,
    quota_windows: Vec<ClaudeParsedWindow>,
}
impl ClaudeProbeResult {
    fn failure(status: &'static str) -> Self {
        Self {
            status,
            quota_windows: Vec::new(),
        }
    }
}

#[derive(Default)]
struct ScreenCapture {
    // Keep bytes until decoding so UTF-8 and ANSI sequences can span PTY reads.
    raw: Vec<u8>,
    revision: u64,
    closed: bool,
}
impl ScreenCapture {
    fn append(&mut self, bytes: &[u8]) {
        self.raw.extend_from_slice(bytes);
        if self.raw.len() > MAX_CAPTURE_CHARS {
            self.raw.drain(..self.raw.len() - MAX_CAPTURE_CHARS);
        }
        self.revision += 1;
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&strip_ansi_escapes::strip(&self.raw)).replace('\r', "\n")
    }
}

fn screen_failure(screen: &str) -> Option<&'static str> {
    let lower = screen.to_lowercase();
    if [
        "not logged in",
        "not authenticated",
        "run /login",
        "please log in",
        "authentication required",
    ]
    .iter()
    .any(|s| lower.contains(s))
    {
        Some("not_authenticated")
    } else if [
        "trust this folder",
        "trust this directory",
        "workspace trust",
        "do you trust",
    ]
    .iter()
    .any(|s| lower.contains(s))
    {
        Some("blocked_prompt")
    } else if lower.contains("rate limit") || lower.contains("http 429") {
        Some("rate_limited")
    } else if [
        "failed to fetch usage",
        "could not fetch usage",
        "error fetching usage",
        "network error",
    ]
    .iter()
    .any(|s| lower.contains(s))
    {
        Some("network")
    } else if [
        "enter to confirm",
        "press enter",
        "select an option",
        "choose an option",
    ]
    .iter()
    .any(|s| lower.contains(s))
    {
        Some("unsupported_output")
    } else {
        None
    }
}

fn startup_ready(screen: &str) -> bool {
    // AX mode in Claude 2.1.294 uses '$'. Require the Claude banner, a standalone
    // input prompt and only its known footer, rather than an arbitrary symbol/idle.
    if !screen.to_lowercase().contains("claude code") {
        return false;
    }
    let lines: Vec<_> = screen
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let Some(prompt) = lines
        .iter()
        .rposition(|line| matches!(*line, ">" | "❯" | "$"))
    else {
        return false;
    };
    lines[prompt + 1..]
        .iter()
        .all(|line| *line == "? for shortcuts")
}

fn complete_usage_windows(screen: &str, now: DateTime<Utc>) -> Option<Vec<ClaudeParsedWindow>> {
    let lower = screen.to_lowercase();
    if let Some(index) = lower.rfind("refreshing") {
        let after = &lower[index + "refreshing".len()..];
        // AX mode appends the refreshed panel instead of removing the spinner.
        if !after.contains("current week")
            || !(after.contains("used") || after.contains("remaining") || after.contains("left"))
        {
            return None;
        }
    }
    let windows = parse_claude_usage_screen(screen, now);
    (windows.iter().any(|w| w.kind == QuotaKind::FiveHour)
        && windows.iter().any(|w| w.kind == QuotaKind::Weekly))
    .then_some(windows)
}

fn run_claude_pty_probe(command_name: &str) -> ClaudeProbeResult {
    run_claude_pty_probe_at(
        command_name,
        &resolve_claude_probe_dir(),
        PROBE_TIMEOUT,
        STARTUP_IDLE,
        RESPONSE_IDLE,
    )
}

fn run_claude_pty_probe_at(
    command_name: &str,
    probe_dir: &std::path::Path,
    timeout: Duration,
    startup_idle: Duration,
    response_idle: Duration,
) -> ClaudeProbeResult {
    let cli = super::CliCommand::new(command_name);
    // Windows portable-pty resolves PATHEXT (e.g. claude.exe) itself.
    #[cfg(unix)]
    if !cli.program.is_file() {
        return ClaudeProbeResult::failure("not_installed");
    }
    if fs::create_dir_all(probe_dir).is_err() {
        return ClaudeProbeResult::failure("process_failed");
    }
    let pty_pair = match native_pty_system().openpty(PtySize {
        rows: 40,
        cols: 120,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(_) => return ClaudeProbeResult::failure("process_failed"),
    };
    // Acquire both streams before spawning so a stream error cannot leak a child.
    let mut reader = match pty_pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(_) => return ClaudeProbeResult::failure("process_failed"),
    };
    let mut writer = match pty_pair.master.take_writer() {
        Ok(writer) => writer,
        Err(_) => return ClaudeProbeResult::failure("process_failed"),
    };
    let mut cmd = CommandBuilder::new(&cli.program);
    for arg in CLAUDE_SAFE_SESSION_ARGS {
        cmd.arg(arg);
    }
    cmd.cwd(probe_dir);
    cmd.env("PATH", &cli.path);
    cmd.env("CLAUDE_CODE_SAFE_MODE", "1");
    cmd.env("NO_COLOR", "1");
    cmd.env("TERM", "xterm-256color");
    let mut child = match pty_pair.slave.spawn_command(cmd) {
        Ok(child) => child,
        Err(error) => {
            let missing = error.chain().any(|cause| {
                cause
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound)
            });
            return ClaudeProbeResult::failure(if missing {
                "not_installed"
            } else {
                "process_failed"
            });
        }
    };
    drop(pty_pair.slave);

    let capture = Arc::new(std::sync::Mutex::new(ScreenCapture::default()));
    let reader_capture = Arc::clone(&capture);
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let reader_done = Arc::clone(&done);
    let reader_thread = std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        while !reader_done.load(std::sync::atomic::Ordering::Relaxed) {
            match reader.read(&mut buffer) {
                Ok(n) if n > 0 => reader_capture.lock().unwrap().append(&buffer[..n]),
                _ => break,
            }
        }
        reader_capture.lock().unwrap().closed = true;
    });

    let started = Instant::now();
    let mut sent_usage = false;
    let mut revision = 0;
    let mut idle_since = Instant::now();
    let mut result = ClaudeProbeResult::failure("timeout");
    while started.elapsed() < timeout {
        std::thread::sleep(Duration::from_millis(50));
        let (screen, current_revision, closed) = {
            let capture = capture.lock().unwrap();
            (capture.text(), capture.revision, capture.closed)
        };
        if current_revision != revision {
            revision = current_revision;
            idle_since = Instant::now();
        }
        if let Some(status) = screen_failure(&screen) {
            result = ClaudeProbeResult::failure(status);
            break;
        }
        if closed || !matches!(child.try_wait(), Ok(None)) {
            result = ClaudeProbeResult::failure("process_failed");
            break;
        }
        if !sent_usage {
            if startup_ready(&screen) && idle_since.elapsed() >= response_idle {
                // Startup quota-like text must never be used as the /usage response.
                capture.lock().unwrap().raw.clear();
                if writer
                    .write_all(b"/usage\r")
                    .and_then(|_| writer.flush())
                    .is_err()
                {
                    result = ClaudeProbeResult::failure("process_failed");
                    break;
                }
                sent_usage = true;
                idle_since = Instant::now();
            } else if !screen.is_empty() && idle_since.elapsed() >= startup_idle {
                result = ClaudeProbeResult::failure("unsupported_output");
                break;
            }
        } else if idle_since.elapsed() >= response_idle {
            if let Some(windows) = complete_usage_windows(&screen, Utc::now()) {
                result = ClaudeProbeResult {
                    status: "supported",
                    quota_windows: windows,
                };
                break;
            }
            if !screen.is_empty() && !screen.to_lowercase().contains("refreshing") {
                result = ClaudeProbeResult::failure("unsupported_output");
                break;
            }
        }
    }

    // Only a recognized, complete usage panel may receive exit commands.
    // Login, trust and unknown dialogs receive no input, including /exit.
    if result.status == "supported" {
        let exited = (|| -> std::io::Result<bool> {
            writer.write_all(b"\x1b")?;
            writer.flush()?;
            std::thread::sleep(Duration::from_millis(150));
            writer.write_all(b"/exit\r")?;
            writer.flush()?;
            let exiting = Instant::now();
            while exiting.elapsed() < EXIT_TIMEOUT {
                if let Some(status) = child.try_wait()? {
                    return Ok(status.success());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(false)
        })()
        .unwrap_or(false);
        if !exited {
            result = ClaudeProbeResult::failure("process_failed");
        }
    }
    done.store(true, std::sync::atomic::Ordering::Relaxed);
    if matches!(child.try_wait(), Ok(None)) {
        let _ = child.kill();
    }
    let _ = child.wait();
    drop(writer);
    drop(pty_pair.master);
    // Child exit closes the slave; reap the reader instead of accumulating threads.
    let _ = reader_thread.join();
    result
}

pub fn parse_claude_usage_screen(screen: &str, now: DateTime<Utc>) -> Vec<ClaudeParsedWindow> {
    let clean = strip_ansi_escapes::strip(screen.as_bytes());
    let text = String::from_utf8_lossy(&clean);
    let normalized_text = text.replace('\r', "\n");

    let lines: Vec<&str> = normalized_text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    // Find headers
    let mut headers = Vec::new();
    for (idx, line) in lines.iter().enumerate() {
        if let Some((kind, label)) = classify_header(line) {
            headers.push((idx, kind, label));
        }
    }

    let mut parsed = Vec::new();
    for (pos, &(idx, kind, ref label)) in headers.iter().enumerate() {
        let next_idx = headers.get(pos + 1).map(|h| h.0).unwrap_or(lines.len());
        let block = &lines[idx..next_idx];

        if let Some(used_percent) = parse_percent(block) {
            let resets_at = parse_reset(block, now);
            parsed.push(ClaudeParsedWindow {
                kind,
                label: label.clone(),
                used_percent,
                resets_at,
            });
        }
    }

    let mut unique: std::collections::HashMap<String, ClaudeParsedWindow> =
        std::collections::HashMap::new();
    for window in parsed {
        let key = format!("{:?}:{}", window.kind, window.label);
        let replace = match unique.get(&key) {
            None => true,
            Some(prev) => window.resets_at.is_some() || prev.resets_at.is_none(),
        };
        if replace {
            unique.insert(key, window);
        }
    }

    let mut result: Vec<_> = unique.into_values().collect();
    result.sort_by(|a, b| a.label.cmp(&b.label));
    result
}

#[cfg(test)]
mod probe_tests {
    use super::*;

    const READY: &str = "Claude Code v0.0.0\n❯\n? for shortcuts\n";
    const READY_AX: &str = "Claude Code v0.0.0\nExample model\n/synthetic-probe\nSafe mode: customizations disabled\neffort: default\n$\n";
    const USAGE: &str = "Current session\n23% used\nCurrent week (all models)\n41% used\n";

    #[test]
    fn only_a_known_prompt_can_start_usage_and_dialogs_take_priority() {
        assert!(startup_ready(READY));
        assert!(startup_ready(READY_AX));
        for unknown in ["", ">", "$", "Loading > please wait", "An idle dialog"] {
            assert!(!startup_ready(unknown));
        }
        assert!(!startup_ready(&format!(
            "{READY}Unexpected confirmation dialog"
        )));
        assert!(!startup_ready(&format!(
            "{READY_AX}Unexpected confirmation dialog"
        )));
        for (dialog, expected) in [
            ("Do you trust this folder?", "blocked_prompt"),
            ("Please log in. Run /login", "not_authenticated"),
            ("Select an option. Enter to confirm", "unsupported_output"),
            ("HTTP 429 rate limit reached", "rate_limited"),
            ("Failed to fetch usage", "network"),
        ] {
            assert_eq!(screen_failure(&format!("{READY}{dialog}")), Some(expected));
        }
    }

    #[test]
    fn incomplete_invalid_or_refreshing_screens_never_succeed() {
        for screen in [
            "❯ /usage",
            "Current session\n23% used",
            "Current session\n101% used\nCurrent week\n41% used",
            "Current session\n-2% used\nCurrent week\n41% used",
            "Current session\n23% used\nCurrent week (Fable)\n41% used",
            "Current session\n0% used\nCurrent week\n0% used\nRefreshing…\nEsc to cancel",
        ] {
            assert!(complete_usage_windows(screen, Utc::now()).is_none());
        }
        assert!(complete_usage_windows(USAGE, Utc::now()).is_some());
        assert!(complete_usage_windows(&format!("Refreshing…\n{USAGE}"), Utc::now()).is_some());
    }

    #[test]
    fn capture_preserves_utf8_and_ansi_across_reads_and_counts_bounded_updates() {
        let input = format!("\x1b[32m{READY}{USAGE}\x1b[0m");
        let mut capture = ScreenCapture::default();
        for byte in input.bytes() {
            capture.append(&[byte]);
        }
        assert_eq!(capture.text(), format!("{READY}{USAGE}"));
        // A former prompt followed by another screen must not trigger input.
        assert!(!startup_ready(&capture.text()));
        assert!(complete_usage_windows(&capture.text(), Utc::now()).is_some());
        let mut startup = ScreenCapture::default();
        for byte in format!("\x1b[32m{READY}\x1b[0m").bytes() {
            startup.append(&[byte]);
        }
        assert!(startup_ready(&startup.text()));
        capture.append(&vec![b'a'; MAX_CAPTURE_CHARS]);
        let revision = capture.revision;
        capture.append(b"b");
        assert_eq!(capture.raw.len(), MAX_CAPTURE_CHARS);
        assert_eq!(capture.revision, revision + 1);
    }

    #[cfg(unix)]
    fn fake_probe(startup: &str, response: &str, behavior: &str) -> (ClaudeProbeResult, Vec<u8>) {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("synthetic claude");
        let log = dir.path().join("input");
        let source = format!(
            r#"#!/usr/bin/python3
import os, tty
tty.setraw(0)
log = open({}, 'ab', buffering=0)
os.write(1, {}.encode())
if {} == 'early_exit':
    os._exit(1)
line = b''
while True:
    value = os.read(0, 1)
    if not value:
        break
    log.write(value)
    if value == b'\x1b':
        continue
    line += value
    if value == b'\r':
        if line == b'/usage\r':
            os.write(1, {}.encode())
        elif line == b'/exit\r' and {} != 'ignore_exit':
            os._exit(0)
        line = b''
"#,
            serde_json::to_string(&log.to_str().unwrap()).unwrap(),
            serde_json::to_string(startup).unwrap(),
            serde_json::to_string(behavior).unwrap(),
            serde_json::to_string(response).unwrap(),
            serde_json::to_string(behavior).unwrap(),
        );
        fs::write(&script, source).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let result = run_claude_pty_probe_at(
            script.to_str().unwrap(),
            &dir.path().join("probe"),
            Duration::from_secs(3),
            Duration::from_millis(150),
            Duration::from_millis(100),
        );
        (result, fs::read(log).unwrap_or_default())
    }

    #[test]
    #[cfg(unix)]
    fn real_pty_sends_only_usage_then_graceful_exit_on_success() {
        for startup in [READY, READY_AX] {
            let (result, input) = fake_probe(startup, USAGE, "normal");
            assert_eq!(result.status, "supported");
            assert_eq!(result.quota_windows.len(), 2);
            assert_eq!(input, b"/usage\r\x1b/exit\r");
        }
    }

    #[test]
    #[cfg(unix)]
    fn real_pty_never_answers_login_trust_or_unknown_dialogs() {
        for (startup, expected) in [
            ("Do you trust this folder?", "blocked_prompt"),
            ("Please log in. Run /login", "not_authenticated"),
            ("Unexpected > dialog", "unsupported_output"),
            ("Select an option. Enter to confirm", "unsupported_output"),
        ] {
            let (result, input) = fake_probe(startup, USAGE, "normal");
            assert_eq!(result.status, expected);
            assert!(result.quota_windows.is_empty());
            assert!(input.is_empty());
        }
    }

    #[test]
    #[cfg(unix)]
    fn real_pty_rejects_partial_usage_ignores_startup_values_and_reaps_failures() {
        let (result, input) = fake_probe(
            &format!("{USAGE}{READY}"),
            "Current session\n23% used",
            "normal",
        );
        assert_eq!(result.status, "unsupported_output");
        assert_eq!(input, b"/usage\r");
        let (result, input) = fake_probe(READY, "", "normal");
        assert_eq!(result.status, "timeout");
        assert_eq!(input, b"/usage\r");
        let (result, input) = fake_probe("", "", "early_exit");
        assert_eq!(result.status, "process_failed");
        assert!(input.is_empty());
        let (result, input) = fake_probe(READY, USAGE, "ignore_exit");
        assert_eq!(result.status, "process_failed");
        assert!(result.quota_windows.is_empty());
        assert_eq!(input, b"/usage\r\x1b/exit\r");
    }
}

fn classify_header(line: &str) -> Option<(QuotaKind, String)> {
    let lower = line.to_lowercase();
    let re_5h = Regex::new(
        r"(?i)\b(?:current\s+session|session\s+limit|5[\s-]*(?:h|hour)|five[\s-]*hour)\b",
    )
    .ok()?;
    if re_5h.is_match(&lower) {
        return Some((QuotaKind::FiveHour, "5h".to_string()));
    }

    let re_week = Regex::new(r"(?i)\b(?:current\s+week|weekly|week(?:ly)?\s+limit)\b").ok()?;
    if !re_week.is_match(&lower) {
        return None;
    }

    let re_scope = Regex::new(r"[(\[]\s*([^\])]+?)\s*[\])]").ok()?;
    if let Some(cap) = re_scope.captures(line) {
        let scope = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
        let scope_lower = scope.to_lowercase();
        if scope_lower.is_empty() || scope_lower.contains("all model") || scope_lower == "overall" {
            return Some((QuotaKind::Weekly, "Weekly".to_string()));
        }
        let label = format!("{} Weekly", scope);
        return Some((QuotaKind::ModelWeekly, label));
    }

    Some((QuotaKind::Weekly, "Weekly".to_string()))
}

fn parse_percent(block: &[&str]) -> Option<f64> {
    let re_explicit = Regex::new(
        r"(?i)(?:^|[^\d.+-])([+-]?\d+(?:\.\d+)?)\s*%(?:\s+\d+(?:\.\d+)?\s*%)?\s*(used|remaining|left)\b",
    )
    .ok()?;
    for line in block {
        if is_promo_line(line) {
            continue;
        }
        if let Some(cap) = re_explicit.captures(line) {
            if let Some(val_str) = cap.get(1) {
                if let Ok(val) = val_str.as_str().parse::<f64>() {
                    if (0.0..=100.0).contains(&val) {
                        let qualifier = cap
                            .get(2)
                            .map(|m| m.as_str().to_lowercase())
                            .unwrap_or_default();
                        return Some(if qualifier == "left" || qualifier == "remaining" {
                            100.0 - val
                        } else {
                            val
                        });
                    }
                }
            }
        }
    }

    let re_any = Regex::new(r"(?i)(?:^|[^\d.+-])([+-]?\d+(?:\.\d+)?)\s*%").ok()?;
    for line in block {
        if is_promo_line(line) {
            continue;
        }
        if let Some(cap) = re_any.captures(line) {
            if let Some(val_str) = cap.get(1) {
                if let Ok(val) = val_str.as_str().parse::<f64>() {
                    if (0.0..=100.0).contains(&val) {
                        let lower = line.to_lowercase();
                        return Some(if lower.contains("left") || lower.contains("remaining") {
                            100.0 - val
                        } else {
                            val
                        });
                    }
                }
            }
        }
    }

    None
}

fn is_promo_line(line: &str) -> bool {
    let lower = line.to_lowercase();
    lower.starts_with('+')
        || lower.contains("promo")
        || lower.contains("promotion")
        || lower.contains("bonus")
        || lower.contains("boost")
        || lower.contains("clau.de")
        || lower.starts_with("nothing over")
        || lower.contains("credits are off")
}

fn parse_reset(block: &[&str], now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    // The CLI displays the host's local wall time, just like the Node collector.
    parse_reset_in_timezone(block, now, Local)
}

fn parse_reset_in_timezone<Tz: TimeZone>(
    block: &[&str],
    now: DateTime<Utc>,
    timezone: Tz,
) -> Option<DateTime<Utc>> {
    let local_now = now.with_timezone(&timezone);
    let re_reset = Regex::new(r"(?i)\bresets?\s+(?:in\s+)?(.+)$").ok()?;
    let mut reset_str = None;
    for line in block {
        if let Some(cap) = re_reset.captures(line) {
            if let Some(m) = cap.get(1) {
                reset_str = Some(m.as_str().trim().to_string());
                break;
            }
        }
    }

    let raw_reset = reset_str?;

    // 1. Duration (e.g. "2h 30m", "4d", "45 minutes", "2 hr")
    if let Some(dur) = parse_duration_str(&raw_reset) {
        return Some(now + dur);
    }

    // Strip timezone suffix e.g. (Asia/Seoul)
    let re_tz = Regex::new(r"\s*\([A-Za-z_+-]+/[A-Za-z_+/-]+\)\s*$").ok()?;
    let without_tz = re_tz.replace(&raw_reset, "").to_string();
    let normalized = without_tz.replace(" at ", " ").trim().to_string();

    // 2. Time only (e.g. "7:00 pm", "11:40pm", "5pm")
    let re_time = Regex::new(r"(?i)^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$").ok()?;
    if let Some(cap) = re_time.captures(&normalized) {
        let hour_raw: u32 = cap.get(1)?.as_str().parse().ok()?;
        let min_raw: u32 = cap
            .get(2)
            .map(|m| m.as_str().parse().unwrap_or(0))
            .unwrap_or(0);
        let meridiem = cap.get(3)?.as_str().to_lowercase();

        if !(1..=12).contains(&hour_raw) || min_raw > 59 {
            return None;
        }
        let hour24 = if meridiem == "pm" && hour_raw < 12 {
            hour_raw + 12
        } else if meridiem == "am" && hour_raw == 12 {
            0
        } else {
            hour_raw
        };

        let date = local_now.date_naive();
        let candidate = date.and_hms_opt(hour24, min_raw, 0)?;
        let candidate_utc = timezone
            .from_local_datetime(&candidate)
            .single()?
            .with_timezone(&Utc);
        return if candidate_utc <= now {
            let next = date.succ_opt()?.and_hms_opt(hour24, min_raw, 0)?;
            timezone
                .from_local_datetime(&next)
                .single()
                .map(|t| t.with_timezone(&Utc))
        } else {
            Some(candidate_utc)
        };
    }

    // 3. Dated format (e.g. "Sep 5, 5pm", "Jan 2, 5pm")
    let re_dated =
        Regex::new(r"(?i)^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$")
            .ok()?;
    if let Some(cap) = re_dated.captures(&normalized) {
        let month_str = cap.get(1)?.as_str();
        let day: u32 = cap.get(2)?.as_str().parse().ok()?;
        let hour_raw: u32 = cap.get(3)?.as_str().parse().ok()?;
        let min_raw: u32 = cap
            .get(4)
            .map(|m| m.as_str().parse().unwrap_or(0))
            .unwrap_or(0);
        let meridiem = cap.get(5)?.as_str().to_lowercase();

        let month = match &month_str[..3].to_lowercase()[..] {
            "jan" => 1,
            "feb" => 2,
            "mar" => 3,
            "apr" => 4,
            "may" => 5,
            "jun" => 6,
            "jul" => 7,
            "aug" => 8,
            "sep" => 9,
            "oct" => 10,
            "nov" => 11,
            "dec" => 12,
            _ => return None,
        };

        if !(1..=12).contains(&hour_raw) || min_raw > 59 {
            return None;
        }
        let hour24 = if meridiem == "pm" && hour_raw < 12 {
            hour_raw + 12
        } else if meridiem == "am" && hour_raw == 12 {
            0
        } else {
            hour_raw
        };

        let mut year = local_now.year();
        if let Some(naive_date) = chrono::NaiveDate::from_ymd_opt(year, month, day) {
            if let Some(candidate_naive) = naive_date.and_hms_opt(hour24, min_raw, 0) {
                let candidate_utc = timezone
                    .from_local_datetime(&candidate_naive)
                    .single()?
                    .with_timezone(&Utc);
                if candidate_utc < now - ChronoDuration::days(1) {
                    year += 1;
                    if let Some(next_date) = chrono::NaiveDate::from_ymd_opt(year, month, day) {
                        if let Some(next_naive) = next_date.and_hms_opt(hour24, min_raw, 0) {
                            return timezone
                                .from_local_datetime(&next_naive)
                                .single()
                                .map(|t| t.with_timezone(&Utc));
                        }
                    }
                }
                return Some(candidate_utc);
            }
        }
    }

    None
}

fn parse_duration_str(val: &str) -> Option<ChronoDuration> {
    let re = Regex::new(r"(?i)(\d+)\s*(d|days?|h|hrs?|hours?|m|mins?|minutes?)").ok()?;
    let mut total_mins = 0i64;
    let mut matched = false;

    for cap in re.captures_iter(val) {
        matched = true;
        let amount: i64 = cap.get(1)?.as_str().parse().ok()?;
        let unit = cap.get(2)?.as_str().to_lowercase();

        if unit.starts_with('d') {
            total_mins += amount * 1440;
        } else if unit.starts_with('h') {
            total_mins += amount * 60;
        } else {
            total_mins += amount;
        }
    }

    if matched {
        Some(ChronoDuration::minutes(total_mins))
    } else {
        None
    }
}

fn failure_snapshot(fetched_at: DateTime<Utc>, code: &str, message: &str) -> ProviderSnapshot {
    ProviderSnapshot {
        provider_id: ProviderId::Claude,
        account_label: None,
        auth_kind: None,
        status: SnapshotStatus::Unavailable,
        fetched_at,
        last_successful_at: None,
        quota_windows: Vec::new(),
        local_usage: None,
        error: Some(ProviderError {
            code: code.to_string(),
            message: message.to_string(),
            retry_at: None,
        }),
        service_status: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_claude_usage_screen() {
        let now = DateTime::parse_from_rfc3339("2026-09-01T03:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let screen = "Current session\n23% used\nResets in 2 hr 30 min\nCurrent week (all models)\n41% used\nResets in 3 days\nCurrent week (Example model)\n60% remaining\nResets in 4 days";
        let windows = parse_claude_usage_screen(screen, now);

        assert_eq!(windows.len(), 3);
        let five_hour = windows
            .iter()
            .find(|w| w.kind == QuotaKind::FiveHour)
            .unwrap();
        assert_eq!(five_hour.label, "5h");
        assert_eq!(five_hour.used_percent, 23.0);
        assert!(five_hour.resets_at.is_some());

        let weekly = windows
            .iter()
            .find(|w| w.kind == QuotaKind::Weekly)
            .unwrap();
        assert_eq!(weekly.label, "Weekly");
        assert_eq!(weekly.used_percent, 41.0);

        let model_weekly = windows
            .iter()
            .find(|w| w.kind == QuotaKind::ModelWeekly)
            .unwrap();
        assert_eq!(model_weekly.label, "Example model Weekly");
        assert_eq!(model_weekly.used_percent, 40.0);
    }

    #[test]
    fn reset_uses_local_wall_time_instead_of_utc() {
        let seoul = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
        let now = DateTime::parse_from_rfc3339("2026-09-19T22:54:00Z")
            .unwrap()
            .with_timezone(&Utc);
        for line in [
            "Resets 5pm (Asia/Seoul)",
            "Resets Sep 20, 5pm (Asia/Seoul)",
            "Resets 5pm",
        ] {
            let reset = parse_reset_in_timezone(&[line], now, seoul).unwrap();
            assert_eq!(reset.to_rfc3339(), "2026-09-20T08:00:00+00:00");
            assert_eq!(reset - now, ChronoDuration::minutes(9 * 60 + 6));
        }
        let screen = "Current week (all models)\n41% used\nResets Sep 20, 5pm (Asia/Seoul)";
        let windows = parse_claude_usage_screen(screen, now);
        let expected = Local
            .with_ymd_and_hms(2026, 9, 20, 17, 0, 0)
            .single()
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(windows[0].resets_at, Some(expected));
    }

    #[test]
    fn reset_uses_local_date_for_midnight_and_year_rollover() {
        let seoul = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
        let parse = |now: &str, line: &str| {
            parse_reset_in_timezone(
                &[line],
                DateTime::parse_from_rfc3339(now)
                    .unwrap()
                    .with_timezone(&Utc),
                seoul,
            )
            .unwrap()
            .to_rfc3339()
        };
        assert_eq!(
            parse("2026-09-19T15:30:00Z", "Resets 1am"),
            "2026-09-19T16:00:00+00:00"
        );
        assert_eq!(
            parse("2026-09-20T09:00:00Z", "Resets 5pm"),
            "2026-09-21T08:00:00+00:00"
        );
        assert_eq!(
            parse("2026-12-31T16:00:00Z", "Resets Jan 2, 5pm"),
            "2027-01-02T08:00:00+00:00"
        );
        assert_eq!(
            parse("2026-12-31T10:00:00Z", "Resets Jan 2, 5pm"),
            "2027-01-02T08:00:00+00:00"
        );
    }

    #[test]
    fn reset_keeps_relative_durations_and_rejects_invalid_times() {
        let now = DateTime::parse_from_rfc3339("2026-09-20T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        for offset in [-7 * 3600, 0, 9 * 3600] {
            let zone = chrono::FixedOffset::east_opt(offset).unwrap();
            assert_eq!(
                parse_reset_in_timezone(&["Resets in 2 hr 30 min"], now, zone),
                Some(now + ChronoDuration::minutes(150))
            );
            for invalid in [
                "Resets 13pm",
                "Resets 0am",
                "Resets 7:60pm",
                "Resets Feb 30, 5pm",
                "Unknown reset",
                "Resets unknown",
            ] {
                assert_eq!(parse_reset_in_timezone(&[invalid], now, zone), None);
            }
        }
    }
}
