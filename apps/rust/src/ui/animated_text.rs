//! Electron presentation.ts / styles.css의 텍스트 색상과 애니메이션 주기.
use super::theme::Palette;
use crate::core::types::{QuotaKind, QuotaWindow, SnapshotStatus};
use chrono::{DateTime, Utc};
use gpui::{
    canvas, div, point, prelude::*, px, rgb, size, Animation, AnimationExt, AnyElement, Bounds,
    ContentMask, Rgba, SharedString,
};
use std::time::Duration;

#[derive(Clone)]
struct Effect {
    seconds: f32,
    stops: Vec<(f32, Rgba)>,
    background_size: f32,
    from: f32,
    to: f32,
}
impl Effect {
    fn color(&self, x: f32, phase: f32) -> Rgba {
        let position = self.from + (self.to - self.from) * phase;
        let t =
            ((x + position * (self.background_size - 1.)) / self.background_size).rem_euclid(1.);
        for pair in self.stops.windows(2) {
            if t <= pair[1].0 {
                let f = ((t - pair[0].0) / (pair[1].0 - pair[0].0)).clamp(0., 1.);
                let (a, b) = (pair[0].1, pair[1].1);
                return Rgba {
                    r: a.r + (b.r - a.r) * f,
                    g: a.g + (b.g - a.g) * f,
                    b: a.b + (b.b - a.b) * f,
                    a: 1.,
                };
            }
        }
        self.stops.last().unwrap().1
    }
}
fn countdown_effect(w: &QuotaWindow, p: Palette, now: DateTime<Utc>) -> Option<Effect> {
    if w.status != SnapshotStatus::Fresh || w.used_percent.is_none() {
        return None;
    }
    let remaining = (w.resets_at? - now).num_milliseconds() as f32 / 1000.;
    let five = w.kind == QuotaKind::FiveHour;
    let duration = if matches!(w.kind, QuotaKind::Weekly | QuotaKind::ModelWeekly) {
        604800.
    } else {
        18000.
    };
    let elapsed = ((duration - remaining) / duration * 100.).clamp(0., 100.);
    if elapsed >= 100. {
        return None;
    }
    let light = p.background == rgb(0xf5f5f7);
    let (seconds, stops) = if elapsed < 75. {
        let c = if light {
            [0x64748b, 0x334155, 0x0f172a]
        } else {
            [0x7c7c7c, 0x9e9e9e, 0xc4c4c4]
        };
        (
            if five { 5.5 } else { 8.5 },
            vec![
                (0., c[0]),
                (0.25, c[0]),
                (0.4, c[1]),
                (0.5, c[2]),
                (0.6, c[1]),
                (0.75, c[0]),
                (1., c[0]),
            ],
        )
    } else if elapsed < 88. {
        let end = elapsed.round() / 100.;
        let c = if light {
            [0x64748b, 0xb45309, 0x78350f, 0xd97706]
        } else {
            [0x707070, 0xffe9b8, 0xffffff, 0xe2b070]
        };
        (
            if five { 4.2 } else { 6. },
            vec![
                (0., c[0]),
                (end * 0.4, c[1]),
                (end - 0.04, c[2]),
                (end, c[3]),
                (end + 0.05, c[0]),
                (1., c[0]),
            ],
        )
    } else {
        let urgent = elapsed >= 98.;
        let colors = if urgent {
            [
                0xff1955, 0xff8c00, 0xffdc00, 0x00e678, 0x00dcff, 0x8c4bff, 0xff1955,
            ]
        } else if light {
            [
                0xc026d3, 0xea580c, 0xca8a04, 0x16a34a, 0x0284c7, 0x7c3aed, 0xc026d3,
            ]
        } else {
            [
                0xf49ac2, 0xfbb489, 0xfef3a3, 0xa8e6cf, 0xa0e0fc, 0xc3b1e1, 0xf49ac2,
            ]
        };
        let seconds = if urgent {
            if five {
                1.1
            } else {
                1.8
            }
        } else if five {
            2.5 - (elapsed - 88.) / 10. * 0.7
        } else {
            4.15 - (elapsed - 88.) / 10. * 1.05
        };
        (
            seconds,
            [0., 0.16, 0.33, 0.5, 0.66, 0.83, 1.]
                .into_iter()
                .zip(colors)
                .collect(),
        )
    };
    Some(Effect {
        seconds,
        stops: stops.into_iter().map(|(t, c)| (t, rgb(c))).collect(),
        background_size: 2.,
        from: if elapsed < 88. { 2. } else { 0. },
        to: if elapsed < 88. { -2. } else { 2. },
    })
}

