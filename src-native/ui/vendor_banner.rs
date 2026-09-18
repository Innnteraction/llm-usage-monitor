use gpui::{
    div, rgb, FontWeight, IntoElement, ParentElement, Styled,
};
use crate::core::types::{ProviderSnapshot, ServiceHealthIndicator};

pub fn render_vendor_health_banner(providers: &[ProviderSnapshot]) -> impl IntoElement {
    let mut incidents = Vec::new();

    for provider in providers {
        if let Some(ref st) = provider.service_status {
            if st.indicator != ServiceHealthIndicator::Operational {
                incidents.push((provider.provider_id.as_str(), st));
            }
        }
    }

    if incidents.is_empty() {
        // All Systems Operational
        div()
            .flex()
            .items_center()
            .gap_2()
            .py_1()
            .px_2()
            .rounded_md()
            .bg(rgb(0x18181b))
            .border_1()
            .border_color(rgb(0x27272a))
            .child(
                div()
                    .size_2()
                    .rounded_full()
                    .bg(rgb(0x22c55e)), // green-500
            )
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(0x71717a))
                    .child("Anthropic, OpenAI, Google: All Systems Operational"),
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
                            .child(
                                div()
                                    .size_2()
                                    .rounded_full()
                                    .bg(rgb(0xf59e0b)),
                            )
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
