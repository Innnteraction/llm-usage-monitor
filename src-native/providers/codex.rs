use crate::core::types::{
    ProviderAuthKind, ProviderError, ProviderId, ProviderSnapshot, ProviderSource, QuotaKind,
    QuotaWindow, SnapshotStatus,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};

const FIVE_HOUR_MINUTES: i64 = 5 * 60;
const WEEKLY_MINUTES: i64 = 7 * 24 * 60;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize)]
struct CodexAccountInfo {
    #[serde(default)]
    email: Option<String>,
    #[serde(rename = "planType", default)]
    plan_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexAccountResponse {
    #[serde(default)]
    account: Option<CodexAccountInfo>,
    #[serde(rename = "requiresOpenaiAuth", default)]
    requires_openai_auth: bool,
}

#[derive(Debug, Deserialize)]
struct CodexRateLimitWindow {
    #[serde(rename = "usedPercent")]
    used_percent: f64,
    #[serde(rename = "windowDurationMins", default)]
    window_duration_mins: Option<i64>,
    #[serde(rename = "resetsAt", default)]
    resets_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct CodexRateLimitSnapshot {
    #[serde(rename = "limitId", default)]
    limit_id: Option<String>,
    #[serde(rename = "limitName", default)]
    limit_name: Option<String>,
    #[serde(default)]
    primary: Option<CodexRateLimitWindow>,
    #[serde(default)]
    secondary: Option<CodexRateLimitWindow>,
}

#[derive(Debug, Deserialize)]
struct CodexRateLimitsResponse {
    #[serde(rename = "rateLimits")]
    rate_limits: CodexRateLimitSnapshot,
    #[serde(rename = "rateLimitsByLimitId", default)]
    rate_limits_by_limit_id: Option<HashMap<String, CodexRateLimitSnapshot>>,
}

pub struct CodexProvider {
    command_name: String,
}

impl Default for CodexProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl CodexProvider {
    pub fn new() -> Self {
        let command_name = env::var("CODEX_CLI_PATH").unwrap_or_else(|_| "codex".to_string());
        Self { command_name }
    }

    pub fn with_command(command_name: String) -> Self {
        Self { command_name }
    }

    pub async fn fetch_quota(&self) -> ProviderSnapshot {
        let fetched_at = Utc::now();

        // 1. Spawn codex app-server --stdio
        let mut child = match super::background_command(&self.command_name)
            .args(["app-server", "--stdio"])
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                let code = if e.kind() == std::io::ErrorKind::NotFound {
                    "not_installed"
                } else {
                    "process_failed"
                };
                return failure_snapshot(fetched_at, code, "Install the Codex CLI to view quota.");
            }
        };

        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout);
        let mut writer = stdin;

        let result = self.execute_rpc_session(&mut reader, &mut writer).await;

        let _ = child.kill().await;

        match result {
            Ok((account, rate_limits)) => {
                normalize_codex_snapshot(account, rate_limits, fetched_at)
            }
            Err((code, msg)) => failure_snapshot(fetched_at, &code, &msg),
        }
    }

    async fn execute_rpc_session(
        &self,
        reader: &mut BufReader<ChildStdout>,
        writer: &mut ChildStdin,
    ) -> Result<(CodexAccountResponse, CodexRateLimitsResponse), (String, String)> {
        // Step 1: initialize
        let init_req = json!({
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": { "name": "llm-usage-monitor", "version": "0.1.0" },
                "capabilities": { "experimentalApi": false }
            }
        });
        send_json(writer, &init_req).await?;
        read_response_matching_id(reader, 1).await?;

        // Step 2: initialized notification
        let initialized_notif = json!({ "method": "initialized" });
        send_json(writer, &initialized_notif).await?;

        // Step 3: account/read
        let account_req = json!({
            "id": 2,
            "method": "account/read",
            "params": {}
        });
        send_json(writer, &account_req).await?;
        let account_val = read_response_matching_id(reader, 2).await?;
        let account: CodexAccountResponse = serde_json::from_value(account_val).map_err(|_| {
            (
                "unsupported_output".to_string(),
                "The installed Codex CLI returned an unsupported response.".to_string(),
            )
        })?;

        if account.requires_openai_auth && account.account.is_none() {
            return Ok((
                account,
                serde_json::from_value(json!({"rateLimits": {}})).unwrap(),
            ));
        }

        // Step 4: rateLimits/read
        let limits_req = json!({
            "id": 3,
            "method": "account/rateLimits/read",
            "params": {}
        });
        send_json(writer, &limits_req).await?;
        let limits_val = read_response_matching_id(reader, 3).await?;
        let rate_limits: CodexRateLimitsResponse =
            serde_json::from_value(limits_val).map_err(|_| {
                (
                    "unsupported_output".to_string(),
                    "The installed Codex CLI returned an unsupported response.".to_string(),
                )
            })?;

        Ok((account, rate_limits))
    }
}

