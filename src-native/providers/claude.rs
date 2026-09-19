use crate::core::types::{
    ProviderAuthKind, ProviderError, ProviderId, ProviderSnapshot, ProviderSource, QuotaKind,
    QuotaWindow, SnapshotStatus,
};
use chrono::{DateTime, Datelike, Duration as ChronoDuration, TimeZone, Utc};
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
    #[serde(default)]
    plan: Option<String>,
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

        let (status, usage_screen) = match pty_res {
            Ok(res) => res,
            Err(_) => {
                return failure_snapshot(
                    fetched_at,
                    "process_failed",
                    "Claude PTY task panicked or failed.",
                );
            }
        };

        if status != "supported" {
            let (code, msg) = match status.as_str() {
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
                _ => (
                    "unsupported_output",
                    "Claude Code CLI returned an unsupported quota response.",
                ),
            };
            return failure_snapshot(fetched_at, code, msg);
        }

        // 2. Parse usage screen into QuotaWindows
        let parsed_windows = parse_claude_usage_screen(&usage_screen, fetched_at);
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

fn run_claude_pty_probe(command_name: &str) -> (String, String) {
    let pty_system = native_pty_system();
    let pty_pair = match pty_system.openpty(PtySize {
        rows: 40,
        cols: 120,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(_) => return ("process_failed".to_string(), String::new()),
    };

    let probe_dir = resolve_claude_probe_dir();
    let _ = fs::create_dir_all(&probe_dir);

    let mut cmd = CommandBuilder::new(command_name);
    for arg in CLAUDE_SAFE_SESSION_ARGS {
        cmd.arg(arg);
    }
    cmd.cwd(&probe_dir);
    cmd.env("CLAUDE_CODE_SAFE_MODE", "1");
    cmd.env("NO_COLOR", "1");
    cmd.env("TERM", "xterm-256color");

    let mut child = match pty_pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(_) => return ("not_installed".to_string(), String::new()),
    };

    drop(pty_pair.slave);

    let mut reader = match pty_pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(_) => return ("process_failed".to_string(), String::new()),
    };
    let mut writer = match pty_pair.master.take_writer() {
        Ok(w) => w,
        Err(_) => return ("process_failed".to_string(), String::new()),
    };

    let screen_text = Arc::new(std::sync::Mutex::new(String::new()));
    let screen_text_clone = Arc::clone(&screen_text);
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let done_clone = Arc::clone(&done);

    // Spawn dedicated background reader thread
    let _reader_thread = std::thread::spawn(move || {
        let mut raw_buf = [0u8; 4096];
        while !done_clone.load(std::sync::atomic::Ordering::Relaxed) {
            match reader.read(&mut raw_buf) {
                Ok(n) if n > 0 => {
                    let clean = strip_ansi_escapes::strip(&raw_buf[..n]);
                    let chunk = String::from_utf8_lossy(&clean);
                    let mut guard = screen_text_clone.lock().unwrap();
                    guard.push_str(&chunk);
                    if guard.len() > MAX_CAPTURE_CHARS {
                        let mut excess = guard.len() - MAX_CAPTURE_CHARS;
                        while !guard.is_char_boundary(excess) {
                            excess += 1;
                        }
                        guard.drain(..excess);
                    }
                }
                _ => break,
            }
        }
    });

    let start_time = Instant::now();
    let mut sent_usage = false;
    let mut status = "process_failed".to_string();
    let mut last_len = 0;
    let mut idle_start = Instant::now();

    while start_time.elapsed() < PROBE_TIMEOUT {
        std::thread::sleep(Duration::from_millis(100));

        let current_text = {
            let guard = screen_text.lock().unwrap();
            guard.clone()
        };

        if current_text.len() != last_len {
            last_len = current_text.len();
            idle_start = Instant::now();
        }

        let lower = current_text.to_lowercase();
        if lower.contains("not logged in")
            || lower.contains("not authenticated")
            || lower.contains("run /login")
        {
            status = "not_authenticated".to_string();
            break;
        }
        if lower.contains("trust this folder")
            || lower.contains("workspace trust")
            || lower.contains("do you trust")
        {
            status = "blocked_prompt".to_string();
            break;
        }

        if !sent_usage {
            // Check if startup reached prompt or idle
            if idle_start.elapsed() >= STARTUP_IDLE
                || current_text.contains('>')
                || current_text.contains("shortcuts")
            {
                sent_usage = true;
                let _ = writer.write_all(b"/usage\r");
                let _ = writer.flush();
                idle_start = Instant::now();
            }
        } else {
            // Check if /usage output has arrived
            let has_5h =
                lower.contains("session") || lower.contains("5h") || lower.contains("5-hour");
            let has_week = lower.contains("week");
            let has_percent = current_text.contains('%');
            let is_refreshing = lower.contains("refreshing");

            if has_5h && has_week && has_percent && !is_refreshing {
                if idle_start.elapsed() >= RESPONSE_IDLE {
                    status = "supported".to_string();
                    break;
                }
            } else if idle_start.elapsed() >= Duration::from_secs(6) && has_percent {
                status = "supported".to_string();
                break;
            }
        }
    }

    if start_time.elapsed() >= PROBE_TIMEOUT {
        status = "timeout".to_string();
    }

    // Graceful exit
    let _ = writer.write_all(b"\x1b");
    std::thread::sleep(Duration::from_millis(150));
    let _ = writer.write_all(b"/exit\r");
    let _ = writer.flush();

    done.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = child.kill();

    let final_text = screen_text.lock().unwrap().clone();
    (status, final_text)
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
        r"(?i)(?:^|[^\d+])(\d+(?:\.\d+)?)\s*%(?:\s+\d+(?:\.\d+)?\s*%)?\s*(used|remaining|left)\b",
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

    let re_any = Regex::new(r"(?i)(?:^|[^\d+])(\d+(?:\.\d+)?)\s*%").ok()?;
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

        let hour24 = if meridiem == "pm" && hour_raw < 12 {
            hour_raw + 12
        } else if meridiem == "am" && hour_raw == 12 {
            0
        } else {
            hour_raw
        };

        if let Some(candidate) = now.date_naive().and_hms_opt(hour24, min_raw, 0) {
            let candidate_utc = Utc.from_utc_datetime(&candidate);
            return if candidate_utc <= now {
                Some(candidate_utc + ChronoDuration::days(1))
            } else {
                Some(candidate_utc)
            };
        }
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

        let hour24 = if meridiem == "pm" && hour_raw < 12 {
            hour_raw + 12
        } else if meridiem == "am" && hour_raw == 12 {
            0
        } else {
            hour_raw
        };

        let mut year = now.year();
        if let Some(naive_date) = chrono::NaiveDate::from_ymd_opt(year, month, day) {
            if let Some(candidate_naive) = naive_date.and_hms_opt(hour24, min_raw, 0) {
                let candidate_utc = Utc.from_utc_datetime(&candidate_naive);
                if candidate_utc < now - ChronoDuration::days(1) {
                    year += 1;
                    if let Some(next_date) = chrono::NaiveDate::from_ymd_opt(year, month, day) {
                        if let Some(next_naive) = next_date.and_hms_opt(hour24, min_raw, 0) {
                            return Some(Utc.from_utc_datetime(&next_naive));
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
    fn test_dated_reset_with_tz() {
        let now = DateTime::parse_from_rfc3339("2026-09-01T03:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let screen = "Current week (all models)\n41% used\nResets Sep 5, 5pm (Asia/Seoul)";
        let clean = strip_ansi_escapes::strip(screen.as_bytes());
        let text = String::from_utf8_lossy(&clean);
        let normalized = text.replace('\r', "\n");
        let lines: Vec<&str> = normalized
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        println!("lines: {:?}", lines);
        for l in &lines {
            println!("header for '{}': {:?}", l, classify_header(l));
        }
        let windows = parse_claude_usage_screen(screen, now);
        println!("windows: {:?}", windows);
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0].used_percent, 41.0);
        assert!(windows[0].resets_at.is_some());
    }
}
