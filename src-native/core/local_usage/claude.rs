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
    let messages = cp.messages.get_or_insert_with(Default::default);
    let previous = messages.insert(id.to_string(), current).unwrap_or_default();
    cp.contribution.input_tokens = cp
        .contribution
        .input_tokens
        .saturating_sub(previous.input_tokens)
        .saturating_add(current.input_tokens);
    cp.contribution.output_tokens = cp
        .contribution
        .output_tokens
        .saturating_sub(previous.output_tokens)
        .saturating_add(current.output_tokens);
    cp.contribution.cache_read_tokens = cp
        .contribution
        .cache_read_tokens
        .saturating_sub(previous.cache_read_tokens)
        .saturating_add(read);
    cp.contribution.cache_write_tokens = cp
        .contribution
        .cache_write_tokens
        .saturating_sub(previous.cache_write_tokens)
        .saturating_add(write);
    Ok(())
}
