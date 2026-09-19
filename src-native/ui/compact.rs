use super::{format::*, presentation::*, theme::Palette};
use crate::core::types::*;
use chrono::{DateTime, Utc};
use gpui::{div, prelude::*, px, relative, svg, IntoElement, SharedString};
use std::collections::HashSet;

pub fn render_compact(
    providers: &[ProviderSnapshot],
    p: Palette,
    now: DateTime<Utc>,
    errors: &HashSet<ProviderId>,
    events: UiEvents,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(4.))
        .py(px(2.))
        .w_full()
        .text_size(px(11.968))
        .children(providers.iter().map(|provider| {
            let id = provider.provider_id;
            let five = provider.quota_windows.iter().find(|w| {
                if id == ProviderId::Antigravity {
                    w.id == "agy-gemini-5h"
                } else {
                    w.kind == QuotaKind::FiveHour
                }
            });
            let weekly = provider.quota_windows.iter().find(|w| {
                if id == ProviderId::Antigravity {
                    w.id == "agy-gemini-weekly"
                } else {
                    w.kind == QuotaKind::Weekly
                }
            });
            let fable = provider
                .quota_windows
                .iter()
                .find(|w| id == ProviderId::Claude && is_fable(w));
            let event = events.clone();
            let has_error = provider.error.is_some();
            let help = format!(
                "{}\n{}\nstatus: {}",
                provider_name(id),
                provider.account_label.as_deref().unwrap_or(""),
                status(provider, now)
            );
            div()
                .flex()
                .flex_col()
                .child(
                    div()
                        .id(SharedString::from(format!("compact-{}", id.as_str())))
                        .flex()
                        .items_center()
                        .gap(px(5.))
                        .px(px(2.))
                        .py(px(3.))
                        .on_click(move |_, window, cx| {
                            if has_error {
                                event(UiAction::Error(id), window, cx);
                            }
                        })
                        .child(
                            div()
                                .id(SharedString::from(format!("brand-{}", id.as_str())))
                                .w(px(22.))
                                .h(px(18.))
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .justify_center()
                                .tooltip(move |_, cx| super::tooltip::tooltip(help.clone(), p, cx))
                                .child(
                                    svg()
                                        .path(match id {
                                            ProviderId::Codex => "OpenAI",
                                            ProviderId::Claude => "Claude",
                                            ProviderId::Antigravity => "Antigravity",
                                        })
                                        .size(px(14.))
                                        .text_color(p.text),
                                ),
                        )
                        .child(slot(five, "5h", true, p, now))
                        .child(slot(weekly, "7d", true, p, now))
                        .child(slot(fable, "fable", id == ProviderId::Claude, p, now)),
                )
                .children(
                    provider
                        .error
                        .as_ref()
                        .filter(|_| errors.contains(&id))
                        .map(|error| {
                            div()
                                .ml(px(24.))
                                .px(px(8.))
                                .py(px(4.))
                                .text_size(px(10.56))
                                .text_color(p.high)
                                .child(format!(
                                    "{}{}",
                                    error_help(&error.code),
                                    if provider.status == SnapshotStatus::Stale {
                                        format!(
                                            " Last successful {}.",
                                            updated_at(
                                                provider
                                                    .last_successful_at
                                                    .unwrap_or(provider.fetched_at)
                                            )
                                        )
                                    } else {
                                        String::new()
                                    }
                                ))
                        }),
                )
        }))
}
fn slot(
    w: Option<&QuotaWindow>,
    label: &str,
    show: bool,
    p: Palette,
    now: DateTime<Utc>,
) -> impl IntoElement {
    let used = w
        .filter(|w| w.status != SnapshotStatus::Unavailable)
        .and_then(|w| w.used_percent);
    let color = match get_usage_tone(used, w.is_some_and(|w| w.status == SnapshotStatus::Stale)) {
        UsageTone::Low => p.low,
        UsageTone::Medium => p.medium,
        UsageTone::High => p.high,
        UsageTone::Stale => p.muted,
    };
    let text = w
        .map(|w| format_reset_countdown(w.resets_at, now))
        .unwrap_or_else(|| "--".into());
    let text = if text == "reset pending" {
        "pending".into()
    } else {
        text
    };
    div()
        .flex_1()
        .min_w_0()
        .flex()
        .items_center()
        .gap(px(4.))
        .when(show, |el| {
            el.child(
                div()
                    .relative()
                    .w(px(48.))
                    .h(px(18.))
                    .flex_shrink_0()
                    .rounded(px(4.))
                    .overflow_hidden()
                    .bg(p.track)
                    .child(
                        div()
                            .absolute()
                            .left_0()
                            .top_0()
                            .h_full()
                            .w(relative((used.unwrap_or(0.) / 100.).clamp(0., 1.) as f32))
                            .bg(color),
                    )
                    .child(
                        div()
                            .relative()
                            .size_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_size(px(9.856))
                            .child(label.to_owned()),
                    ),
            )
            .child(
                div().text_color(color).child(
                    used.map(|v| format_percent(Some(v)))
                        .unwrap_or_else(|| "--%".into()),
                ),
            )
            .child(
                div()
                    .min_w_0()
                    .overflow_hidden()
                    .text_ellipsis()
                    .text_color(p.muted)
                    .text_size(px(9.856))
                    .child(text),
            )
        })
}
