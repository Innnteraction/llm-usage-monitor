use llm_usage_monitor_core::core::{
    types::{AppSnapshot, ProviderId, QuotaKind, SnapshotStatus},
    UsageMonitorEngine,
};
use std::{io::Write, time::Duration};

/// Only normalized status and signal presence leave the diagnostic process.
fn report(
    output: &mut impl Write,
    snapshot: &AppSnapshot,
    elapsed: Duration,
) -> std::io::Result<bool> {
    writeln!(output, "Collector elapsed_ms={}", elapsed.as_millis())?;
    let mut success = true;
    for provider in &snapshot.providers {
        let has_window = |kind| {
            provider.quota_windows.iter().any(|window| {
                window.kind == kind
                    && window.status == SnapshotStatus::Fresh
                    && window.used_percent.is_some()
            })
        };
        let five_hour = has_window(QuotaKind::FiveHour);
        let weekly = has_window(QuotaKind::Weekly);
        let code = match provider.error.as_ref().map(|error| error.code.as_str()) {
            None => "none",
            Some(
                code @ ("not_installed"
                | "not_authenticated"
                | "workspace_trust_required"
                | "unsupported_output"
                | "process_failed"
                | "timeout"
                | "rate_limited"
                | "network"
                | "unavailable"
                | "unsupported_cli_version"),
            ) => code,
            Some(_) => "unexpected",
        };
        writeln!(
            output,
            "Provider={:?} status={:?} error={} five_hour_available={} weekly_available={}",
            provider.provider_id, provider.status, code, five_hour, weekly
        )?;
        success &= provider.status == SnapshotStatus::Fresh
            && provider.error.is_none()
            && (provider.provider_id != ProviderId::Claude || (five_hour && weekly));
    }
    Ok(success)
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    // A fresh isolated cache prevents old values from making this probe pass.
    let data_dir = match tempfile::tempdir() {
        Ok(directory) => directory,
        Err(_) => {
            eprintln!("Collector error=storage_unavailable");
            return std::process::ExitCode::FAILURE;
        }
    };
    let engine = UsageMonitorEngine::new(data_dir.path().to_path_buf());
    let start = std::time::Instant::now();
    let snapshot = engine.fetch_all_snapshots().await;
    match report(&mut std::io::stdout().lock(), &snapshot, start.elapsed()) {
        Ok(true) => std::process::ExitCode::SUCCESS,
        _ => std::process::ExitCode::FAILURE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> AppSnapshot {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../shared/fixtures/snapshot.json"
        )))
        .unwrap()
    }

    #[test]
    fn diagnostics_never_report_accounts_values_resets_or_raw_errors() {
        let mut snapshot = snapshot();
        for provider in &mut snapshot.providers {
            provider.account_label = Some("synthetic-account-marker".into());
            for window in &mut provider.quota_windows {
                window.label = "synthetic-quota-marker".into();
                window.used_percent = Some(67.89);
            }
        }
        let mut output = Vec::new();
        assert!(report(&mut output, &snapshot, Duration::from_millis(5)).unwrap());
        let text = String::from_utf8(output).unwrap();
        assert!(!text.contains("synthetic-"));
        assert!(!text.contains("67.89"));
        assert!(!text.contains("resets"));
        assert!(!text.contains("tokens"));
        assert!(text.contains("status=Fresh"));
    }

    #[test]
    fn failed_or_incomplete_provider_fails_the_collector() {
        let mut snapshot = snapshot();
        let claude = snapshot
            .providers
            .iter_mut()
            .find(|p| p.provider_id == ProviderId::Claude)
            .unwrap();
        claude.quota_windows.retain(|w| w.kind != QuotaKind::Weekly);
        assert!(!report(&mut Vec::new(), &snapshot, Duration::ZERO).unwrap());
        snapshot.providers[0].status = SnapshotStatus::Stale;
        snapshot.providers[0].error = Some(llm_usage_monitor_core::core::types::ProviderError {
            code: "synthetic-raw-error-marker".into(),
            message: "synthetic-raw-error-marker".into(),
            retry_at: None,
        });
        let mut output = Vec::new();
        assert!(!report(&mut output, &snapshot, Duration::ZERO).unwrap());
        let text = String::from_utf8(output).unwrap();
        assert!(text.contains("error=unexpected"));
        assert!(!text.contains("synthetic-raw-error-marker"));
    }
}
