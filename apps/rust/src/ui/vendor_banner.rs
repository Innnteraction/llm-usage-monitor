use super::{
    presentation::{action_button, provider_name, UiAction, UiEvents},
    theme::Palette,
};
use crate::core::types::{ProviderSnapshot, ServiceHealthIndicator};
use gpui::{div, prelude::*, px, FontWeight, IntoElement, SharedString};
pub fn render_vendor_health_banner(
    providers: &[ProviderSnapshot],
    p: Palette,
    events: UiEvents,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .mt(px(6.))
        .mb(px(2.))
        .py(px(5.))
        .px(px(8.))
        .bg(gpui::rgba(0xd2a95f1f))
        .border_1()
        .border_color(gpui::rgba(0xd2a95f59))
        .rounded(px(4.))
        .text_size(px(12.32))
        .line_height(gpui::relative(1.3))
        .children(providers.iter().filter_map(|provider| {
            provider
                .service_status
                .as_ref()
                .filter(|s| {
                    matches!(
                        s.indicator,
                        ServiceHealthIndicator::Minor
                            | ServiceHealthIndicator::Major
                            | ServiceHealthIndicator::Critical
                    )
                })
                .map(|s| {
                    let url = s.status_page_url.clone();
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .text_color(p.medium)
                        .child(div().flex_shrink_0().text_size(px(14.08)).child("⚠️"))
                        .child(
                            div()
                                .flex()
                                .flex_1()
                                .min_w_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .gap(px(4.))
                                .child(
                                    div()
                                        .flex_shrink_0()
                                        .font_weight(FontWeight::BOLD)
                                        .text_color(p.text)
                                        .child(provider_name(provider.provider_id)),
                                )
                                .child(
                                    div().min_w_0().truncate().child(
                                        s.incident_title
                                            .as_deref()
                                            .unwrap_or(&s.description)
                                            .to_owned(),
                                    ),
                                ),
                        )
                        .child(
                            action_button(
                                SharedString::from(format!(
                                    "status-link-{}",
                                    provider.provider_id.as_str()
                                )),
                                UiAction::OpenUrl(url.clone()),
                                events.clone(),
                            )
                            .flex_shrink_0()
                            .px(px(4.))
                            .text_size(px(11.968))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(p.input)
                            .underline()
                            .hover(move |s| s.text_color(p.text))
                            .tooltip(move |_, cx| super::tooltip::tooltip(url.clone(), p, cx))
                            .child("[Status ↗]"),
                        )
                })
        }))
}
