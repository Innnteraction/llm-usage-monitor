use super::theme::Palette;
use crate::core::types::{ProviderSnapshot, ServiceHealthIndicator};
use gpui::{div, rgb, FontWeight, IntoElement, ParentElement, Styled};

pub fn render_vendor_health_banner(
    providers: &[ProviderSnapshot],
    palette: Palette,
) -> impl IntoElement {
    let mut incidents = Vec::new();

    for provider in providers {
        if let Some(ref st) = provider.service_status {
            if st.indicator != ServiceHealthIndicator::Operational {
                incidents.push((provider.provider_id.as_str(), st));
            }
        }
    }

    let confirmed = providers.len() == 3
        && providers.iter().all(|p| {
            p.service_status
                .as_ref()
                .is_some_and(|s| s.indicator == ServiceHealthIndicator::Operational)
        });
    if incidents.is_empty() {
        // All Systems Operational
        div()
            .flex()
            .items_center()
            .gap_2()
            .py_1()
            .px_2()
            .rounded_md()
            .bg(palette.background)
            .border_1()
            .border_color(palette.surface)
            .child(
                div().size_2().rounded_full().bg(if confirmed {
                    rgb(0x22c55e)
                } else {
                    palette.muted
                }), // green-500
            )
            .child(
                div()
                    .text_xs()
                    .text_color(palette.muted)
                    .child(if confirmed {
                        "모든 벤더 서비스 정상"
                    } else {
                        "벤더 서비스 상태 미확인"
                    }),
            )
    } else {
        // Incident Warning Banner
        div()
            .flex()
            .flex_col()
            .gap_1()
            .p_2()
            .rounded_md()
            .bg(rgb(0x451a03)) // amber-950
            .border_1()
            .border_color(rgb(0xb45309)) // amber-700
            .children(incidents.into_iter().map(|(vendor, st)| {
                let incident_text = st.incident_title.as_deref().unwrap_or(&st.description);
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .text_xs()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(div().size_2().rounded_full().bg(rgb(0xf59e0b)))
                            .child(
                                div()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(rgb(0xfef3c7))
                                    .child(format!("⚠️ {vendor}:")),
                            )
                            .child(
                                div()
                                    .text_color(rgb(0xfde68a))
                                    .child(incident_text.to_string()),
                            ),
                    )
            }))
    }
}