async fn send_json(writer: &mut ChildStdin, val: &Value) -> Result<(), (String, String)> {
    let mut line = serde_json::to_string(val).map_err(|_| {
        (
            "unexpected".to_string(),
            "Failed to serialize JSON-RPC message".to_string(),
        )
    })?;
    line.push('\n');
    writer.write_all(line.as_bytes()).await.map_err(|_| {
        (
            "process_failed".to_string(),
            "Codex App Server stopped during quota refresh.".to_string(),
        )
    })?;
    writer.flush().await.map_err(|_| {
        (
            "process_failed".to_string(),
            "Codex App Server stopped during quota refresh.".to_string(),
        )
    })?;
    Ok(())
}

async fn read_response_matching_id(
    reader: &mut (impl AsyncBufRead + Unpin),
    target_id: i64,
) -> Result<Value, (String, String)> {
    tokio::time::timeout(REQUEST_TIMEOUT, async {
        let mut line = String::new();
        loop {
            line.clear();
            let bytes_read = reader.read_line(&mut line).await.map_err(|_| {
                (
                    "process_failed".to_string(),
                    "Codex App Server stopped during quota refresh.".to_string(),
                )
            })?;
            if bytes_read == 0 {
                return Err((
                    "process_failed".to_string(),
                    "Codex App Server stopped during quota refresh.".to_string(),
                ));
            }

            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                if let Some(id) = val.get("id").and_then(|v| v.as_i64()) {
                    if id == target_id {
                        if val.get("error").is_some() {
                            return Err((
                                "unavailable".to_string(),
                                "Codex App Server could not provide quota.".to_string(),
                            ));
                        }
                        if let Some(result) = val.get("result") {
                            return Ok(result.clone());
                        }
                        return Err((
                            "unsupported_output".to_string(),
                            "The installed Codex CLI returned an unsupported response.".to_string(),
                        ));
                    }
                }
            }
        }
    })
    .await
    .unwrap_or_else(|_| Err(("timeout".into(), "Codex quota refresh timed out.".into())))
}

