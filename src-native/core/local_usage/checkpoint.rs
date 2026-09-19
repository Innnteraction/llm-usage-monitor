use super::types::LocalUsageCheckpointState;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct LocalUsageCheckpointStore {
    path: PathBuf,
    state: Arc<Mutex<LocalUsageCheckpointState>>,
}

impl LocalUsageCheckpointStore {
    pub fn new(path: PathBuf) -> Self {
        let state = if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => serde_json::from_str::<LocalUsageCheckpointState>(&content)
                    .ok()
                    .filter(valid_state)
                    .unwrap_or_default(),
                Err(_) => LocalUsageCheckpointState::default(),
            }
        } else {
            LocalUsageCheckpointState::default()
        };

        Self {
            path,
            state: Arc::new(Mutex::new(state)),
        }
    }

    pub fn get_provider(&self, provider: &str) -> super::types::ProviderCheckpointSection {
        self.state
            .lock()
            .unwrap()
            .providers
            .get(provider)
            .cloned()
            .unwrap_or_default()
    }

    pub fn get_state(&self) -> LocalUsageCheckpointState {
        self.state.lock().unwrap().clone()
    }

    pub fn save_provider(&self, provider: &str, section: super::types::ProviderCheckpointSection) {
        let mut guard = self.state.lock().unwrap();
        guard.providers.insert(provider.to_string(), section);
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(&*guard) {
            let _ = atomic_write(&self.path, json.as_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::ProviderCheckpointSection;
    use super::*;
    #[test]
    fn concurrent_provider_saves_preserve_both_sections() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");
        let store = LocalUsageCheckpointStore::new(path.clone());
        let second = store.clone();
        let thread = std::thread::spawn(move || {
            second.save_provider("claude", ProviderCheckpointSection::default())
        });
        store.save_provider("codex", ProviderCheckpointSection::default());
        thread.join().unwrap();
        assert_eq!(
            LocalUsageCheckpointStore::new(path)
                .get_state()
                .providers
                .len(),
            2
        );
    }
}

pub fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    fs::create_dir_all(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|e| e.error)?;
    Ok(())
}
fn valid_state(state: &LocalUsageCheckpointState) -> bool {
    use super::types::MAX_SAFE_INTEGER;
    fn hash(s: &str) -> bool {
        s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())
    }
    state.schema_version == 2
        && state
            .providers
            .keys()
            .all(|k| k == "codex" || k == "claude")
        && state.providers.values().all(|s| {
            s.root_key.as_ref().is_none_or(|k| hash(k))
                && s.files.iter().all(|(k, f)| {
                    hash(k)
                        && *k == f.file_key
                        && hash(&f.identity)
                        && hash(&f.boundary_hash)
                        && f.offset <= f.size
                        && f.size <= MAX_SAFE_INTEGER
                        && f.mtime_ms.is_finite()
                        && f.mtime_ms >= 0.
                        && f.mtime_ms.fract() == 0.
                        && f.mtime_ms <= MAX_SAFE_INTEGER as f64
                        && f.contribution.valid()
                        && f.last_cumulative.is_none_or(|v| v.valid())
                        && f.messages
                            .as_ref()
                            .is_none_or(|m| m.iter().all(|(k, v)| hash(k) && v.valid()))
                })
        })
}
