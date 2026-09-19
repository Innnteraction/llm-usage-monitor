use super::{
    types::{LocalUsageFileCheckpoint, TokenContribution},
    LocalUsageCheckpointStore,
};
use crate::core::types::LocalTokenUsage;
use serde_json::Value;
use std::path::PathBuf;
pub struct CodexLocalScanner {
    root_path: PathBuf,
    checkpoint_store: LocalUsageCheckpointStore,
}
impl CodexLocalScanner {
    pub fn new(checkpoint_store: LocalUsageCheckpointStore) -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            root_path: std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex"))
                .join("sessions"),
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
        tokio::task::spawn_blocking(move || super::scan(&root, &store, "codex", parse))
            .await
            .unwrap_or_else(|_| super::failed_usage())
    }
}

fn parse(value: Value, cp: &mut LocalUsageFileCheckpoint) -> Result<(), ()> {
    if value["type"] != "event_msg" || value["payload"]["type"] != "token_count" {
        return Ok(());
    }
    let usage = &value["payload"]["info"]["total_token_usage"];
    if usage.is_null() {
        return Ok(());
    }
    let current = TokenContribution {
        input_tokens: usage["input_tokens"].as_u64().ok_or(())?,
        output_tokens: usage["output_tokens"].as_u64().ok_or(())?,
        cache_read_tokens: usage["cached_input_tokens"].as_u64().ok_or(())?,
        cache_write_tokens: 0,
    };
    if !current.valid()
        || usage["total_tokens"].as_u64() != Some(current.input_tokens + current.output_tokens)
    {
        return Err(());
    }
    let previous = cp.last_cumulative.unwrap_or_default();
    let mut contribution = cp.contribution;
    contribution.add(&TokenContribution {
        input_tokens: current.input_tokens.saturating_sub(previous.input_tokens),
        output_tokens: current.output_tokens.saturating_sub(previous.output_tokens),
        cache_read_tokens: current
            .cache_read_tokens
            .saturating_sub(previous.cache_read_tokens),
        cache_write_tokens: 0,
    });
    if !contribution.valid() {
        return Err(());
    }
    cp.contribution = contribution;
    cp.last_cumulative = Some(current);
    super::observe(&value, cp);
    Ok(())
}
