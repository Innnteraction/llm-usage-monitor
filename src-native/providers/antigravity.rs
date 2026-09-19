use crate::core::types::{
    ProviderAuthKind, ProviderError, ProviderId, ProviderSnapshot, ProviderSource, QuotaKind,
    QuotaWindow, SnapshotStatus,
};
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Deserialize;
use std::env;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const USAGE_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_LOG_TAIL_BYTES: u64 = 20_480;

#[derive(Debug, Deserialize)]
struct BucketJson {
    window: String,
    remaining_fraction: Option<f64>,
    reset_time: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
struct GroupJson {
    name: String,
    buckets: Vec<BucketJson>,
}

#[derive(Debug, Deserialize)]
struct CommandDataJson {
    groups: Vec<GroupJson>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    user_email: Option<String>,
    #[serde(default)]
    account: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CommandJson {
    name: String,
    data: CommandDataJson,
}

#[derive(Debug, Deserialize)]
struct UsageRootJson {
    status: String,
    num_turns: f64,
    command: CommandJson,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    user_email: Option<String>,
    #[serde(default)]
    account: Option<String>,
}

pub struct AntigravityProvider {
    command_name: String,
}

impl Default for AntigravityProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl AntigravityProvider {
    pub fn new() -> Self {
        let command_name = env::var("ANTIGRAVITY_CLI_PATH").unwrap_or_else(|_| "agy".to_string());
        Self { command_name }
    }

    pub fn with_command(command_name: String) -> Self {
        Self { command_name }
    }

