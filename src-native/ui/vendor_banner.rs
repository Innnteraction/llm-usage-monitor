use super::{presentation::provider_name, theme::Palette};
use crate::core::types::{ProviderSnapshot, ServiceHealthIndicator};
use gpui::{div, prelude::*, px, IntoElement};
pub fn render_vendor_health_banner(providers: &[ProviderSnapshot], p: Palette) -> impl IntoElement {
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
                })
        }))
}
