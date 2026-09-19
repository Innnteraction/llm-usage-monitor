use super::format::{format_percent, format_reset_countdown, get_usage_tone, UsageTone};
use super::theme::Palette;
use crate::core::types::{ProviderId, ProviderSnapshot, QuotaWindow, SnapshotStatus};
use chrono::Utc;
use gpui::prelude::*;
use gpui::{div, rgb, DefiniteLength, FontWeight, IntoElement, ParentElement, Styled};

pub fn render_quota_card(provider: &ProviderSnapshot, palette: Palette, now: chrono::DateTime<Utc>) -> impl IntoElement {
    let is_stale = provider.status == SnapshotStatus::Stale;

    let status_color = match provider.status {
        SnapshotStatus::Fresh => rgb(0x22c55e),       // green-500
        SnapshotStatus::Stale => palette.muted,       // zinc-400
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
        .bg(palette.surface) // zinc-800
        .border_1()
        .border_color(palette.border) // zinc-700
        // Header
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .pb_1()
                .border_b_1()
                .border_color(palette.border)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(div().size_2().rounded_full().bg(status_color))
                        .child(
                            div()
                                .text_sm()
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(palette.text)
                                .child(display_name),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .children(provider.account_label.as_ref().map(|acc| {
                            div().text_xs().text_color(palette.muted).child(acc.clone())
                        }))
                        .child(div().text_xs().text_color(status_color).child(status_text)),
                ),
        )
        .children(provider.error.as_ref().map(|error| {
            div()
                .text_xs()
                .text_color(palette.muted)
                .child(error.message.clone())
        }))
        .children(
            provider
                .last_successful_at
                .filter(|_| is_stale)
                .map(|time| {
                    div().text_xs().text_color(palette.muted).child(format!(
                        "마지막 정상: {}",
                        time.with_timezone(&chrono::Local).format("%m/%d %H:%M")
                    ))
                }),
        )
        // Quota Windows
        .child(div().flex().flex_col().gap_2().pt_1().children(
            if provider.quota_windows.is_empty() {
                vec![div()
                    .text_xs()
                    .text_color(palette.muted)
                    .child("쿼터 정보가 제공되지 않거나 미설치 상태입니다.")
                    .into_any_element()]
            } else {
                provider
                    .quota_windows
                    .iter()
                    .map(|win| render_quota_window(win, is_stale, now, palette).into_any_element())
                    .collect()
            },
        ))
}

fn render_quota_window(
    win: &QuotaWindow,
    is_stale: bool,
    now: chrono::DateTime<Utc>,
    palette: Palette,
) -> impl IntoElement {
    let tone = get_usage_tone(win.used_percent, is_stale);
    let bar_color = match tone {
        UsageTone::Low => rgb(0x10b981),    // emerald-500
        UsageTone::Medium => rgb(0xf59e0b), // amber-500
        UsageTone::High => rgb(0xef4444),   // red-500
        UsageTone::Stale => palette.muted,  // zinc-500
    };

    let fraction = match win.used_percent {
        Some(p) => (p.clamp(0.0, 100.0) / 100.0) as f32,
        None => 0.0,
    };

    let countdown_text = format_reset_countdown(win.resets_at, now);

    let help = format!(
        "계정 전체 쿼터 사용률입니다. 로컬 토큰 합계와 별개입니다.\n리셋: {}",
        win.resets_at
            .map(|t| t
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M:%S %Z")
                .to_string())
            .unwrap_or_else(|| "벤더 미제공".into())
    );
    div()
        .id(gpui::SharedString::from(win.id.clone()))
        .tooltip(move |_, cx| super::tooltip::tooltip(help.clone(), palette, cx))
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
                        .text_color(palette.text)
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
                        .child(div().text_color(palette.muted).child(countdown_text)),
                ),
        )
        // Progress Bar
        .child(
            div()
                .w_full()
                .h_2()
                .rounded_full()
                .bg(palette.background) // zinc-900 background track
                .child(
                    div()
                        .h_full()
                        .rounded_full()
                        .w(DefiniteLength::Fraction(fraction))
                        .bg(bar_color),
                ),
        )
}
