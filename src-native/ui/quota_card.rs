use chrono::Utc;
use gpui::{
    div, rgb, DefiniteLength, FontWeight, IntoElement, ParentElement, Styled,
};
use crate::core::types::{ProviderId, ProviderSnapshot, QuotaWindow, SnapshotStatus};
use super::format::{format_percent, format_reset_countdown, get_usage_tone, UsageTone};

pub fn render_quota_card(provider: &ProviderSnapshot) -> impl IntoElement {
    let now = Utc::now();
    let is_stale = provider.status == SnapshotStatus::Stale;

    let status_color = match provider.status {
        SnapshotStatus::Fresh => rgb(0x22c55e),     // green-500
        SnapshotStatus::Stale => rgb(0xa1a1aa),     // zinc-400
        SnapshotStatus::Unavailable => rgb(0xef4444), // red-500
    };

    let status_text = match provider.status {
        SnapshotStatus::Fresh => "Fresh",
        SnapshotStatus::Stale => "Stale",
        SnapshotStatus::Unavailable => "Offline",
    };

    let display_name = match provider.provider_id {
        ProviderId::Codex => "Codex",
        ProviderId::Claude => "Claude Code",
        ProviderId::Antigravity => "Antigravity",
    };

    div()
        .flex()
        .flex_col()
        .gap_2()
        .p_3()
        .rounded_lg()
        .bg(rgb(0x27272a)) // zinc-800
        .border_1()
        .border_color(rgb(0x3f3f46)) // zinc-700
        // Header
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .pb_1()
                .border_b_1()
                .border_color(rgb(0x3f3f46))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .size_2()
                                .rounded_full()
                                .bg(status_color),
                        )
                        .child(
                            div()
                                .text_sm()
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(rgb(0xf4f4f5))
                                .child(display_name),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .children(provider.account_label.as_ref().map(|acc| {
                            div()
                                .text_xs()
                                .text_color(rgb(0xa1a1aa))
                                .child(acc.clone())
                        }))
                        .child(
                            div()
                                .text_xs()
                                .text_color(status_color)
                                .child(status_text),
                        ),
                ),
        )
        // Quota Windows
        .child(
            div()
                .flex()
                .flex_col()
                .gap_2()
                .pt_1()
                .children(
                    if provider.quota_windows.is_empty() {
                        vec![
                            div()
                                .text_xs()
                                .text_color(rgb(0x71717a))
                                .child("쿼터 정보가 제공되지 않거나 미설치 상태입니다.")
                                .into_any_element()
                        ]
                    } else {
                        provider.quota_windows.iter().map(|win| {
                            render_quota_window(win, is_stale, now).into_any_element()
                        }).collect()
                    }
                ),
        )
}

fn render_quota_window(win: &QuotaWindow, is_stale: bool, now: chrono::DateTime<Utc>) -> impl IntoElement {
    let tone = get_usage_tone(win.used_percent, is_stale);
    let bar_color = match tone {
        UsageTone::Low => rgb(0x10b981),     // emerald-500
        UsageTone::Medium => rgb(0xf59e0b),  // amber-500
        UsageTone::High => rgb(0xef4444),    // red-500
        UsageTone::Stale => rgb(0x71717a),   // zinc-500
    };

    let fraction = match win.used_percent {
        Some(p) => (p.clamp(0.0, 100.0) / 100.0) as f32,
        None => 0.0,
    };

    let countdown_text = format_reset_countdown(win.resets_at, now);

    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .text_xs()
                .child(
                    div()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(rgb(0xd4d4d8))
                        .child(win.label.clone()),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(bar_color)
                                .child(format_percent(win.used_percent)),
                        )
                        .child(
                            div()
                                .text_color(rgb(0x71717a))
                                .child(countdown_text),
                        ),
                ),
        )
        // Progress Bar
        .child(
            div()
                .w_full()
                .h_2()
                .rounded_full()
                .bg(rgb(0x18181b)) // zinc-900 background track
                .child(
                    div()
                        .h_full()
                        .rounded_full()
                        .w(DefiniteLength::Fraction(fraction))
                        .bg(bar_color),
                ),
        )
}
