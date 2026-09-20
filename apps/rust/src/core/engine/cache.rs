use crate::core::types::{ProviderId, ProviderSnapshot, SnapshotStatus};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
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
    quota_windows: Vec<crate::core::types::QuotaWindow>,
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
