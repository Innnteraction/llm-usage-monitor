use super::local_usage::{ClaudeLocalScanner, CodexLocalScanner, LocalUsageCheckpointStore};
use super::types::{AppSnapshot, ProviderId, ProviderSnapshot, SnapshotStatus};
use super::vendor_health::fetch_vendor_status;
use crate::providers::{AntigravityProvider, ClaudeProvider, CodexProvider};
use chrono::Utc;
use jobs::{Collected, JobKey};
use std::path::PathBuf;
use std::sync::Mutex;

pub mod cache;
mod jobs;
mod monitor;
mod reducer;
pub use monitor::{
    initial_snapshot, start_fixture, start_live, LiveMonitor, MonitorCommand, PROVIDERS,
};

pub struct UsageMonitorEngine {
    codex_provider: CodexProvider,
    claude_provider: ClaudeProvider,
    antigravity_provider: AntigravityProvider,
    codex_local_scanner: CodexLocalScanner,
    claude_local_scanner: ClaudeLocalScanner,
    http_client: reqwest::Client,
    last_success: Mutex<Vec<ProviderSnapshot>>,
    fixture: Option<AppSnapshot>,
}

impl UsageMonitorEngine {
    pub fn new(data_dir: PathBuf) -> Self {
        let checkpoint_path = data_dir.join("local-usage-index-v2.json");
        let checkpoint_store = LocalUsageCheckpointStore::new(checkpoint_path);

        Self {
            last_success: Mutex::new(Vec::new()),
            fixture: None,
            codex_provider: CodexProvider::new(),
            claude_provider: ClaudeProvider::new(),
            antigravity_provider: AntigravityProvider::new(),
            codex_local_scanner: CodexLocalScanner::new(checkpoint_store.clone()),
            claude_local_scanner: ClaudeLocalScanner::new(checkpoint_store),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .unwrap_or_default(),
        }
    }

    pub async fn fetch_all_snapshots(&self) -> AppSnapshot {
        let t_start = std::time::Instant::now();

        // 1. Providers
        let t_prov = std::time::Instant::now();
        let (codex_res, claude_res, agy_res) = tokio::join!(
            self.codex_provider.fetch_quota(),
            self.claude_provider.fetch_quota(),
            self.antigravity_provider.fetch_quota(),
        );
        eprintln!("[timing] Providers: {:.2?}", t_prov.elapsed());

        // 2. Health
        let t_health = std::time::Instant::now();
        let (codex_health, claude_health, agy_health) = tokio::join!(
            fetch_vendor_status(ProviderId::Codex, &self.http_client),
            fetch_vendor_status(ProviderId::Claude, &self.http_client),
            fetch_vendor_status(ProviderId::Antigravity, &self.http_client),
        );
        eprintln!("[timing] Vendor Health: {:.2?}", t_health.elapsed());

        // 3. Local token scanners
        let t_local = std::time::Instant::now();
        let (codex_local, claude_local) = tokio::join!(
            self.codex_local_scanner.scan(),
            self.claude_local_scanner.scan(),
        );
        eprintln!("[timing] Local Scanners: {:.2?}", t_local.elapsed());
        eprintln!("[timing] Total: {:.2?}", t_start.elapsed());

        let mut codex_snap = codex_res;
        codex_snap.service_status = Some(codex_health);
        codex_snap.local_usage = Some(codex_local);

        let mut claude_snap = claude_res;
        claude_snap.service_status = Some(claude_health);
        claude_snap.local_usage = Some(claude_local);

        let mut agy_snap = agy_res;
        agy_snap.service_status = Some(agy_health);

        let mut providers = vec![codex_snap, claude_snap, agy_snap];
        preserve_success(&mut providers, &mut self.last_success.lock().unwrap());
        AppSnapshot {
            schema_version: 1,
            providers,
            refreshing: Vec::new(),
            updated_at: Utc::now(),
        }
    }
}