fn normalize_codex_snapshot(
    account: CodexAccountResponse,
    rate_limits: CodexRateLimitsResponse,
    fetched_at: DateTime<Utc>,
) -> ProviderSnapshot {
    if account.requires_openai_auth && account.account.is_none() {
        return ProviderSnapshot {
            provider_id: ProviderId::Codex,
            account_label: None,
            auth_kind: None,
            status: SnapshotStatus::Unavailable,
            fetched_at,
            last_successful_at: None,
            quota_windows: expected_unavailable_windows(),
            local_usage: None,
            error: Some(ProviderError {
                code: "not_authenticated".to_string(),
                message: "Sign in with the Codex CLI to view quota.".to_string(),
                retry_at: None,
            }),
            service_status: None,
        };
    }

    let valid_window = |w: &CodexRateLimitWindow| {
        w.used_percent.is_finite()
            && (0.0..=100.0).contains(&w.used_percent)
            && w.window_duration_mins.is_none_or(|v| v > 0)
            && w.resets_at
                .is_none_or(|t| t >= 0 && unix_secs_to_datetime(t).is_some())
    };
    let valid_snapshot = |s: &CodexRateLimitSnapshot| {
        s.primary.as_ref().is_none_or(&valid_window)
            && s.secondary.as_ref().is_none_or(&valid_window)
    };
    if !valid_snapshot(&rate_limits.rate_limits)
        || rate_limits
            .rate_limits_by_limit_id
            .as_ref()
            .is_some_and(|m| m.values().any(|s| !valid_snapshot(s)))
    {
        return failure_snapshot(
            fetched_at,
            "unsupported_output",
            "Codex quota response has invalid values.",
        );
    }

    let account_label = account
        .account
        .as_ref()
        .and_then(|acc| acc.email.clone().or_else(|| acc.plan_type.clone()));

    let quota_windows = normalize_rate_limits(&rate_limits);

    ProviderSnapshot {
        provider_id: ProviderId::Codex,
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

fn normalize_rate_limits(response: &CodexRateLimitsResponse) -> Vec<QuotaWindow> {
    let mut windows = Vec::new();

    // 1. Primary (5h)
    if let Some(primary) = &response.rate_limits.primary {
        let is_5h = primary.window_duration_mins == Some(FIVE_HOUR_MINUTES);
        windows.push(QuotaWindow {
            id: if is_5h {
                "codex-five-hour".to_string()
            } else {
                "codex-base-primary".to_string()
            },
            kind: if is_5h {
                QuotaKind::FiveHour
            } else {
                QuotaKind::Other
            },
            label: if is_5h {
                "5h".to_string()
            } else {
                "Primary quota".to_string()
            },
            used_percent: Some(primary.used_percent),
            resets_at: primary.resets_at.and_then(unix_secs_to_datetime),
            source: ProviderSource::CodexAppServer,
            status: SnapshotStatus::Fresh,
        });
    } else {
        windows.push(QuotaWindow {
            id: "codex-five-hour".to_string(),
            kind: QuotaKind::FiveHour,
            label: "5h".to_string(),
            used_percent: None,
            resets_at: None,
            source: ProviderSource::CodexAppServer,
            status: SnapshotStatus::Unavailable,
        });
    }

    // 2. Secondary (Weekly)
    if let Some(sec) = &response.rate_limits.secondary {
        let is_weekly = sec.window_duration_mins == Some(WEEKLY_MINUTES);
        windows.push(QuotaWindow {
            id: if is_weekly {
                "codex-weekly".to_string()
            } else {
                "codex-base-secondary".to_string()
            },
            kind: if is_weekly {
                QuotaKind::Weekly
            } else {
                QuotaKind::Other
            },
            label: if is_weekly {
                "Weekly".to_string()
            } else {
                "Secondary quota".to_string()
            },
            used_percent: Some(sec.used_percent),
            resets_at: sec.resets_at.and_then(unix_secs_to_datetime),
            source: ProviderSource::CodexAppServer,
            status: SnapshotStatus::Fresh,
        });
    } else {
        windows.push(QuotaWindow {
            id: "codex-weekly".to_string(),
            kind: QuotaKind::Weekly,
            label: "Weekly".to_string(),
            used_percent: None,
            resets_at: None,
            source: ProviderSource::CodexAppServer,
            status: SnapshotStatus::Unavailable,
        });
    }

    // 3. Additional limits
    if let Some(by_id) = &response.rate_limits_by_limit_id {
        let mut sorted_keys: Vec<_> = by_id.keys().collect();
        sorted_keys.sort();

        for key in sorted_keys {
            if let Some(snapshot) = by_id.get(key) {
                let label_prefix = snapshot
                    .limit_name
                    .as_deref()
                    .or(snapshot.limit_id.as_deref())
                    .unwrap_or(key);
                let account_weekly = !windows
                    .iter()
                    .any(|w| w.kind == QuotaKind::Weekly && w.status == SnapshotStatus::Fresh)
                    && [
                        Some(key.as_str()),
                        snapshot.limit_id.as_deref(),
                        snapshot.limit_name.as_deref(),
                    ]
                    .into_iter()
                    .flatten()
                    .any(|v| v.trim().eq_ignore_ascii_case("codex"));
                if let Some(pri) = &snapshot.primary {
                    windows.push(QuotaWindow {
                        id: format!("codex-limit-{}-primary", key.to_lowercase()),
                        kind: if pri.window_duration_mins == Some(WEEKLY_MINUTES) {
                            if account_weekly {
                                QuotaKind::Weekly
                            } else {
                                QuotaKind::ModelWeekly
                            }
                        } else {
                            QuotaKind::Other
                        },
                        label: if account_weekly && pri.window_duration_mins == Some(WEEKLY_MINUTES)
                        {
                            "Weekly".into()
                        } else {
                            format!("{} Primary", label_prefix)
                        },
                        used_percent: Some(pri.used_percent),
                        resets_at: pri.resets_at.and_then(unix_secs_to_datetime),
                        source: ProviderSource::CodexAppServer,
                        status: SnapshotStatus::Fresh,
                    });
                }
                if let Some(sec) = &snapshot.secondary {
                    windows.push(QuotaWindow {
                        id: format!("codex-limit-{}-secondary", key.to_lowercase()),
                        kind: if sec.window_duration_mins == Some(WEEKLY_MINUTES) {
                            if account_weekly {
                                QuotaKind::Weekly
                            } else {
                                QuotaKind::ModelWeekly
                            }
                        } else {
                            QuotaKind::Other
                        },
                        label: if account_weekly && sec.window_duration_mins == Some(WEEKLY_MINUTES)
                        {
                            "Weekly".into()
                        } else {
                            format!("{} Weekly", label_prefix)
                        },
                        used_percent: Some(sec.used_percent),
                        resets_at: sec.resets_at.and_then(unix_secs_to_datetime),
                        source: ProviderSource::CodexAppServer,
                        status: SnapshotStatus::Fresh,
                    });
                }
            }
        }
    }

    // Always select the confirmed account windows before model/unknown windows.
    let mut selected = expected_unavailable_windows();
    for (index, kind) in [QuotaKind::FiveHour, QuotaKind::Weekly]
        .into_iter()
        .enumerate()
    {
        if let Some(position) = windows
            .iter()
            .position(|w| w.kind == kind && w.status == SnapshotStatus::Fresh)
        {
            selected[index] = windows.remove(position);
        }
    }
    selected.extend(
        windows
            .into_iter()
            .filter(|w| w.status == SnapshotStatus::Fresh),
    );
    selected
}

fn expected_unavailable_windows() -> Vec<QuotaWindow> {
    vec![
        QuotaWindow {
            id: "codex-five-hour".to_string(),
            kind: QuotaKind::FiveHour,
            label: "5h".to_string(),
            used_percent: None,
            resets_at: None,
            source: ProviderSource::CodexAppServer,
            status: SnapshotStatus::Unavailable,
        },
        QuotaWindow {
            id: "codex-weekly".to_string(),
            kind: QuotaKind::Weekly,
            label: "Weekly".to_string(),
            used_percent: None,
            resets_at: None,
            source: ProviderSource::CodexAppServer,
            status: SnapshotStatus::Unavailable,
        },
    ]
}

fn unix_secs_to_datetime(secs: i64) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp(secs, 0)
}

fn failure_snapshot(fetched_at: DateTime<Utc>, code: &str, message: &str) -> ProviderSnapshot {
    ProviderSnapshot {
        provider_id: ProviderId::Codex,
        account_label: None,
        auth_kind: None,
        status: SnapshotStatus::Unavailable,
        fetched_at,
        last_successful_at: None,
        quota_windows: expected_unavailable_windows(),
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
    fn quota_validation_and_missing_windows() {
        let account = || CodexAccountResponse {
            account: Some(CodexAccountInfo {
                email: None,
                plan_type: None,
            }),
            requires_openai_auth: false,
        };
        for percent in [0., 35., 100., -1., 101.] {
            let limits: CodexRateLimitsResponse = serde_json::from_value(json!({"rateLimits":{"primary":{"usedPercent":percent,"windowDurationMins":300,"resetsAt":1900000000}}})).unwrap();
            let s = normalize_codex_snapshot(account(), limits, Utc::now());
            if (0.0..=100.0).contains(&percent) {
                assert_eq!(s.quota_windows[0].used_percent, Some(percent));
                assert_eq!(s.quota_windows[1].used_percent, None);
            } else {
                assert_eq!(s.error.unwrap().code, "unsupported_output");
            }
        }
        let limits = serde_json::from_value(json!({"rateLimits":{}})).unwrap();
        let s = normalize_codex_snapshot(
            CodexAccountResponse {
                account: None,
                requires_openai_auth: true,
            },
            limits,
            Utc::now(),
        );
        assert_eq!(s.error.unwrap().code, "not_authenticated");
    }
    #[test]
    fn nullable_duration_and_account_weekly_fallback_match_electron() {
        let limits: CodexRateLimitsResponse = serde_json::from_value(json!({
            "rateLimits": {"primary": {"usedPercent": 12, "windowDurationMins": null}},
            "rateLimitsByLimitId": {
                "codex": {"primary": {"usedPercent": 42, "windowDurationMins": 10080}},
                "model": {"secondary": {"usedPercent": 24, "windowDurationMins": 10080}}
            }
        }))
        .unwrap();
        let windows = normalize_rate_limits(&limits);
        assert_eq!(windows[0].used_percent, None);
        assert_eq!(windows[1].kind, QuotaKind::Weekly);
        assert_eq!(windows[1].used_percent, Some(42.));
        assert_eq!(
            windows
                .iter()
                .filter(|w| w.kind == QuotaKind::Weekly)
                .count(),
            1
        );
        assert!(windows
            .iter()
            .any(|w| w.kind == QuotaKind::Other && w.used_percent == Some(12.)));
        assert!(windows.iter().any(|w| w.kind == QuotaKind::ModelWeekly));
        let omitted: CodexRateLimitsResponse =
            serde_json::from_value(json!({"rateLimits":{"primary":{"usedPercent": 0}}})).unwrap();
        assert_eq!(normalize_rate_limits(&omitted)[0].used_percent, None);
    }
    #[tokio::test]
    async fn rpc_notifications_failures_and_closed_transport_are_safe() {
        for (input, expected) in [
            ("{\"method\":\"notice\"}\n{\"id\":3,\"result\":{}}\n", None),
            (
                "{\"id\":3,\"error\":{\"code\":429,\"message\":\"synthetic-private-detail\"}}\n",
                Some("unavailable"),
            ),
            ("{\"id\":3}\n", Some("unsupported_output")),
            ("", Some("process_failed")),
        ] {
            let mut reader = BufReader::new(input.as_bytes());
            let result = read_response_matching_id(&mut reader, 3).await;
            if let Some(code) = expected {
                let error = result.unwrap_err();
                assert_eq!(error.0, code);
                assert!(!error.1.contains("synthetic-private-detail"));
            } else {
                assert!(result.is_ok());
            }
        }
    }
    #[tokio::test]
    async fn missing_cli_is_unavailable() {
        let s = CodexProvider::with_command("nonexistent-llm-monitor-fixture-command".into())
            .fetch_quota()
            .await;
        assert_eq!(s.error.unwrap().code, "not_installed");
    }
}
