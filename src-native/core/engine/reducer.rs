use super::jobs::{Collected, JobKey};
use crate::core::types::{AppSnapshot, ProviderId, SnapshotStatus};
use chrono::Utc;

pub(super) fn apply_result(snapshot: &mut AppSnapshot, key: JobKey, result: Collected) {
    let index = key.provider_index();
    let current = &mut snapshot.providers[index];
    match result {
        Collected::Quota(mut fresh) => {
            if fresh.provider_id != current.provider_id {
                return;
            }
            fresh.local_usage = current.local_usage.clone();
            fresh.service_status = current.service_status.clone();
            if fresh.status != SnapshotStatus::Fresh && current.last_successful_at.is_some() {
                fresh.status = SnapshotStatus::Stale;
                fresh.last_successful_at = current.last_successful_at;
                fresh.account_label = current.account_label.clone();
                fresh.auth_kind = current.auth_kind;
                fresh.quota_windows = current.quota_windows.clone();
                for w in &mut fresh.quota_windows {
                    if w.status != SnapshotStatus::Unavailable {
                        w.status = SnapshotStatus::Stale;
                    }
                }
            }
            *current = fresh;
        }
        Collected::Health(value) => current.service_status = Some(value),
        Collected::Local(value) => {
            if value.partial && value.scanned_file_count == 0 && current.local_usage.is_some() {
                let old = current.local_usage.as_mut().unwrap();
                old.partial = true;
                old.failed_file_count = value.failed_file_count;
            } else {
                current.local_usage = Some(value);
            }
        }
        Collected::Failed => {
            if key.is_quota() {
                current.status = if current.last_successful_at.is_some() {
                    SnapshotStatus::Stale
                } else {
                    SnapshotStatus::Unavailable
                };
                current.error = Some(crate::core::types::ProviderError {
                    code: "unexpected".into(),
                    message: "Usage refresh failed unexpectedly.".into(),
                    retry_at: None,
                });
                for w in &mut current.quota_windows {
                    if w.status != SnapshotStatus::Unavailable {
                        w.status = SnapshotStatus::Stale;
                    }
                }
            } else if key.is_local() {
                if let Some(old) = &mut current.local_usage {
                    old.partial = true;
                    old.failed_file_count = old.failed_file_count.max(1);
                }
            } else {
                current.service_status = Some(crate::core::types::VendorServiceStatus {
                    indicator: crate::core::types::ServiceHealthIndicator::Unknown,
                    description: "Status unavailable".into(),
                    status_page_url: match current.provider_id {
                        ProviderId::Codex => "https://status.openai.com",
                        ProviderId::Claude => "https://status.claude.com",
                        ProviderId::Antigravity => "https://status.cloud.google.com",
                    }
                    .into(),
                    incident_title: None,
                    checked_at: Utc::now(),
                });
            }
        }
    }
    snapshot.updated_at = Utc::now();
}
