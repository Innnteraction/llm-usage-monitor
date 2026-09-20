use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenContribution {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_tokens: u64,
    #[serde(default)]
    pub cache_write_tokens: u64,
}

impl TokenContribution {
    pub fn add(&mut self, other: &TokenContribution) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.cache_read_tokens = self
            .cache_read_tokens
            .saturating_add(other.cache_read_tokens);
        self.cache_write_tokens = self
            .cache_write_tokens
            .saturating_add(other.cache_write_tokens);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalUsageFileCheckpoint {
    pub file_key: String,
    pub identity: String,
    pub size: u64,
    pub mtime_ms: f64,
    pub offset: u64,
    pub boundary_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_from: Option<String>,
    pub contribution: TokenContribution,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_cumulative: Option<TokenContribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub messages: Option<HashMap<String, TokenContribution>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderCheckpointSection {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<crate::core::types::LocalTokenUsage>,
    pub files: HashMap<String, LocalUsageFileCheckpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalUsageCheckpointState {
    pub schema_version: u32,
    pub providers: HashMap<String, ProviderCheckpointSection>,
}

impl Default for LocalUsageCheckpointState {
    fn default() -> Self {
        Self {
            schema_version: 2,
            providers: [
                ("codex".into(), ProviderCheckpointSection::default()),
                ("claude".into(), ProviderCheckpointSection::default()),
            ]
            .into_iter()
            .collect(),
        }
    }
}

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
impl TokenContribution {
    pub fn valid(&self) -> bool {
        [
            self.input_tokens,
            self.output_tokens,
            self.cache_read_tokens,
            self.cache_write_tokens,
        ]
        .into_iter()
        .all(|v| v <= MAX_SAFE_INTEGER)
            && self
                .input_tokens
                .checked_add(self.output_tokens)
                .is_some_and(|v| v <= MAX_SAFE_INTEGER)
    }
    pub fn merge_message(&mut self, other: &Self) {
        let base = self
            .input_tokens
            .saturating_sub(self.cache_read_tokens)
            .saturating_sub(self.cache_write_tokens);
        let next_base = other
            .input_tokens
            .saturating_sub(other.cache_read_tokens)
            .saturating_sub(other.cache_write_tokens);
        self.cache_read_tokens = self.cache_read_tokens.max(other.cache_read_tokens);
        self.cache_write_tokens = self.cache_write_tokens.max(other.cache_write_tokens);
        self.input_tokens = base
            .max(next_base)
            .saturating_add(self.cache_read_tokens)
            .saturating_add(self.cache_write_tokens);
        self.output_tokens = self.output_tokens.max(other.output_tokens);
    }
}
