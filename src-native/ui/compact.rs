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
                    w.id == "agy-gemini-5h" || w.kind == QuotaKind::FiveHour
                } else {
                    w.kind == QuotaKind::FiveHour
                }
            });
            let weekly = provider
                .quota_windows
                .iter()
                .find(|w| {
                    if id == ProviderId::Antigravity {
                        w.id == "agy-gemini-weekly"
                    } else {
                        w.kind == QuotaKind::Weekly
                    }
                })
                .or_else(|| {
                    provider
                        .quota_windows
                        .iter()
                        .find(|w| w.kind == QuotaKind::Weekly)
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
    let tone = get_usage_tone(used, w.is_some_and(|w| w.status == SnapshotStatus::Stale));
    let light = p.background == gpui::rgb(0xf5f5f7);
    let fable = label == "fable" && used.is_some() && tone != UsageTone::Stale;
    let color = match tone {
        UsageTone::Low => p.low,
        UsageTone::Medium => p.medium,
        UsageTone::High => p.high,
        UsageTone::Stale => p.muted,
    };
    let (color, fill) = if fable {
        let (text, start, end) = match (light, used.unwrap_or(0.)) {
            (true, v) if v >= 80. => (0xb91c1c, 0xb91c1c, 0xdc2626),
            (true, v) if v >= 50. => (0x9a3412, 0x9a3412, 0xc25430),
            (true, _) => (0xc25e3e, 0xc25e3e, 0xd97757),
            (false, v) if v >= 80. => (0xef4444, 0xdc2626, 0xef4444),
            (false, v) if v >= 50. => (0xd9653b, 0xbf4f2a, 0xdc6942),
            (false, _) => (0xe8a690, 0xb86043, 0xe29074),
        };
        (
            gpui::rgb(text),
            gpui::linear_gradient(
                90.,
                gpui::linear_color_stop(gpui::rgb(start), 0.),
                gpui::linear_color_stop(gpui::rgb(end), 1.),
            ),
        )
    } else {
        let fill = if light {
            match tone {
                UsageTone::Low => gpui::rgb(0x16a34a),
                UsageTone::Medium => gpui::rgb(0xd97706),
                UsageTone::High => p.high,
                UsageTone::Stale => gpui::rgb(0x94a3b8),
            }
        } else {
            color
        };
        (
            if used.is_none() { p.muted } else { color },
            gpui::solid_background(fill),
        )
    };
    let inverted = if light || fable || matches!(tone, UsageTone::High | UsageTone::Stale) {
        gpui::rgb(0xffffff)
    } else {
        gpui::rgb(0x0f1412)
    };
    let label = label.to_uppercase();
    let capsule_label = move |color| {
        div()
            .absolute()
            .top_0()
            .left_0()
            .w(px(48.))
            .h(px(18.))
            .flex()
            .items_center()
            .justify_center()
            .text_size(px(10.208))
            .font_weight(gpui::FontWeight::BOLD)
            .text_color(color)
            .child(label.clone())
    };
    let text = w
        .map(|w| format_compact_countdown(w.resets_at, now))
        .unwrap_or_else(|| "--".into());
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
                    .bg(if light {
                        gpui::rgba(0x0000000f)
                    } else {
                        gpui::rgba(0xffffff14)
                    })
                    .child(capsule_label(if light {
                        gpui::rgb(0x64748b)
                    } else {
                        p.muted
                    }))
                    .child(
                        div()
                            .absolute()
                            .left_0()
                            .top_0()
                            .h_full()
                            .w(relative((used.unwrap_or(0.) / 100.).clamp(0., 1.) as f32))
                            .overflow_hidden()
                            .bg(fill)
                            .child(capsule_label(inverted)),
                    ),
            )
            .child(
                div()
                    .w(px(28.))
                    .flex_shrink_0()
                    .text_right()
                    .text_size(px(13.024))
                    .font_weight(gpui::FontWeight::BOLD)
                    .text_color(color)
                    .child(
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
                    .text_size(px(13.024))
                    .child(text),
            )
        })
}