// quota만 보존한다. 로컬 토큰과 서버 상태는 이번 수집 결과를 사용한다.
fn preserve_success(current: &mut [ProviderSnapshot], last: &mut Vec<ProviderSnapshot>) {
    for snapshot in current {
        if snapshot.status == SnapshotStatus::Fresh && snapshot.error.is_none() {
            last.retain(|old| old.provider_id != snapshot.provider_id);
            last.push(snapshot.clone());
        } else if let Some(old) = last
            .iter()
            .find(|old| old.provider_id == snapshot.provider_id)
        {
            snapshot.status = SnapshotStatus::Stale;
            snapshot.account_label = old.account_label.clone();
            snapshot.auth_kind = old.auth_kind;
            snapshot.last_successful_at = old.last_successful_at;
            snapshot.quota_windows = old.quota_windows.clone();
            for quota in &mut snapshot.quota_windows {
                if quota.used_percent.is_some() {
                    quota.status = SnapshotStatus::Stale;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::types::*;
    #[test]
    fn shared_lock_excludes_another_process_and_releases() {
        let dir = tempfile::tempdir().unwrap();
        let lock = cache::acquire_lock(dir.path()).unwrap();
        assert!(cache::acquire_lock(dir.path()).is_err());
        drop(lock);
        assert!(cache::acquire_lock(dir.path()).is_ok());
    }
    #[test]
    fn failed_provider_keeps_quota_but_missing_quota_does_not_resurrect() {
        let now = Utc::now();
        let fresh = ProviderSnapshot {
            provider_id: ProviderId::Codex,
            account_label: None,
            auth_kind: None,
            status: SnapshotStatus::Fresh,
            fetched_at: now,
            last_successful_at: Some(now),
            quota_windows: vec![QuotaWindow {
                id: "test".into(),
                kind: QuotaKind::FiveHour,
                label: "5h".into(),
                used_percent: Some(25.0),
                resets_at: None,
                source: ProviderSource::LocalFixture,
                status: SnapshotStatus::Fresh,
            }],
            local_usage: None,
            service_status: None,
            error: None,
        };
        let mut last = vec![];
        let cache_dir = tempfile::tempdir().unwrap();
        cache::save(cache_dir.path(), &[fresh.clone()]).unwrap();
        let restored = cache::load(cache_dir.path());
        assert_eq!(restored[0].status, SnapshotStatus::Stale);
        assert!(restored[0].account_label.is_none());
        preserve_success(&mut [fresh.clone()], &mut last);
        let mut failed = fresh.clone();
        failed.status = SnapshotStatus::Unavailable;
        failed.quota_windows.clear();
        failed.error = Some(ProviderError {
            code: "network".into(),
            message: "retry".into(),
            retry_at: None,
        });
        let mut current = vec![failed];
        preserve_success(&mut current, &mut last);
        assert_eq!(current[0].status, SnapshotStatus::Stale);
        assert_eq!(current[0].quota_windows[0].used_percent, Some(25.0));
        assert!(current[0].error.is_some());
        let mut unavailable = fresh;
        unavailable.quota_windows.clear();
        preserve_success(&mut [unavailable], &mut last);
        assert!(last[0].quota_windows.is_empty());
    }
}

impl UsageMonitorEngine {
    async fn collect(&self, key: JobKey) -> Collected {
        if let Some(fixture) = &self.fixture {
            tokio::time::sleep(std::time::Duration::from_millis(
                [80, 1200, 250, 100, 100, 100, 150, 150][key.slot()],
            ))
            .await;
            let index = key.provider_index();
            let Some(provider) = fixture.providers.get(index) else {
                return Collected::Failed;
            };
            return if key.is_quota() {
                Collected::Quota(provider.clone())
            } else if !key.is_local() {
                provider
                    .service_status
                    .clone()
                    .map(Collected::Health)
                    .unwrap_or(Collected::Failed)
            } else {
                provider
                    .local_usage
                    .clone()
                    .map(Collected::Local)
                    .unwrap_or(Collected::Failed)
            };
        }
        match key {
            JobKey::CodexQuota => Collected::Quota(self.codex_provider.fetch_quota().await),
            JobKey::ClaudeQuota => Collected::Quota(self.claude_provider.fetch_quota().await),
            JobKey::AntigravityQuota => {
                Collected::Quota(self.antigravity_provider.fetch_quota().await)
            }
            JobKey::CodexHealth | JobKey::ClaudeHealth | JobKey::AntigravityHealth => {
                Collected::Health(fetch_vendor_status(key.provider(), &self.http_client).await)
            }
            JobKey::CodexLocal => Collected::Local(self.codex_local_scanner.scan().await),
            JobKey::ClaudeLocal => Collected::Local(self.claude_local_scanner.scan().await),
        }
    }
}
