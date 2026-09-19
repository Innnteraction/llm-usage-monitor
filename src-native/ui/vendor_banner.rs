use super::{
    presentation::{provider_name, UiAction, UiEvents},
    theme::Palette,
};
use crate::core::types::{ProviderSnapshot, ServiceHealthIndicator};
use gpui::{div, prelude::*, px, IntoElement};
pub fn render_vendor_health_banner(
    providers: &[ProviderSnapshot],
    p: Palette,
    events: UiEvents,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap(px(4.))
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
                    div()
                        .text_size(px(11.968))
                        .text_color(p.medium)
                        .child(format!(
                            "⚠️ {} {}",
                            provider_name(provider.provider_id),
                            s.incident_title.as_deref().unwrap_or(&s.description)
                        ))
                        .child(
                            div()
                                .id(gpui::SharedString::from(format!(
                                    "status-link-{}",
                                    provider.provider_id.as_str()
                                )))
                                .cursor_pointer()
                                .child("[Status ↗]")
                                .on_click({
                                    let events = events.clone();
                                    let url = s.status_page_url.clone();
                                    move |_, window, cx| {
                                        events(UiAction::OpenUrl(url.clone()), window, cx)
                                    }
                                }),
                        )
                })
        }))
}
