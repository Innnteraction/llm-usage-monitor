use super::checkpoint::LocalUsageCheckpointStore;
use super::types::{LocalUsageFileCheckpoint, TokenContribution};
use crate::core::types::LocalTokenUsage;
use chrono::Utc;
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

pub struct CodexLocalScanner {
    root_path: PathBuf,
    checkpoint_store: LocalUsageCheckpointStore,
}

impl CodexLocalScanner {
    pub fn new(checkpoint_store: LocalUsageCheckpointStore) -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let root_path = home.join(".codex").join("sessions");
        Self {
            root_path,
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
        tokio::task::spawn_blocking(move || scan_codex_sync(&root, &store))
            .await
            .unwrap_or_else(|_| empty_usage())
    }
}

fn scan_codex_sync(root_path: &Path, store: &LocalUsageCheckpointStore) -> LocalTokenUsage {
    let now = Utc::now();
    if !root_path.exists() {
        return empty_usage();
    }

    let mut state = store.get_state();
    let provider_files = state
        .providers
        .entry("codex".to_string())
        .or_default();

    let mut files = Vec::new();
    find_jsonl_files(root_path, &mut files);

    let mut total_scanned = 0u64;
    let mut total_failed = 0u64;
    let mut agg = TokenContribution::default();
    let mut state_changed = false;

    for file_path in &files {
        total_scanned += 1;
        let file_key = file_path.to_string_lossy().to_string();

        let metadata = match file_path.metadata() {
            Ok(m) => m,
            Err(_) => {
                total_failed += 1;
                continue;
            }
        };
        let file_size = metadata.len();
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);

        if let Some(cp) = provider_files.files.get(&file_key) {
            if cp.size == file_size && (cp.mtime_ms - mtime_ms).abs() < 1.0 {
                agg.add(&cp.contribution);
                continue;
            }
        }

        match scan_single_codex_file(file_path) {
            Ok(contrib) => {
                agg.add(&contrib);
                provider_files.files.insert(
                    file_key.clone(),
                    LocalUsageFileCheckpoint {
                        file_key,
                        identity: String::new(),
                        size: file_size,
                        mtime_ms,
                        offset: file_size,
                        boundary_hash: String::new(),
                        error_count: None,
                        observed_from: None,
                        contribution: contrib,
                        last_cumulative: Some(contrib),
                        messages: None,
                    },
                );
                state_changed = true;
            }
            Err(_) => {
                total_failed += 1;
            }
        }
    }

    if state_changed {
        store.save_state(state);
    }

    LocalTokenUsage {
        scope: "local_device".to_string(),
        scanned_file_count: total_scanned,
        failed_file_count: total_failed,
        input_tokens: agg.input_tokens,
        output_tokens: agg.output_tokens,
        cache_read_tokens: if agg.cache_read_tokens > 0 {
            Some(agg.cache_read_tokens)
        } else {
            None
        },
        cache_write_tokens: None,
        total_tokens: agg.input_tokens.saturating_add(agg.output_tokens),
        partial: total_failed > 0,
        calculated_at: now,
        observed_from: None,
    }
}

fn scan_single_codex_file(path: &Path) -> std::io::Result<TokenContribution> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);

    let mut last_cumulative: Option<TokenContribution> = None;

    for line_res in reader.lines() {
        let line = match line_res {
            Ok(l) => l,
            Err(_) => continue,
        };

        if !line.contains("token_count") || !line.contains("total_token_usage") {
            continue;
        }

        if let Ok(val) = serde_json::from_str::<Value>(&line) {
            if val.get("type").and_then(|v| v.as_str()) != Some("event_msg") {
                continue;
            }
            let payload = match val.get("payload") {
                Some(p) => p,
                None => continue,
            };
            if payload.get("type").and_then(|v| v.as_str()) != Some("token_count") {
                continue;
            }
            let usage = match payload.get("info").and_then(|i| i.get("total_token_usage")) {
                Some(u) => u,
                None => continue,
            };

            let input = usage.get("input_tokens").and_then(|v| v.as_u64());
            let output = usage.get("output_tokens").and_then(|v| v.as_u64());
            let cached = usage.get("cached_input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);

            if let (Some(inp), Some(out)) = (input, output) {
                last_cumulative = Some(TokenContribution {
                    input_tokens: inp,
                    output_tokens: out,
                    cache_read_tokens: cached,
                    cache_write_tokens: 0,
                });
            }
        }
    }

    Ok(last_cumulative.unwrap_or_default())
}

fn find_jsonl_files(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                find_jsonl_files(&path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                out.push(path);
            }
        }
    }
}

fn empty_usage() -> LocalTokenUsage {
    LocalTokenUsage {
        scope: "local_device".to_string(),
        scanned_file_count: 0,
        failed_file_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: None,
        cache_write_tokens: None,
        total_tokens: 0,
        partial: false,
        calculated_at: Utc::now(),
        observed_from: None,
    }
}
