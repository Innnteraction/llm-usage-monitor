use super::{format::format_token_count, theme::Palette};
use crate::core::types::LocalTokenUsage;
use gpui::{div, prelude::*, px, IntoElement};
pub fn render_usage(u: &LocalTokenUsage, p: Palette) -> impl IntoElement {
    let count = |v: Option<u64>| v.map(format_token_count).unwrap_or_else(|| "--".into());
    div()
        .flex()
        .flex_col()
        .text_color(p.muted)
        .when(u.scanned_file_count == 0 && !u.partial, |el| {
            el.child("this PC no local logs")
        })
        .when(u.scanned_file_count > 0 || u.partial, |el| {
            el.child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_x(px(7.))
                    .child("this PC")
                    .child(format!("total {}", format_token_count(u.total_tokens)))
                    .child(format!(
                        "since {}",
                        u.observed_from
                            .map(|t| t
                                .with_timezone(&chrono::Local)
                                .format("%-m/%-d")
                                .to_string())
                            .unwrap_or_else(|| "unavailable".into())
                    ))
                    .children(u.partial.then(|| {
                        div()
                            .text_color(p.medium)
                            .child(format!("partial {}", u.failed_file_count))
                    })),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_x(px(7.))
                    .child(format!("input {}", format_token_count(u.input_tokens)))
                    .child(format!("output {}", format_token_count(u.output_tokens)))
                    .child(format!("cache read {}", count(u.cache_read_tokens)))
                    .child(format!("cache write {}", count(u.cache_write_tokens))),
            )
        })
}
