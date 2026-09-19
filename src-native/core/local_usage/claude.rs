use super::{
    types::{LocalUsageFileCheckpoint, TokenContribution},
    LocalUsageCheckpointStore,
};
use crate::core::types::LocalTokenUsage;
use serde_json::Value;
use std::path::PathBuf;
pub struct ClaudeLocalScanner {
    root_path: PathBuf,
    checkpoint_store: LocalUsageCheckpointStore,
}
impl ClaudeLocalScanner {
    pub fn new(checkpoint_store: LocalUsageCheckpointStore) -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            root_path: std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".claude"))
                .join("projects"),
            checkpoint_store,
        }
    }
    pub fn with_root(root_path: PathBuf, checkpoint_store: LocalUsageCheckpointStore) -> Self {
        Self {
            root_path,
            checkpoint_store,
        }
    }
    pub fn cached_summary(&self) -> Option<LocalTokenUsage> {
        let section = self.checkpoint_store.get_provider("claude");
        (section.root_key.as_deref() == Some(super::root_hash(&self.root_path).as_str()))
            .then_some(section.summary)
            .flatten()
    }
    pub async fn scan(&self) -> LocalTokenUsage {
        let root = self.root_path.clone();
        let store = self.checkpoint_store.clone();
        tokio::task::spawn_blocking(move || super::scan(&root, &store, "claude", parse))
            .await
            .unwrap_or_else(|_| super::failed_usage())
    }
}

fn parse(value: Value, cp: &mut LocalUsageFileCheckpoint) -> Result<(), ()> {
    if value["type"] != "assistant" {
        return Ok(());
    }
    let message = &value["message"];
    let usage = &message["usage"];
    if usage.is_null() {
        return Ok(());
    }
    let id = message["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or(())?;
    let input = usage["input_tokens"].as_u64().ok_or(())?;
    let output = usage["output_tokens"].as_u64().ok_or(())?;
    let read = usage["cache_read_input_tokens"].as_u64().unwrap_or(0);
    let write = usage["cache_creation_input_tokens"].as_u64().unwrap_or(0);
    let current = TokenContribution {
        input_tokens: input.saturating_add(read).saturating_add(write),
        output_tokens: output,
        cache_read_tokens: read,
        cache_write_tokens: write,
    };
    if !current.valid() {
        return Err(());
    }
    let messages = cp.messages.get_or_insert_with(Default::default);
    let key = super::hash(id);
    let mut merged = messages.get(&key).copied().unwrap_or_default();
    merged.merge_message(&current);
    if !merged.valid() {
        return Err(());
    }
    messages.insert(key, merged);
    cp.contribution = TokenContribution::default();
    for v in messages.values() {
        cp.contribution.add(v);
    }
    super::observe(&value, cp);
    Ok(())
}
