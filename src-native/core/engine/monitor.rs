use super::jobs::{quota_delay, Collected, Job, JobKey};
use super::reducer::apply_result;
use super::{cache, UsageMonitorEngine};
use crate::core::types::{AppSnapshot, ProviderId, ProviderSnapshot, SnapshotStatus};
use chrono::Utc;
use std::path::PathBuf;

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
enum MonitorEvent {
    Cache(Vec<ProviderSnapshot>),
    Ready(std::sync::Arc<UsageMonitorEngine>),
    Result(JobKey, u64, Collected),
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
                    for (key, job) in JobKey::ALL.into_iter().zip(jobs.iter_mut()) {
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
            snapshot.refreshing = if engine.is_none() && !stopping {PROVIDERS.to_vec()} else {PROVIDERS.into_iter().filter(|provider| JobKey::ALL.into_iter().any(|key| key.provider()==*provider && jobs[key.slot()].in_flight)).collect()};
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
                        Some(MonitorEvent::Result(key,generation,result)) if jobs[key.slot()].generation == generation => {
                            apply_result(&mut snapshot,key,result);
                            if key.is_quota() && snapshot.providers[key.provider_index()].status==SnapshotStatus::Fresh {received_quota[key.provider_index()]=true;}
                            let job=&mut jobs[key.slot()]; job.in_flight=false;
                            let delay=if key.is_quota() {
                                let p=&snapshot.providers[key.provider_index()]; let delay=quota_delay(p,job.failures);
                                job.failures=if p.status==SnapshotStatus::Fresh {0} else {job.failures.saturating_add(1)};delay
                            } else if !key.is_local() {
                                let normal=snapshot.providers[key.provider_index()].service_status.as_ref().is_some_and(|s|s.indicator==crate::core::types::ServiceHealthIndicator::Operational);
                                std::time::Duration::from_secs(if normal {900} else {300})
                            } else {std::time::Duration::from_secs(60)};
                            job.due=std::time::Instant::now()+if job.queued {std::time::Duration::ZERO} else {delay};job.queued=false;
                            if key.is_quota() && cache_loaded {let _=writes.send(snapshot.providers.clone());}
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
        let mut fixture: AppSnapshot = serde_json::from_str(include_str!(
            "../../../shared/fixtures/snapshot.json"
        ))
        .unwrap();
        let mut old = fixture.providers[0].clone();
        old.quota_windows[1].used_percent = Some(11.);
        cache::save(dir.path(), &[old]).unwrap();
        fixture.providers[2].status = SnapshotStatus::Unavailable;
        fixture.providers[2].error = Some(crate::core::types::ProviderError {
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
        apply_result(&mut snapshot, JobKey::CodexQuota, Collected::Quota(fresh));
        assert_eq!(quota_delay(&snapshot.providers[0], 4).as_secs(), 60);
        apply_result(&mut snapshot, JobKey::CodexQuota, Collected::Failed);
        assert_eq!(snapshot.providers[0].status, SnapshotStatus::Stale);
        assert_eq!(quota_delay(&snapshot.providers[0], 3).as_secs(), 480);
        let mut missing = snapshot.providers[0].clone();
        missing.status = SnapshotStatus::Fresh;
        missing.error = None;
        missing.quota_windows.clear();
        apply_result(&mut snapshot, JobKey::CodexQuota, Collected::Quota(missing));
        assert!(snapshot.providers[0].quota_windows.is_empty());
    }
}
