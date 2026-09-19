use super::{format::*, presentation::*, theme::Palette};
use crate::core::types::*;
use chrono::{DateTime, Utc};
use gpui::{div, prelude::*, px, FontWeight, IntoElement, SharedString};

pub fn render_quota_card(
    p: &ProviderSnapshot,
    index: usize,
    palette: Palette,
    now: DateTime<Utc>,
    expanded: bool,
    events: UiEvents,
    reduced_motion: bool,
) -> impl IntoElement {
    let status = status(p, now);
    let status_color = match status {
        "fresh" => palette.low,
        "stale" => palette.medium,
        _ => palette.high,
    };
    let primary = primary_windows(p);
    let additional = additional_windows(p);
    let mut rows = Vec::new();
    for w in &primary {
        rows.push(render_quota_window(w, palette, now, reduced_motion).into_any_element());
    }
    for (kind, label) in if p.provider_id == ProviderId::Codex {
        vec![(QuotaKind::Weekly, "7d")]
    } else if p.provider_id == ProviderId::Claude {
        vec![(QuotaKind::FiveHour, "5h"), (QuotaKind::Weekly, "7d")]
    } else {
        vec![]
    } {
        if !primary.iter().any(|w| w.kind == kind) {
            rows.push(missing(label, "not provided", palette).into_any_element());
        }
    }
    if p.provider_id == ProviderId::Claude && !p.quota_windows.iter().any(is_fable) {
        rows.push(missing("Fable", "not provided by Claude CLI", palette).into_any_element());
    }
    if p.provider_id == ProviderId::Antigravity && p.quota_windows.is_empty() {
        rows.push(missing("Quota", "not provided", palette).into_any_element());
    }
    let mut sources: Vec<&str> = Vec::new();
    for w in &p.quota_windows {
        let source = source_name(w.source);
        if !sources.contains(&source) {
            sources.push(source);
        }
    }
    let source = if sources.is_empty() {
        match p.provider_id {
            ProviderId::Codex => "Codex CLI",
            ProviderId::Claude => "Claude Code CLI",
            ProviderId::Antigravity => "Antigravity CLI, IDE",
        }
        .into()
    } else {
        sources.join(", ")
    };
    let id = p.provider_id;
    let incident = p.service_status.as_ref().filter(|s| {
        matches!(
            s.indicator,
            ServiceHealthIndicator::Minor
                | ServiceHealthIndicator::Major
                | ServiceHealthIndicator::Critical
        )
    });
    div()
        .id(SharedString::from(format!("provider-{}", id.as_str())))
        .flex()
        .flex_col()
        .w_full()
        .min_w_0()
        .flex_shrink_0()
        .child(
            div()
                .flex()
                .items_baseline()
                .gap(px(8.))
                .mb(px(5.))
                .child(
                    div()
                        .w(px(24.))
                        .flex_shrink_0()
                        .text_right()
                        .text_size(px(14.432))
                        .font_weight(FontWeight::BOLD)
                        .child((index + 1).to_string()),
                )
                .child(
                    div()
                        .flex()
                        .items_baseline()
                        .min_w_0()
                        .flex_1()
                        .gap(px(8.))
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_size(px(15.84))
                                .font_weight(FontWeight::BOLD)
                                .child(provider_name(id)),
                        )
                        .children(p.account_label.as_ref().map(|account| {
                            div()
                                .min_w_0()
                                .overflow_hidden()
                                .text_ellipsis()
                                .text_size(px(10.912))
                                .text_color(palette.muted)
                                .child(account.clone())
                        }))
                        .children(
                            (id == ProviderId::Antigravity && p.account_label.is_some()).then(
                                || {
                                    let events = events.clone();
                                    div()
                                        .id("switch-account")
                                        .cursor_pointer()
                                        .text_size(px(9.504))
                                        .text_color(palette.muted)
                                        .child("switch")
                                        .on_click(move |_, window, cx| {
                                            events(UiAction::Setup(id, true), window, cx)
                                        })
                                },
                            ),
                        ),
                )
                .child(
                    div()
                        .id(SharedString::from(format!("status-{}", id.as_str())))
                        .on_click({
                            let events = events.clone();
                            let url = incident.map(|s| s.status_page_url.clone());
                            move |_, window, cx| {
                                if let Some(url) = &url {
                                    events(UiAction::OpenUrl(url.clone()), window, cx);
                                }
                            }
                        })
                        .flex_shrink_0()
                        .text_size(px(11.968))
                        .font_weight(FontWeight::BOLD)
                        .text_color(status_color)
                        .when_some(incident, |el, s| {
                            let outage = s.indicator == ServiceHealthIndicator::Critical;
                            let help = format!(
                                "{}\n{}",
                                s.incident_title.as_deref().unwrap_or(&s.description),
                                s.status_page_url
                            );
                            el.cursor_pointer()
                                .px(px(6.))
                                .py(px(1.))
                                .rounded(px(4.))
                                .border_1()
                                .border_color(if outage { palette.high } else { palette.medium })
                                .bg(if outage {
                                    gpui::rgba(0xdf626926)
                                } else {
                                    gpui::rgba(0xd2a95f26)
                                })
                                .text_color(if outage { palette.high } else { palette.medium })
                                .hover(|s| s.opacity(0.9))
                                .tooltip(move |_, cx| {
                                    super::tooltip::tooltip(help.clone(), palette, cx)
                                })
                        })
                        .child(if let Some(s) = incident {
                            format!(
                                "⚠️ {}",
                                if s.indicator == ServiceHealthIndicator::Critical {
                                    "outage"
                                } else {
                                    "degraded"
                                }
                            )
                        } else {
                            format!("● {status}")
                        }),
                ),
        )
        .children(p.error.as_ref().map(|e| {
            div()
                .ml(px(32.))
                .text_size(px(10.56))
                .text_color(palette.high)
                .child(format!(
                    "{}{}",
                    error_help(&e.code),
                    if p.status == SnapshotStatus::Stale {
                        format!(
                            " Last successful {}.",
                            updated_at(p.last_successful_at.unwrap_or(p.fetched_at))
                        )
                    } else {
                        String::new()
                    }
                ))
        }))
        .children(
            p.error
                .as_ref()
                .filter(|e| {
                    matches!(id, ProviderId::Claude | ProviderId::Antigravity)
                        && (e.code == "not_authenticated"
                            || id == ProviderId::Claude && e.code == "workspace_trust_required")
                })
                .map(|e| {
                    let alternate = e.code == "workspace_trust_required";
                    let events = events.clone();
                    div()
                        .id(SharedString::from(format!("setup-{}", id.as_str())))
                        .cursor_pointer()
                        .ml(px(32.))
                        .text_size(px(11.968))
                        .child(if alternate {
                            "prepare folder"
                        } else {
                            "sign in"
                        })
                        .on_click(move |_, window, cx| {
                            events(UiAction::Setup(id, alternate), window, cx)
                        })
                }),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .pl(px(32.))
                .children(rows),
        )
        .children((!additional.is_empty()).then(|| {
            let events = events.clone();
            div()
                .ml(px(32.))
                .child(
                    div()
                        .id(SharedString::from(format!("additional-{}", id.as_str())))
                        .cursor_pointer()
                        .text_size(px(11.968))
                        .text_color(palette.muted)
                        .py(px(3.))
                        .child(format!("+{} additional limits", additional.len()))
                        .on_click(move |_, window, cx| {
                            events(UiAction::Additional(id), window, cx)
                        }),
                )
                .children(expanded.then(|| {
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .children(additional.iter().map(|w| {
                            div()
                                .child(div().text_size(px(11.968)).child(w.label.clone()))
                                .child(render_quota_window(w, palette, now, reduced_motion))
                        }))
                }))
        }))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .mt(px(2.))
                .ml(px(32.))
                .text_size(px(9.504))
                .text_color(palette.muted)
                .children(
                    p.local_usage
                        .as_ref()
                        .map(|u| super::local_tokens::render_usage(u, palette)),
                )
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .justify_between()
                        .gap_x(px(10.))
                        .child(format!(
                            "source {}{}",
                            source,
                            if id == ProviderId::Claude {
                                " (Desktop not inspected)"
                            } else {
                                ""
                            }
                        ))
                        .child(format!(
                            "updated {}",
                            updated_at(if p.status == SnapshotStatus::Stale {
                                p.last_successful_at.unwrap_or(p.fetched_at)
                            } else {
                                p.fetched_at
                            })
                        )),
                ),
        )
}
fn missing(label: &str, message: &str, p: Palette) -> impl IntoElement {
    div()
        .flex()
        .justify_between()
        .text_color(p.muted)
        .child(div().text_size(px(13.024)).child(label.to_owned()))
        .child(div().text_size(px(10.912)).child(message.to_owned()))
}
fn render_quota_window(
    w: &QuotaWindow,
    p: Palette,
    now: DateTime<Utc>,
    reduced_motion: bool,
) -> impl IntoElement {
    let unavailable = w.status == SnapshotStatus::Unavailable || w.used_percent.is_none();
    let tone = match get_usage_tone(w.used_percent, w.status == SnapshotStatus::Stale) {
        UsageTone::Low => p.low,
        UsageTone::Medium => p.medium,
        UsageTone::High => p.high,
        UsageTone::Stale => p.muted,
    };
    let label = quota_label(w);
    let help = format!(
        "Used {}, remaining {}.{}",
        format_percent(w.used_percent),
        format_percent(w.used_percent.map(|v| (100. - v.round()).max(0.))),
        if w.status == SnapshotStatus::Stale {
            " (Retaining last measured value; not updated in latest check.)"
        } else {
            ""
        }
    );
    div()
        .flex()
        .items_center()
        .gap(px(8.))
        .text_size(px(13.024))
        .child(
            div()
                .w(px(38.))
                .whitespace_nowrap()
                .flex_shrink_0()
                .text_color(p.muted)
                .child(label),
        )
        .when(unavailable, |el| {
            el.child(
                div()
                    .text_size(px(11.968))
                    .text_color(p.muted)
                    .child("not provided"),
            )
        })
        .when(!unavailable, |el| {
            el.child(segmented_gauge(
                w.used_percent.unwrap_or(0.) as f32,
                p.track,
                tone,
            ))
            .child(
                div()
                    .id(SharedString::from(format!("usage-{}", w.id)))
                    .w(px(38.))
                    .flex_shrink_0()
                    .text_right()
                    .font_weight(FontWeight::BOLD)
                    .text_color(tone)
                    .tooltip(move |_, cx| super::tooltip::tooltip(help.clone(), p, cx))
                    .child(format_percent(w.used_percent)),
            )
            .child(
                div()
                    .id(SharedString::from(format!("reset-{}", w.id)))
                    .w(px(56.))
                    .flex_shrink_0()
                    .overflow_hidden()
                    .text_ellipsis()
                    .text_right()
                    .text_size(px(12.672))
                    .text_color(p.muted)
                    .tooltip({
                        let text = w
                            .resets_at
                            .map(|t| {
                                format!(
                                    "Local reset time: {}.",
                                    t.with_timezone(&chrono::Local).format("%m/%d/%Y %-I:%M %p")
                                )
                            })
                            .unwrap_or_else(|| "Reset time not provided.".into());
                        move |_, cx| super::tooltip::tooltip(text.clone(), p, cx)
                    })
                    .child(super::animated_text::countdown(
                        format_reset_countdown(w.resets_at, now),
                        w,
                        p,
                        now,
                        reduced_motion,
                    )),
            )
        })
}

