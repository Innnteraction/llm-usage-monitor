use crate::core::types::{ProviderId, ProviderSnapshot, SnapshotStatus};
use chrono::Utc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum JobKey {
    CodexQuota,
    ClaudeQuota,
    AntigravityQuota,
    CodexHealth,
    ClaudeHealth,
    AntigravityHealth,
    CodexLocal,
    ClaudeLocal,
}
impl JobKey {
    pub(super) const ALL: [Self; 8] = [
        Self::CodexQuota,
        Self::ClaudeQuota,
        Self::AntigravityQuota,
        Self::CodexHealth,
        Self::ClaudeHealth,
        Self::AntigravityHealth,
        Self::CodexLocal,
        Self::ClaudeLocal,
    ];
    pub(super) fn slot(self) -> usize {
        Self::ALL.iter().position(|key| *key == self).unwrap()
    }
    pub(super) fn provider(self) -> ProviderId {
        match self {
            Self::CodexQuota | Self::CodexHealth | Self::CodexLocal => ProviderId::Codex,
            Self::ClaudeQuota | Self::ClaudeHealth | Self::ClaudeLocal => ProviderId::Claude,
            Self::AntigravityQuota | Self::AntigravityHealth => ProviderId::Antigravity,
        }
    }
    pub(super) fn is_quota(self) -> bool {
        matches!(
            self,
            Self::CodexQuota | Self::ClaudeQuota | Self::AntigravityQuota
        )
    }
    pub(super) fn is_local(self) -> bool {
        matches!(self, Self::CodexLocal | Self::ClaudeLocal)
    }
    pub(super) fn provider_index(self) -> usize {
        match self.provider() {
            ProviderId::Codex => 0,
            ProviderId::Claude => 1,
            ProviderId::Antigravity => 2,
        }
    }
}

#[derive(Clone)]
pub(super) struct Job {
    pub(super) generation: u64,
    pub(super) in_flight: bool,
    pub(super) queued: bool,
    pub(super) failures: usize,
    pub(super) due: std::time::Instant,
}
impl Job {
    pub(super) fn new() -> Self {
        Self {
            generation: 0,
            in_flight: false,
            queued: false,
            failures: 0,
            due: std::time::Instant::now(),
        }
    }
    pub(super) fn request(&mut self) {
        if self.in_flight {
            self.queued = true;
        } else {
            self.due = std::time::Instant::now();
        }
    }
}
pub(super) fn quota_delay(p: &ProviderSnapshot, failures: usize) -> std::time::Duration {
    if p.status == SnapshotStatus::Fresh {
        return std::time::Duration::from_secs(60);
    }
    if let Some(delay) = p
        .error
        .as_ref()
        .and_then(|e| e.retry_at)
        .and_then(|t| (t - Utc::now()).to_std().ok())
    {
        return delay;
    }
    std::time::Duration::from_secs([60, 120, 240, 480, 900][failures.min(4)])
}

#[derive(Debug)]
pub(super) enum Collected {
    Quota(ProviderSnapshot),
    Health(crate::core::types::VendorServiceStatus),
    Local(crate::core::types::LocalTokenUsage),
    Failed,
}
