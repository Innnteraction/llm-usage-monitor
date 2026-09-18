use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
        self.cache_read_tokens = self.cache_read_tokens.saturating_add(other.cache_read_tokens);
        self.cache_write_tokens = self.cache_write_tokens.saturating_add(other.cache_write_tokens);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUsageFileCheckpoint {
    pub file_key: String,
    pub identity: String,
    pub size: u64,
    pub mtime_ms: f64,
    pub offset: u64,
    pub boundary_hash: String,
    #[serde(default)]
    pub error_count: Option<u32>,
    #[serde(default)]
    pub observed_from: Option<String>,
    pub contribution: TokenContribution,
    #[serde(default)]
    pub last_cumulative: Option<TokenContribution>,
    #[serde(default)]
    pub messages: Option<HashMap<String, TokenContribution>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderCheckpointSection {
    pub files: HashMap<String, LocalUsageFileCheckpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUsageCheckpointState {
    pub schema_version: u32,
    pub providers: HashMap<String, ProviderCheckpointSection>,
}

impl Default for LocalUsageCheckpointState {
    fn default() -> Self {
        Self {
            schema_version: 1,
            providers: HashMap::new(),
        }
    }
}
