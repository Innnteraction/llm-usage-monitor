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
                Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
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
            let _ = fs::write(&self.path, json);
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
