use super::{
    format::{format_percent, format_reset_countdown},
    theme::Palette,
};
use crate::core::types::{ProviderSnapshot, SnapshotStatus};
use chrono::Utc;
use gpui::{div, prelude::*, px, IntoElement};

pub fn render_compact(providers: &[ProviderSnapshot], palette: Palette) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap_2()
        .children(providers.iter().map(|provider| {
            div()
                .p_2()
                .rounded_md()
                .bg(palette.surface)
                .border_1()
                .border_color(palette.border)
                .child(div().text_sm().child(format!(
                    "{} · {}",
                    provider.provider_id.as_str(),
                    match provider.status {
                        SnapshotStatus::Fresh => "최신",
                        SnapshotStatus::Stale => "이전 값",
                        SnapshotStatus::Unavailable => "미제공",
                    }
                )))
                .children(provider.error.as_ref().map(|e| {
                    div()
                        .text_xs()
                        .text_color(palette.muted)
                        .child(e.message.clone())
                }))
                .children(provider.quota_windows.is_empty().then(|| {
                    div()
                        .text_xs()
                        .text_color(palette.muted)
                        .child("쿼터 미제공")
                }))
                .children(provider.quota_windows.iter().map(|quota| {
                    let help = format!(
                        "계정 전체 사용률 · {} · 리셋 {}",
                        quota.label,
                        quota
                            .resets_at
                            .map(|t| t
                                .with_timezone(&chrono::Local)
                                .format("%Y-%m-%d %H:%M %Z")
                                .to_string())
                            .unwrap_or_else(|| "미제공".into())
                    );
                    div()
                        .id(gpui::SharedString::from(quota.id.clone()))
                        .tooltip(move |_, cx| super::tooltip::tooltip(help.clone(), palette, cx))
                        .flex()
                        .justify_between()
                        .gap_2()
                        .text_xs()
                        .py_1()
                        .child(div().flex_1().child(quota.label.clone()))
                        .child(div().w(px(55.)).child(format_percent(quota.used_percent)))
                        .child(
                            div()
                                .w(px(110.))
                                .text_color(palette.muted)
                                .child(format_reset_countdown(quota.resets_at, Utc::now())),
                        )
                }))
        }))
}
