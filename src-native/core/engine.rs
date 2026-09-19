use super::local_usage::{ClaudeLocalScanner, CodexLocalScanner, LocalUsageCheckpointStore};
use super::types::{AppSnapshot, ProviderId, ProviderSnapshot, SnapshotStatus};
use super::vendor_health::fetch_vendor_status;
use crate::providers::{AntigravityProvider, ClaudeProvider, CodexProvider};
use chrono::Utc;
use std::path::PathBuf;
use std::sync::Mutex;

/// Storage contract shared with Electron's snapshotCache (no account identifiers).
pub mod cache {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{io::Write, net::TcpListener, path::Path};

    pub fn directory() -> PathBuf {
        #[cfg(target_os = "windows")]
        let base = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir);
        #[cfg(not(target_os = "windows"))]
        let base = dirs::home_dir().unwrap_or_else(std::env::temp_dir).join("Library/Application Support");
        base.join("llm-usage-monitor").join("shared")
    }
    pub fn lock_port(dir: &Path) -> u16 {
        let key = dir.to_string_lossy().replace('\\', "/");
        let key = if cfg!(windows) { key.to_ascii_lowercase() } else { key };
        let hash = Sha256::digest(key.as_bytes());
        49152 + u16::from_be_bytes([hash[0], hash[1]]) % 16384
    }
    pub fn acquire_lock(dir: &Path) -> std::io::Result<TcpListener> {
        TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, lock_port(dir)))
    }
    pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
        std::fs::create_dir_all(parent)?;
        let mut file = tempfile::NamedTempFile::new_in(parent)?;
        file.write_all(bytes)?;
        file.as_file().sync_all()?;
        file.persist(path).map_err(|e| e.error)?;
        Ok(())
    }
    #[derive(serde::Serialize, serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct CachedProvider {
        provider_id: ProviderId,
        status: SnapshotStatus,
        fetched_at: chrono::DateTime<Utc>,
        last_successful_at: chrono::DateTime<Utc>,
        quota_windows: Vec<super::super::types::QuotaWindow>,
    }
    #[derive(serde::Serialize, serde::Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Envelope { schema_version: u32, providers: Vec<CachedProvider> }
    pub fn load(dir: &Path) -> Vec<ProviderSnapshot> {
        let path = dir.join("quota-v2.json");
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                #[cfg(windows)]
                let base = dirs::config_dir().unwrap_or_default();
                #[cfg(not(windows))]
                let base = dirs::home_dir().unwrap_or_default().join("Library/Application Support");
                let old = base.join("llm-usage-monitor/usage-snapshot-v1.json");
                let Ok(bytes) = std::fs::read(old) else { return vec![] };
                let Ok(mut old) = serde_json::from_slice::<Envelope>(&bytes) else { return vec![] };
                if old.schema_version != 1 { return vec![] }
                old.schema_version = 2;
                serde_json::to_vec(&old).unwrap_or_default()
            }
            Err(_) => return vec![],
        };
        let Ok(envelope) = serde_json::from_slice::<Envelope>(&bytes) else { return vec![] };
        if envelope.schema_version != 2 || envelope.providers.iter().any(|p| p.quota_windows.iter().any(|w| w.used_percent.is_some_and(|v| !v.is_finite() || !(0.0..=100.0).contains(&v)))) { return vec![] }
        envelope.providers.into_iter().map(|p| ProviderSnapshot {
            provider_id: p.provider_id, account_label: None, auth_kind: None,
            status: SnapshotStatus::Stale, fetched_at: p.last_successful_at,
            last_successful_at: Some(p.last_successful_at),
            quota_windows: p.quota_windows.into_iter().map(|mut w| { if w.status != SnapshotStatus::Unavailable { w.status=SnapshotStatus::Stale; } w }).collect(),
            local_usage: None, error: None, service_status: None,
        }).collect()
    }
    pub fn save(dir: &Path, providers: &[ProviderSnapshot]) -> std::io::Result<()> {
        let providers = providers.iter().filter_map(|p| Some(CachedProvider {
            provider_id: p.provider_id, status: p.status, fetched_at: p.fetched_at,
            last_successful_at: p.last_successful_at?, quota_windows: p.quota_windows.clone(),
        })).collect();
        atomic_write(&dir.join("quota-v2.json"), &serde_json::to_vec(&Envelope { schema_version: 2, providers })?)
    }
}

pub struct UsageMonitorEngine {
    codex_provider: CodexProvider,
    claude_provider: ClaudeProvider,
    antigravity_provider: AntigravityProvider,
    codex_local_scanner: CodexLocalScanner,
    claude_local_scanner: ClaudeLocalScanner,
    http_client: reqwest::Client,
    last_success: Mutex<Vec<ProviderSnapshot>>,
}

impl UsageMonitorEngine {
    pub fn new(data_dir: PathBuf) -> Self {
        let checkpoint_path = data_dir.join("native-local-usage-index-v1.json");
        let checkpoint_store = LocalUsageCheckpointStore::new(checkpoint_path);

        Self {
            last_success: Mutex::new(Vec::new()),
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
