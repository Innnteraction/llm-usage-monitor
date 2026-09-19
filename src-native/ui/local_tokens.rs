use super::format::format_token_count;
use super::theme::Palette;
use crate::core::types::{ProviderId, ProviderSnapshot};
use gpui::{div, rgb, FontWeight, IntoElement, ParentElement, Styled};

pub fn render_local_tokens_card(
    providers: &[ProviderSnapshot],
    palette: Palette,
) -> impl IntoElement {
    let mut total_tokens = 0u64;
    let mut total_files = 0u64;

    let mut codex_tokens = 0u64;
    let mut claude_tokens = 0u64;

    for p in providers {
        if let Some(ref usage) = p.local_usage {
            total_tokens += usage.total_tokens;
            total_files += usage.scanned_file_count;

            match p.provider_id {
                ProviderId::Codex => codex_tokens += usage.total_tokens,
                ProviderId::Claude => claude_tokens += usage.total_tokens,
                _ => {}
            }
        }
    }

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
                        .text_xs()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(palette.muted)
                        .child("💻 로컬 토큰 집계 (Local Token Usage)"),
                )
                .child(
                    div()
                        .text_xs()
                        .text_color(palette.muted)
                        .child(format!("{}개 세션 파일 스캔됨", total_files)),
                ),
        )
        .children(
            providers
                .iter()
                .filter(|p| p.local_usage.as_ref().is_some_and(|u| u.partial))
                .map(|p| {
                    div()
                        .text_xs()
                        .text_color(palette.muted)
                        .child(format!("{}: 일부 파일 집계 실패", p.provider_id.as_str()))
                }),
        )
        .child(
            div()
                .text_xs()
                .text_color(palette.muted)
                .child("이 PC의 로그 합계 · 계정 쿼터와 별개"),
        )
        // Token Counts Grid
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .pt_1()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_xs()
                                .text_color(palette.muted)
                                .child("Claude 누적 토큰"),
                        )
                        .child(
                            div()
                                .text_base()
                                .font_weight(FontWeight::BOLD)
                                .text_color(rgb(0x38bdf8)) // sky-400
                                .child(format_token_count(claude_tokens)),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_xs()
                                .text_color(palette.muted)
                                .child("Codex 누적 토큰"),
                        )
                        .child(
                            div()
                                .text_base()
                                .font_weight(FontWeight::BOLD)
                                .text_color(rgb(0xa78bfa)) // purple-400
                                .child(format_token_count(codex_tokens)),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_end()
                        .child(
                            div()
                                .text_xs()
                                .text_color(palette.muted)
                                .child("전체 누적 합계"),
                        )
                        .child(
                            div()
                                .text_base()
                                .font_weight(FontWeight::BOLD)
                                .text_color(rgb(0x4ade80)) // green-400
                                .child(format_token_count(total_tokens)),
                        ),
                ),
        )
}