    pub async fn fetch_quota(&self) -> ProviderSnapshot {
        let fetched_at = Utc::now();

        // 1. Verify CLI executable & version
        let version_result = tokio::time::timeout(
            VERSION_TIMEOUT,
            Command::new(&self.command_name)
                .kill_on_drop(true)
                .arg("--version")
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        let version_output = match version_result {
            Ok(Ok(output)) => output,
            Ok(Err(e)) => {
                let code = if e.kind() == std::io::ErrorKind::NotFound {
                    "not_installed"
                } else {
                    "process_failed"
                };
                return failure_snapshot(
                    fetched_at,
                    code,
                    "Install the Antigravity CLI to view quota.",
                );
            }
            Err(_) => {
                return failure_snapshot(
                    fetched_at,
                    "timeout",
                    "Antigravity CLI did not respond before the timeout.",
                );
            }
        };

        if !version_output.status.success() {
            let stderr = String::from_utf8_lossy(&version_output.stderr);
            let (code, msg) = classify_error(&stderr);
            return failure_snapshot(fetched_at, code, msg);
        }

        // 2. Fetch usage
        let usage_result = tokio::time::timeout(
            USAGE_TIMEOUT,
            Command::new(&self.command_name)
                .kill_on_drop(true)
                .args([
                    "--print",
                    "/usage",
                    "--output-format",
                    "json",
                    "--print-timeout",
                    "20s",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;

        let usage_output = match usage_result {
            Ok(Ok(output)) => output,
            Ok(Err(_)) => {
                return failure_snapshot(
                    fetched_at,
                    "process_failed",
                    "Antigravity CLI stopped during quota refresh.",
                );
            }
            Err(_) => {
                return failure_snapshot(
                    fetched_at,
                    "timeout",
                    "Antigravity CLI did not respond before the timeout.",
                );
            }
        };

        let stdout_str = String::from_utf8_lossy(&usage_output.stdout);
        let stderr_str = String::from_utf8_lossy(&usage_output.stderr);

        if !usage_output.status.success() {
            let (code, msg) = classify_error(&stderr_str);
            return failure_snapshot(fetched_at, code, msg);
        }

        // 3. Parse JSON response
        let parsed: UsageRootJson = match serde_json::from_str(&stdout_str) {
            Ok(json) => json,
            Err(_) => {
                return failure_snapshot(
                    fetched_at,
                    "unsupported_output",
                    "Antigravity CLI returned an unsupported quota response.",
                );
            }
        };

        if parsed.status.trim().to_lowercase() != "success"
            || parsed.num_turns != 0.0
            || !["usage", "/usage"].contains(&parsed.command.name.trim().to_lowercase().as_str())
        {
            return failure_snapshot(
                fetched_at,
                "unsupported_output",
                "Antigravity CLI returned an unsupported quota response.",
            );
        }

        // 4. Normalize QuotaWindows
        let mut quota_windows = Vec::new();
        for group in parsed.command.data.groups {
            let group_lower = group.name.trim().to_lowercase();
            let (group_id, group_label) = match group_lower.as_str() {
                "gemini models" => ("gemini", "Gemini"),
                "claude and gpt models" => ("claude-gpt", "Claude/GPT"),
                _ => continue,
            };

            for bucket in group.buckets {
                let win_lower = bucket.window.trim().to_lowercase();
                let (win_id, win_kind, win_label) = match win_lower.as_str() {
                    "weekly" => ("weekly", QuotaKind::ModelWeekly, "Weekly"),
                    "5h" => ("5h", QuotaKind::FiveHour, "5h"),
                    _ => continue,
                };

                if bucket
                    .remaining_fraction
                    .is_some_and(|f| !f.is_finite() || !(0.0..=1.0).contains(&f))
                {
                    return failure_snapshot(
                        fetched_at,
                        "unsupported_output",
                        "Antigravity quota response has invalid values.",
                    );
                }
                let used_percent = bucket
                    .remaining_fraction
                    .map(|f| ((1.0 - f) * 100.0).round().clamp(0.0, 100.0));

                let status = if bucket.remaining_fraction.is_some() {
                    SnapshotStatus::Fresh
                } else {
                    SnapshotStatus::Unavailable
                };

                quota_windows.push(QuotaWindow {
                    id: format!("agy-{}-{}", group_id, win_id),
                    kind: win_kind,
                    label: format!("{} {}", group_label, win_label),
                    used_percent,
                    resets_at: bucket.reset_time,
                    source: ProviderSource::AntigravityCli,
                    status,
                });
            }
        }

        // 5. Account label extraction (from json or cli.log)
        let account_label = parsed
            .command
            .data
            .email
            .or(parsed.command.data.user_email)
            .or(parsed.command.data.account)
            .or(parsed.email)
            .or(parsed.user_email)
            .or(parsed.account)
            .or_else(read_account_from_cli_log);

        ProviderSnapshot {
            provider_id: ProviderId::Antigravity,
            account_label,
            auth_kind: Some(ProviderAuthKind::Subscription),
            status: SnapshotStatus::Fresh,
            fetched_at,
            last_successful_at: Some(fetched_at),
            quota_windows,
            local_usage: None,
            error: None,
            service_status: None,
        }
    }
}

fn classify_error(stderr: &str) -> (&'static str, &'static str) {
    let lower = stderr.to_lowercase();
    if lower.contains("not logged in")
        || lower.contains("login required")
        || lower.contains("unauthenticated")
        || lower.contains("auth")
    {
        (
            "not_authenticated",
            "Sign in with the Antigravity CLI to view quota.",
        )
    } else if lower.contains("rate limit") || lower.contains("too many requests") {
        (
            "rate_limited",
            "Antigravity CLI rate limited the quota request.",
        )
    } else if lower.contains("network")
        || lower.contains("econnrefused")
        || lower.contains("unreachable")
    {
        ("network", "Antigravity CLI could not reach its service.")
    } else {
        (
            "process_failed",
            "Antigravity CLI stopped during quota refresh.",
        )
    }
}

fn failure_snapshot(fetched_at: DateTime<Utc>, code: &str, message: &str) -> ProviderSnapshot {
    ProviderSnapshot {
        provider_id: ProviderId::Antigravity,
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

pub fn read_account_from_cli_log() -> Option<String> {
    let home = dirs::home_dir()?;
    let log_path = home.join(".gemini").join("antigravity-cli").join("cli.log");
    extract_account_from_log_file(&log_path)
}

fn extract_account_from_log_file(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    let file_len = metadata.len();
    if file_len == 0 {
        return None;
    }

    let read_len = std::cmp::min(file_len, MAX_LOG_TAIL_BYTES);
    let start_pos = file_len - read_len;
    file.seek(SeekFrom::Start(start_pos)).ok()?;

    let mut buf = vec![0u8; read_len as usize];
    file.read_exact(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);

    let re1 = Regex::new(r"applyAuthResult:\s*email=([^\s,]+)").ok()?;
    let re2 = Regex::new(r"OAuth:\s*authenticated successfully as ([^\s,]+)").ok()?;

    let mut found = None;
    for cap in re1.captures_iter(&text) {
        if let Some(m) = cap.get(1) {
            let email = m.as_str().trim();
            if email.contains('@') && email.len() <= 80 {
                found = Some(email.to_string());
            }
        }
    }
    for cap in re2.captures_iter(&text) {
        if let Some(m) = cap.get(1) {
            let email = m.as_str().trim();
            if email.contains('@') && email.len() <= 80 {
                found = Some(email.to_string());
            }
        }
    }

    found
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn errors_are_classified_without_exposing_original_output() {
        for (input, expected) in [
            ("not logged in", "not_authenticated"),
            ("too many requests", "rate_limited"),
            ("network unreachable", "network"),
            ("unexpected fixture", "process_failed"),
        ] {
            let (code, message) = classify_error(input);
            assert_eq!(code, expected);
            assert!(!message.contains("unexpected fixture"));
        }
    }
    #[tokio::test]
    async fn missing_cli_is_unavailable() {
        let s = AntigravityProvider::with_command("nonexistent-llm-monitor-fixture-command".into())
            .fetch_quota()
            .await;
        assert_eq!(s.error.unwrap().code, "not_installed");
    }
}
