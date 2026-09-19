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
        let base = dirs::home_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("Library/Application Support");
        base.join("llm-usage-monitor").join("shared")
    }
    pub fn lock_port(dir: &Path) -> u16 {
        let key = dir.to_string_lossy().replace('\\', "/");
        let key = if cfg!(windows) {
            key.to_ascii_lowercase()
        } else {
            key
        };
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
    struct Envelope {
        schema_version: u32,
        providers: Vec<CachedProvider>,
    }
    pub fn load(dir: &Path) -> Vec<ProviderSnapshot> {
        let path = dir.join("quota-v2.json");
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && dir == directory() => {
                #[cfg(windows)]
                let base = dirs::config_dir().unwrap_or_default();
                #[cfg(not(windows))]
                let base = dirs::home_dir()
                    .unwrap_or_default()
                    .join("Library/Application Support");
                let old = base.join("llm-usage-monitor/usage-snapshot-v1.json");
                let Ok(bytes) = std::fs::read(old) else {
                    return vec![];
                };
                let Ok(mut old) = serde_json::from_slice::<Envelope>(&bytes) else {
                    return vec![];
                };
                if old.schema_version != 1 {
                    return vec![];
                }
                old.schema_version = 2;
                serde_json::to_vec(&old).unwrap_or_default()
            }
            Err(_) => return vec![],
        };
        let Ok(envelope) = serde_json::from_slice::<Envelope>(&bytes) else {
            return vec![];
        };
        if envelope.schema_version != 2
            || envelope.providers.iter().any(|p| {
                p.quota_windows.iter().any(|w| {
                    w.used_percent
                        .is_some_and(|v| !v.is_finite() || !(0.0..=100.0).contains(&v))
                })
            })
        {
            return vec![];
        }
        envelope
            .providers
            .into_iter()
            .map(|p| ProviderSnapshot {
                provider_id: p.provider_id,
                account_label: None,
                auth_kind: None,
                status: SnapshotStatus::Stale,
                fetched_at: p.last_successful_at,
                last_successful_at: Some(p.last_successful_at),
                quota_windows: p
                    .quota_windows
                    .into_iter()
                    .map(|mut w| {
                        if w.status != SnapshotStatus::Unavailable {
                            w.status = SnapshotStatus::Stale;
                        }
                        w
                    })
                    .collect(),
                local_usage: None,
                error: None,
                service_status: None,
            })
            .collect()
    }
    pub fn save(dir: &Path, providers: &[ProviderSnapshot]) -> std::io::Result<()> {
        let providers = providers
            .iter()
            .filter_map(|p| {
                Some(CachedProvider {
                    provider_id: p.provider_id,
                    status: p.status,
                    fetched_at: p.fetched_at,
                    last_successful_at: p.last_successful_at?,
                    quota_windows: p.quota_windows.clone(),
                })
            })
            .collect();
        atomic_write(
            &dir.join("quota-v2.json"),
            &serde_json::to_vec(&Envelope {
                schema_version: 2,
                providers,
            })?,
        )
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

// One coordinator owns normalized state. Slow collectors never hold UI state locks.
pub const PROVIDERS: [ProviderId; 3] = [
    ProviderId::Codex,
    ProviderId::Claude,
    ProviderId::Antigravity,
];
pub fn initial_snapshot() -> AppSnapshot {
    AppSnapshot {
        schema_version: 1,
        updated_at: Utc::now(),
        refreshing: PROVIDERS.to_vec(),
        providers: PROVIDERS
            .into_iter()
            .map(|provider_id| ProviderSnapshot {
                provider_id,
                account_label: None,
                auth_kind: None,
                status: SnapshotStatus::Unavailable,
                fetched_at: Utc::now(),
                last_successful_at: None,
                quota_windows: vec![],
                local_usage: None,
                error: None,
                service_status: None,
            })
            .collect(),
    }
}
#[derive(Clone, Copy)]
pub enum MonitorCommand {
    Refresh,
    Stop,
}
pub struct LiveMonitor {
    pub commands: tokio::sync::mpsc::UnboundedSender<MonitorCommand>,
    pub task: tokio::task::JoinHandle<()>,
}
#[derive(Debug)]
enum Collected {
    Quota(ProviderSnapshot),
    Health(super::types::VendorServiceStatus),
    Local(super::types::LocalTokenUsage),
    Failed,
}
enum MonitorEvent {
    Cache(Vec<ProviderSnapshot>),
    Ready(std::sync::Arc<UsageMonitorEngine>),
    Result(usize, u64, Collected),
}
#[derive(Clone)]
struct Job {
    generation: u64,
    in_flight: bool,
    queued: bool,
    failures: usize,
    due: std::time::Instant,
}
impl Job {
    fn new() -> Self {
        Self {
            generation: 0,
            in_flight: false,
            queued: false,
            failures: 0,
            due: std::time::Instant::now(),
        }
    }
    fn request(&mut self) {
        if self.in_flight {
            self.queued = true;
        } else {
            self.due = std::time::Instant::now();
        }
    }
}
fn quota_delay(p: &ProviderSnapshot, failures: usize) -> std::time::Duration {
    if p.status == SnapshotStatus::Fresh {
        return std::time::Duration::from_secs(60);
    }
    if let Some(delay) = p
        .error
        .as_ref()
        .and_then(|e| e.retry_at)
        .and_then(|t| (t - Utc::now()).to_std().ok())
    {
        return delay;
    }
    std::time::Duration::from_secs([60, 120, 240, 480, 900][failures.min(4)])
}
fn apply_result(snapshot: &mut AppSnapshot, key: usize, result: Collected) {
    let index = if key < 6 { key % 3 } else { key - 6 };
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
            if key < 3 {
                current.status = if current.last_successful_at.is_some() {
                    SnapshotStatus::Stale
                } else {
                    SnapshotStatus::Unavailable
                };
                current.error = Some(super::types::ProviderError {
                    code: "unexpected".into(),
                    message: "Usage refresh failed unexpectedly.".into(),
                    retry_at: None,
                });
                for w in &mut current.quota_windows {
                    if w.status != SnapshotStatus::Unavailable {
                        w.status = SnapshotStatus::Stale;
                    }
                }
            } else if key >= 6 {
                if let Some(old) = &mut current.local_usage {
                    old.partial = true;
                    old.failed_file_count = old.failed_file_count.max(1);
                }
            } else {
                current.service_status = Some(super::types::VendorServiceStatus {
                    indicator: super::types::ServiceHealthIndicator::Unknown,
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
impl UsageMonitorEngine {
    async fn collect(&self, key: usize) -> Collected {
        if let Some(fixture) = &self.fixture {
            tokio::time::sleep(std::time::Duration::from_millis(
                [80, 1200, 250, 100, 100, 100, 150, 150][key],
            ))
            .await;
            let index = if key < 6 { key % 3 } else { key - 6 };
            let Some(provider) = fixture.providers.get(index) else {
                return Collected::Failed;
            };
            return if key < 3 {
                Collected::Quota(provider.clone())
            } else if key < 6 {
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
            0 => Collected::Quota(self.codex_provider.fetch_quota().await),
            1 => Collected::Quota(self.claude_provider.fetch_quota().await),
            2 => Collected::Quota(self.antigravity_provider.fetch_quota().await),
            3..=5 => {
                Collected::Health(fetch_vendor_status(PROVIDERS[key - 3], &self.http_client).await)
            }
            6 => Collected::Local(self.codex_local_scanner.scan().await),
            7 => Collected::Local(self.claude_local_scanner.scan().await),
            _ => unreachable!(),
        }
    }
}
pub fn start_live(
    runtime: &tokio::runtime::Handle,
    directory: PathBuf,
    output: std::sync::mpsc::Sender<AppSnapshot>,
) -> LiveMonitor {
    start_monitor(runtime, directory, output, None)
}
pub fn start_fixture(
    runtime: &tokio::runtime::Handle,
    directory: PathBuf,
    output: std::sync::mpsc::Sender<AppSnapshot>,
    fixture: AppSnapshot,
) -> LiveMonitor {
    start_monitor(runtime, directory, output, Some(fixture))
}
fn start_monitor(
    runtime: &tokio::runtime::Handle,
    directory: PathBuf,
    output: std::sync::mpsc::Sender<AppSnapshot>,
    fixture: Option<AppSnapshot>,
) -> LiveMonitor {
    let (commands, mut requests) = tokio::sync::mpsc::unbounded_channel();
    let task = runtime.spawn(async move {
        let mut snapshot = initial_snapshot();
        let _ = output.send(snapshot.clone());
        let mut tasks = tokio::task::JoinSet::new();
        let cache_dir = directory.clone();
        tasks.spawn(async move {MonitorEvent::Cache(tokio::task::spawn_blocking(move || cache::load(&cache_dir)).await.unwrap_or_default())});
        let engine_dir = directory.clone();
        tasks.spawn(async move {MonitorEvent::Ready(std::sync::Arc::new(tokio::task::spawn_blocking(move || {let mut engine=UsageMonitorEngine::new(engine_dir);engine.fixture=fixture;engine}).await.expect("engine initialization")))});
        let (writes, mut pending_writes) = tokio::sync::mpsc::unbounded_channel::<Vec<ProviderSnapshot>>();
        let writer = tokio::spawn(async move {
            while let Some(mut providers) = pending_writes.recv().await {
                while let Ok(latest)=pending_writes.try_recv() {providers=latest;}
                let dir=directory.clone();
                let _=tokio::task::spawn_blocking(move || cache::save(&dir,&providers)).await;
            }
        });
        let mut engine = None;
        let mut jobs: [Job;8] = std::array::from_fn(|_|Job::new());
        let mut received_quota=[false;3];
        let mut cache_loaded=false;
        let mut task_keys=std::collections::HashMap::new();
        let mut stopping=false;
        let mut last_sent=None;
        loop {
            if !stopping {
                if let Some(engine) = &engine {
                    for (key, job) in jobs.iter_mut().enumerate() {
                        if !job.in_flight && job.due <= std::time::Instant::now() {
                            job.in_flight=true; job.generation+=1;
                            let generation=job.generation;
                            let engine=std::sync::Arc::<UsageMonitorEngine>::clone(engine);
                            let task=tasks.spawn(async move {MonitorEvent::Result(key,generation,engine.collect(key).await)});
                            task_keys.insert(task.id(),(key,generation));
                        }
                    }
                }
            }
            snapshot.refreshing = if engine.is_none() && !stopping {PROVIDERS.to_vec()} else {(0..3).filter(|i| jobs[*i].in_flight || jobs[*i+3].in_flight || (*i<2 && jobs[*i+6].in_flight)).map(|i|PROVIDERS[i]).collect()};
            if last_sent.as_ref()!=Some(&snapshot) {let _=output.send(snapshot.clone()); last_sent=Some(snapshot.clone());}
            if stopping && tasks.is_empty() {break;}
            tokio::select! {
                command=requests.recv(), if !stopping => {
                    match command { Some(MonitorCommand::Refresh) => {for job in &mut jobs {job.request();}}, _ => {stopping=true;for job in &mut jobs {job.queued=false;}} }
                }
                event=tasks.join_next_with_id(), if !tasks.is_empty() => {
                    let event=match event {
                        Some(Ok((id,event)))=>{task_keys.remove(&id);Some(event)},
                        Some(Err(error))=>task_keys.remove(&error.id()).map(|(key,generation)|MonitorEvent::Result(key,generation,Collected::Failed)),
                        None=>None,
                    };
                    match event {
                        Some(MonitorEvent::Cache(providers)) => {
                            cache_loaded=true;
                            for cached in providers {if let Some(i)=PROVIDERS.iter().position(|p|*p==cached.provider_id) {if !received_quota[i] {let error=snapshot.providers[i].error.clone();let local=snapshot.providers[i].local_usage.clone();let health=snapshot.providers[i].service_status.clone();snapshot.providers[i]=cached;snapshot.providers[i].local_usage=local;snapshot.providers[i].service_status=health;snapshot.providers[i].error=error;}}}
                            let _=writes.send(snapshot.providers.clone());
                        }
                        Some(MonitorEvent::Ready(ready)) => {
                            snapshot.providers[0].local_usage=ready.codex_local_scanner.cached_summary();
                            snapshot.providers[1].local_usage=ready.claude_local_scanner.cached_summary();
                            engine=Some(ready);
                        }
                        Some(MonitorEvent::Result(key,generation,result)) if jobs[key].generation == generation => {
                            apply_result(&mut snapshot,key,result);
                            if key<3 && snapshot.providers[key].status==SnapshotStatus::Fresh {received_quota[key]=true;}
                            let job=&mut jobs[key]; job.in_flight=false;
                            let delay=if key<3 {
                                let p=&snapshot.providers[key]; let delay=quota_delay(p,job.failures);
                                job.failures=if p.status==SnapshotStatus::Fresh {0} else {job.failures.saturating_add(1)};delay
                            } else if key<6 {
                                let normal=snapshot.providers[key-3].service_status.as_ref().is_some_and(|s|s.indicator==super::types::ServiceHealthIndicator::Operational);
                                std::time::Duration::from_secs(if normal {900} else {300})
                            } else {std::time::Duration::from_secs(60)};
                            job.due=std::time::Instant::now()+if job.queued {std::time::Duration::ZERO} else {delay};job.queued=false;
                            if key<3 && cache_loaded {let _=writes.send(snapshot.providers.clone());}
                        }
                        _=>{}
                    }
                }
                _=tokio::time::sleep(std::time::Duration::from_millis(100))=>{}
            }
        }
        let _=writes.send(snapshot.providers);
        drop(writes);let _=writer.await;
    });
    LiveMonitor { commands, task }
}

#[cfg(test)]
mod monitor_tests {
    use super::*;
    #[tokio::test]
    async fn cached_and_fast_results_arrive_before_slow_provider_and_shutdown_flushes() {
        let dir = tempfile::tempdir().unwrap();
        let mut fixture: AppSnapshot =
            serde_json::from_str(include_str!("../../.work/parity-reference/snapshot.json"))
                .unwrap();
        let mut old = fixture.providers[0].clone();
        old.quota_windows[1].used_percent = Some(11.);
        cache::save(dir.path(), &[old]).unwrap();
        fixture.providers[2].status = SnapshotStatus::Unavailable;
        fixture.providers[2].error = Some(super::super::types::ProviderError {
            code: "timeout".into(),
            message: "Synthetic failure".into(),
            retry_at: None,
        });
        let (tx, rx) = std::sync::mpsc::channel();
        let live = start_fixture(
            &tokio::runtime::Handle::current(),
            dir.path().into(),
            tx,
            fixture,
        );
        let started = std::time::Instant::now();
        let mut cached = false;
        let mut fast = false;
        let mut failure = false;
        while started.elapsed() < std::time::Duration::from_millis(700) {
            while let Ok(snapshot) = rx.try_recv() {
                cached |= snapshot.providers[0].status == SnapshotStatus::Stale;
                fast |= snapshot.providers[0].status == SnapshotStatus::Fresh
                    && snapshot.refreshing.contains(&ProviderId::Claude);
                failure |= snapshot.providers[2].error.is_some();
            }
            if cached && fast && failure {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(cached && fast && failure);
        live.commands.send(MonitorCommand::Stop).unwrap();
        live.task.await.unwrap();
        assert!(cache::load(dir.path())
            .iter()
            .any(|p| p.provider_id == ProviderId::Claude));
    }
    #[test]
    fn refresh_queues_once_and_failures_back_off_without_resurrecting_missing_quota() {
        let mut job = Job::new();
        job.in_flight = true;
        for _ in 0..10 {
            job.request();
        }
        assert!(job.queued);
        assert_eq!(job.generation, 0);
        let mut snapshot = initial_snapshot();
        let mut fresh = snapshot.providers[0].clone();
        fresh.status = SnapshotStatus::Fresh;
        fresh.last_successful_at = Some(Utc::now());
        apply_result(&mut snapshot, 0, Collected::Quota(fresh));
        assert_eq!(quota_delay(&snapshot.providers[0], 4).as_secs(), 60);
        apply_result(&mut snapshot, 0, Collected::Failed);
        assert_eq!(snapshot.providers[0].status, SnapshotStatus::Stale);
        assert_eq!(quota_delay(&snapshot.providers[0], 3).as_secs(), 480);
        let mut missing = snapshot.providers[0].clone();
        missing.status = SnapshotStatus::Fresh;
        missing.error = None;
        missing.quota_windows.clear();
        apply_result(&mut snapshot, 0, Collected::Quota(missing));
        assert!(snapshot.providers[0].quota_windows.is_empty());
    }
}
