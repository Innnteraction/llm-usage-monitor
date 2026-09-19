//! Electron renderer/selectors.ts에 대응하는 순수 표시 규칙.
use crate::core::types::*;
use chrono::{DateTime, Local, Utc};

pub fn provider_name(id: ProviderId) -> &'static str {
    match id {
        ProviderId::Codex => "Codex",
        ProviderId::Claude => "Claude Code",
        ProviderId::Antigravity => "Antigravity",
    }
}
pub fn primary_windows(p: &ProviderSnapshot) -> Vec<&QuotaWindow> {
    if p.provider_id == ProviderId::Antigravity {
        return ["agy-gemini-5h", "agy-gemini-weekly"]
            .iter()
            .filter_map(|id| p.quota_windows.iter().find(|w| w.id == *id))
            .collect();
    }
    let kinds = if p.provider_id == ProviderId::Codex {
        vec![QuotaKind::Weekly]
    } else {
        vec![QuotaKind::FiveHour, QuotaKind::Weekly]
    };
    let mut windows: Vec<_> = kinds
        .iter()
        .filter_map(|kind| p.quota_windows.iter().find(|w| w.kind == *kind))
        .collect();
    if p.provider_id == ProviderId::Claude {
        if let Some(w) = p.quota_windows.iter().find(|w| is_fable(w)) {
            windows.push(w);
        }
    }
    windows
}
pub fn is_fable(w: &QuotaWindow) -> bool {
    w.kind == QuotaKind::ModelWeekly
        && w.label
            .split(|c: char| !c.is_alphanumeric() && c != '_')
            .any(|s| s.eq_ignore_ascii_case("fable"))
}
pub fn additional_windows(p: &ProviderSnapshot) -> Vec<&QuotaWindow> {
    let primary = primary_windows(p);
    let mut seen = std::collections::HashSet::new();
    p.quota_windows
        .iter()
        .filter(|w| {
            if primary.iter().any(|x| x.id == w.id) || !seen.insert(&w.id) {
                return false;
            }
            p.provider_id != ProviderId::Codex
                || (w.kind == QuotaKind::ModelWeekly
                    && !w.label.trim().eq_ignore_ascii_case("gpt-reserve weekly"))
                || (w.kind == QuotaKind::Other && w.id.starts_with("codex-limit-"))
        })
        .collect()
}
pub fn quota_label(w: &QuotaWindow) -> String {
    if w.id == "agy-gemini-weekly" || w.kind == QuotaKind::Weekly {
        "7d".into()
    } else if w.id == "agy-gemini-5h" {
        "5h".into()
    } else if w.kind == QuotaKind::ModelWeekly && w.label.to_lowercase().ends_with(" weekly") {
        w.label[..w.label.len() - 7].into()
    } else {
        w.label.clone()
    }
}
pub fn status(p: &ProviderSnapshot, now: DateTime<Utc>) -> &'static str {
    match p.status {
        SnapshotStatus::Fresh => "fresh",
        SnapshotStatus::Unavailable => "unavailable",
        SnapshotStatus::Stale
            if now
                .signed_duration_since(p.last_successful_at.unwrap_or(p.fetched_at))
                .num_milliseconds()
                > 1_800_000 =>
        {
            "unavailable"
        }
        SnapshotStatus::Stale => "stale",
    }
}
pub fn updated_at(time: DateTime<Utc>) -> String {
    time.with_timezone(&Local).format("%-I:%M %p").to_string()
}
pub fn error_help(code: &str) -> &'static str {
    match code {
        "not_installed" => "CLI is not installed.",
        "not_authenticated" => "Sign in with the CLI to view quota.",
        "workspace_trust_required" => "Workspace trust confirmation required.",
        "unsupported_output" => "Unsupported CLI response format.",
        "rate_limited" => "Request limit reached.",
        "network" => "Check network connection.",
        "timeout" => "CLI request timed out.",
        "process_failed" => "CLI process execution failed.",
        "unavailable" => "Quota is currently unavailable.",
        _ => "An unexpected error occurred.",
    }
}
pub fn source_name(source: ProviderSource) -> &'static str {
    match source {
        ProviderSource::CodexAppServer => "Codex App Server",
        ProviderSource::ClaudeCli => "Claude CLI",
        ProviderSource::AntigravityCli => "Antigravity CLI, IDE",
        ProviderSource::LocalFixture => "Local fixture",
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn electron_fixture_selection_and_stale_boundary() {
        let s: AppSnapshot =
            serde_json::from_str(include_str!("../../.work/parity-reference/snapshot.json"))
                .unwrap();
        assert_eq!(
            primary_windows(&s.providers[0])
                .iter()
                .map(|w| w.id.as_str())
                .collect::<Vec<_>>(),
            vec!["codex-weekly"]
        );
        assert_eq!(additional_windows(&s.providers[0]).len(), 2);
        assert_eq!(primary_windows(&s.providers[1]).len(), 3);
        assert_eq!(primary_windows(&s.providers[2])[1].id, "agy-gemini-weekly");
        let mut p = s.providers[0].clone();
        p.status = SnapshotStatus::Stale;
        assert_eq!(
            status(&p, s.updated_at + chrono::Duration::minutes(30)),
            "stale"
        );
        assert_eq!(
            status(&p, s.updated_at + chrono::Duration::minutes(31)),
            "unavailable"
        );
    }
}

#[derive(Clone)]
pub enum UiAction {
    Refresh,
    Compact,
    Theme,
    Pin,
    Additional(ProviderId),
    Error(ProviderId),
    OpenUrl(String),
    Setup(ProviderId, bool),
}
pub type UiEvents = std::rc::Rc<dyn Fn(UiAction, &mut gpui::Window, &mut gpui::App)>;

/// Mouse and keyboard activation share the same action and focus order.
pub fn action_button(
    id: impl Into<gpui::ElementId>,
    action: UiAction,
    events: UiEvents,
) -> gpui::Stateful<gpui::Div> {
    use gpui::prelude::*;
    let clicked = events.clone();
    let click_action = action.clone();
    gpui::div()
        .id(id)
        .focusable()
        .tab_index(0)
        .cursor_pointer()
        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(move |_, window, cx| clicked(click_action.clone(), window, cx))
        .on_key_down(move |event, window, cx| {
            if matches!(event.keystroke.key.as_str(), "enter" | "space") {
                cx.stop_propagation();
                events(action.clone(), window, cx);
            }
        })
}
