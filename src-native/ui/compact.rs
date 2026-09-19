use super::{format::*, presentation::*, theme::Palette};
use crate::core::types::*;
use chrono::{DateTime, Utc};
use gpui::{
    div, prelude::*, px, relative, svg, Animation, AnimationExt, IntoElement, SharedString,
};
use std::collections::HashSet;

pub fn render_compact(
    providers: &[ProviderSnapshot],
    p: Palette,
    now: DateTime<Utc>,
    errors: &HashSet<ProviderId>,
    events: UiEvents,
    reduced_motion: bool,
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
            let incident = provider.service_status.as_ref().filter(|s| {
                matches!(
                    s.indicator,
                    ServiceHealthIndicator::Minor
                        | ServiceHealthIndicator::Major
                        | ServiceHealthIndicator::Critical
                )
            });
            let mut help = format!(
                "{}\n{}\nstatus: {}",
                provider_name(id),
                provider.account_label.as_deref().unwrap_or(""),
                status(provider, now)
            );
            if let Some(incident) = incident {
                help.push_str(&format!(
                    "\n⚠ {}\n{}",
                    incident
                        .incident_title
                        .as_deref()
                        .unwrap_or(&incident.description),
                    incident.status_page_url
                ));
            }
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
                                .child(brand_icon(id, p, incident.is_some(), reduced_motion)),
                        )
                        .child(if id == ProviderId::Codex {
                            unlimited_slot(p, reduced_motion).into_any_element()
                        } else {
                            slot(five, "5h", true, p, now, reduced_motion).into_any_element()
                        })
                        .child(slot(weekly, "7d", true, p, now, reduced_motion))
                        .child(slot(
                            fable,
                            "fable",
                            id == ProviderId::Claude,
                            p,
                            now,
                            reduced_motion,
                        )),
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

fn brand_icon(
    id: ProviderId,
    p: Palette,
    incident: bool,
    reduced_motion: bool,
) -> gpui::AnyElement {
    let icon = svg()
        .path(match id {
            ProviderId::Codex => "OpenAI",
            ProviderId::Claude => "Claude",
            ProviderId::Antigravity => "Antigravity",
        })
        .size(px(14.))
        .text_color(match id {
            ProviderId::Codex => p.text,
            ProviderId::Claude => gpui::rgb(0xd97757),
            ProviderId::Antigravity => gpui::rgb(0x72b7c9),
        });
    if !incident {
        return icon.into_any_element();
    }
    // 모션 감소에서는 경고를 계속 표시하여 장애가 가려지지 않게 한다.
    if reduced_motion {
        return div()
            .text_size(px(13.))
            .text_color(p.high)
            .child("⚠️")
            .into_any_element();
    }
    div()
        .relative()
        .w(px(14.))
        .h(px(18.))
        .child(icon.with_animation(
            "incident-brand",
            Animation::new(std::time::Duration::from_secs(3)).repeat(),
            |el, phase| el.opacity(1. - incident_opacity(phase)),
        ))
        .child(
            div()
                .absolute()
                .top_0()
                .left_0()
                .text_size(px(13.))
                .text_color(p.high)
                .child("⚠️")
                .with_animation(
                    "incident-warning",
                    Animation::new(std::time::Duration::from_secs(3)).repeat(),
                    |el, phase| el.opacity(incident_opacity(phase)),
                ),
        )
        .into_any_element()
}
fn incident_opacity(phase: f32) -> f32 {
    if phase < 0.45 {
        0.
    } else if phase < 0.5 {
        (phase - 0.45) / 0.05
    } else if phase < 0.95 {
        1.
    } else {
        (1. - phase) / 0.05
    }
}

// 사용자 확정 제품 규칙. snapshot의 미제공 값을 변조하지 않는다.
fn unlimited_slot(p: Palette, reduced_motion: bool) -> impl IntoElement {
    let light = p.background == gpui::rgb(0xf5f5f7);
    let rainbow = div().absolute().top_0().left_0().w(px(48.)).h(px(18.));
    let rainbow = if reduced_motion {
        rainbow.child(rounded_rainbow(0.)).into_any_element()
    } else {
        rainbow
            .with_animation(
                "codex-unlimited-flow",
                Animation::new(std::time::Duration::from_millis(3500)).repeat(),
                |el, delta| el.child(rounded_rainbow(delta)),
            )
            .into_any_element()
    };
    div()
        .id("codex-unlimited")
        .flex_1()
        .min_w_0()
        .flex()
        .items_center()
        .gap(px(4.))
        .tooltip(move |_, cx| {
            super::tooltip::tooltip("Codex has no 5h session limit (Unlimited)".into(), p, cx)
        })
        .child(
            div()
                .relative()
                .w(px(48.))
                .h(px(18.))
                .flex_shrink_0()
                .rounded(px(4.))
                .overflow_hidden()
                .child(rainbow)
                .child(
                    div()
                        .relative()
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(10.208))
                        .font_weight(gpui::FontWeight::BOLD)
                        .text_color(gpui::rgb(if light { 0x18181b } else { 0x0f1412 }))
                        .child("5H"),
                ),
        )
        .child(
            div()
                .w(px(28.))
                .flex_shrink_0()
                .text_right()
                .text_size(px(13.024))
                .text_color(p.muted)
                .child("--%"),
        )
        .child(
            div()
                .text_size(px(14.432))
                .font_weight(gpui::FontWeight::BOLD)
                .text_color(gpui::rgb(if light { 0x787880 } else { 0x9b9b9b }))
                .child("∞"),
        )
}
// overflow_hidden은 사각 마스크이므로 무지개 자체를 둥근 quad로 칠한다.
fn rounded_rainbow(phase: f32) -> impl IntoElement {
    gpui::canvas(
        |_, _, _| (),
        move |bounds, _, window, _| {
            let colors = [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93, 0xff595e];
            let step = 1. / window.scale_factor();
            let width = f32::from(bounds.size.width);
            let mut x = 0.;
            while x < width {
                let position = (x + step / 2. + 192. * phase) / 19.2;
                let index = position.floor() as usize % 5;
                let t = position.fract();
                let a = gpui::rgb(colors[index]);
                let b = gpui::rgb(colors[index + 1]);
                let color = gpui::Rgba {
                    r: a.r + (b.r - a.r) * t,
                    g: a.g + (b.g - a.g) * t,
                    b: a.b + (b.b - a.b) * t,
                    a: 1.,
                };
                let mask = gpui::ContentMask {
                    bounds: gpui::Bounds::new(
                        bounds.origin + gpui::point(px(x), px(0.)),
                        gpui::size(px(step.min(width - x)), bounds.size.height),
                    ),
                };
                window.with_content_mask(Some(mask), |window| {
                    let mut quad = gpui::fill(bounds, color);
                    quad.corner_radii = px(4.).into();
                    window.paint_quad(quad);
                });
                x += step;
            }
        },
    )
    .size_full()
}

fn slot(
    w: Option<&QuotaWindow>,
    label: &str,
    show: bool,
    p: Palette,
    now: DateTime<Utc>,
    reduced_motion: bool,
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
                            .rounded_l(px(4.))
                            .when(used.is_some_and(|v| v >= 100.), |el| el.rounded_r(px(4.)))
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
                    .child(if let Some(w) = w {
                        super::animated_text::countdown(text, w, p, now, reduced_motion)
                    } else {
                        div().child(text).into_any_element()
                    }),
            )
        })
}