pub fn countdown(
    text: String,
    w: &QuotaWindow,
    p: Palette,
    now: DateTime<Utc>,
    reduced: bool,
) -> AnyElement {
    animated(
        format!("countdown-{}", w.id),
        text,
        countdown_effect(w, p, now).filter(|_| !reduced),
    )
}
pub fn refresh(text: String, p: Palette, refreshing: bool, reduced: bool) -> AnyElement {
    let effect = (refreshing && !reduced).then(|| Effect {
        seconds: 1.8,
        stops: vec![
            (0., p.muted),
            (0.15, p.muted),
            (0.35, p.input),
            (0.52, p.output),
            (0.70, p.low),
            (0.82, p.text),
            (0.92, p.muted),
            (1., p.muted),
        ],
        background_size: 2.5,
        from: 1.,
        to: -1.5,
    });
    animated("refresh-shimmer".into(), text, effect)
}
fn animated(id: String, text: String, effect: Option<Effect>) -> AnyElement {
    let Some(effect) = effect else {
        return div().whitespace_nowrap().child(text).into_any_element();
    };
    let seconds = effect.seconds;
    // Invisible normal text preserves font metrics/layout. The overlay paints the
    // same shaped line through one-physical-pixel masks, including inside glyphs.
    div()
        .relative()
        .whitespace_nowrap()
        .child(div().opacity(0.).child(text.clone()))
        .with_animation(
            SharedString::from(id),
            Animation::new(Duration::from_secs_f32(seconds)).repeat(),
            move |el, phase| {
                let text: SharedString = text.clone().into();
                let effect = effect.clone();
                el.child(
                    canvas(
                        |_, _, _| (),
                        move |bounds, _, window, cx| {
                            let style = window.text_style();
                            let font_size = style.font_size.to_pixels(window.rem_size());
                            let width = f32::from(bounds.size.width);
                            if width <= 0. {
                                return;
                            }
                            let measured = window.text_system().shape_line(
                                text.clone(),
                                font_size,
                                &[style.to_run(text.len())],
                                None,
                            );
                            let offset = match style.text_align {
                                gpui::TextAlign::Right => bounds.size.width - measured.width,
                                gpui::TextAlign::Center => {
                                    (bounds.size.width - measured.width) / 2.
                                }
                                _ => px(0.),
                            };
                            let origin = bounds.origin + point(offset, px(0.));
                            let step = 1. / window.scale_factor();
                            let mut x = 0.;
                            while x < width {
                                let mut run = style.to_run(text.len());
                                run.color = effect.color((x + step / 2.) / width, phase).into();
                                let line = window.text_system().shape_line(
                                    text.clone(),
                                    font_size,
                                    &[run],
                                    None,
                                );
                                let mask = ContentMask {
                                    bounds: Bounds::new(
                                        bounds.origin + point(px(x), px(0.)),
                                        size(px(step.min(width - x)), bounds.size.height),
                                    ),
                                };
                                window.with_content_mask(Some(mask), |window| {
                                    let _ = line.paint(origin, bounds.size.height, window, cx);
                                });
                                x += step;
                            }
                        },
                    )
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full(),
                )
            },
        )
        .into_any_element()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn countdown_stages_and_missing_stale_expired_values() {
        let now = Utc::now();
        let p = super::super::theme::ThemeMode::Dark.palette(gpui::WindowAppearance::Dark);
        let mut w = QuotaWindow {
            id: "fixture".into(),
            kind: QuotaKind::FiveHour,
            label: "5h".into(),
            used_percent: Some(1.),
            resets_at: None,
            source: crate::core::types::ProviderSource::CodexAppServer,
            status: SnapshotStatus::Fresh,
        };
        assert!(countdown_effect(&w, p, now).is_none());
        for (elapsed, seconds) in [(0, 5.5), (75, 4.2), (88, 2.5), (98, 1.1)] {
            w.resets_at = Some(now + chrono::Duration::seconds(18000 * (100 - elapsed) / 100));
            assert!((countdown_effect(&w, p, now).unwrap().seconds - seconds).abs() < 0.001);
        }
        w.status = SnapshotStatus::Stale;
        assert!(countdown_effect(&w, p, now).is_none());
        w.status = SnapshotStatus::Fresh;
        w.resets_at = Some(now);
        assert!(countdown_effect(&w, p, now).is_none());
    }
}
