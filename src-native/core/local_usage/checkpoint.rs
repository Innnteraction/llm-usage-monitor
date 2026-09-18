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

    pub fn get_state(&self) -> LocalUsageCheckpointState {
        self.state.lock().unwrap().clone()
    }

    pub fn save_state(&self, state: LocalUsageCheckpointState) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&state) {
            let _ = fs::write(&self.path, json);
        }
        let mut guard = self.state.lock().unwrap();
        *guard = state;
    }
}