// Measure once, then divide the same physical extent. Child intrinsic widths must
// not participate in the five equal segments (Electron uses a CSS mask).
fn segments(width: f32, percent: f32) -> [(f32, f32, f32); 5] {
    let segment = ((width - 8.) / 5.).max(0.);
    let fill = width * percent.clamp(0., 100.) / 100.;
    std::array::from_fn(|i| {
        let x = i as f32 * (segment + 2.);
        (x, segment, (fill - x).clamp(0., segment))
    })
}
fn segmented_gauge(percent: f32, track: gpui::Rgba, tone: gpui::Rgba) -> impl IntoElement {
    gpui::canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            for (x, width, fill) in segments(bounds.size.width.into(), percent) {
                let rect = gpui::Bounds::new(
                    bounds.origin + gpui::point(px(x), px(0.)),
                    gpui::size(px(width), bounds.size.height),
                );
                window.paint_quad(gpui::fill(rect, track));
                if fill > 0. {
                    window.paint_quad(gpui::fill(
                        gpui::Bounds::new(rect.origin, gpui::size(px(fill), rect.size.height)),
                        tone,
                    ));
                }
            }
        },
    )
    .flex_1()
    .min_w(px(80.))
    .h(px(4.))
}
#[cfg(test)]
mod gauge_tests {
    use super::*;
    #[test]
    fn equal_segments_and_continuous_fill_at_fractional_widths() {
        for width in [80., 147.2, 201.5, 243.] {
            for percent in [0., 20., 42., 80., 100.] {
                let parts = segments(width, percent);
                for pair in parts.windows(2) {
                    assert_eq!(pair[0].1, pair[1].1);
                    assert!((pair[1].0 - pair[0].0 - pair[0].1 - 2.).abs() < 0.0001);
                }
                assert!((parts[4].0 + parts[4].1 - width).abs() < 0.0001);
                assert!(parts.iter().all(|(x, size, fill)| *fill >= 0.
                    && fill <= size
                    && (*fill == 0. || x + fill <= width * percent / 100. + 0.0001)));
            }
        }
    }
}
