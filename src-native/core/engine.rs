use super::local_usage::{ClaudeLocalScanner, CodexLocalScanner, LocalUsageCheckpointStore};
use super::types::{AppSnapshot, ProviderId};
use super::vendor_health::fetch_vendor_status;
use crate::providers::{AntigravityProvider, ClaudeProvider, CodexProvider};
use chrono::Utc;
use std::path::PathBuf;

pub struct UsageMonitorEngine {
    codex_provider: CodexProvider,
    claude_provider: ClaudeProvider,
    antigravity_provider: AntigravityProvider,
    codex_local_scanner: CodexLocalScanner,
    claude_local_scanner: ClaudeLocalScanner,
    http_client: reqwest::Client,
}

impl UsageMonitorEngine {
    pub fn new(data_dir: PathBuf) -> Self {
        let checkpoint_path = data_dir.join("local-usage-index-v1.json");
        let checkpoint_store = LocalUsageCheckpointStore::new(checkpoint_path);

        Self {
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

        AppSnapshot {
            schema_version: 1,
            providers: vec![codex_snap, claude_snap, agy_snap],
            refreshing: Vec::new(),
            updated_at: Utc::now(),
        }
    }
}
