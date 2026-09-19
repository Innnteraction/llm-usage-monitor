use super::theme::Palette;
use gpui::{div, prelude::*, AnyView, App, Context, IntoElement, Render, Window};
struct Help {
    text: String,
    palette: Palette,
}
impl Render for Help {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .p_2()
            .max_w(gpui::px(320.))
            .rounded_md()
            .border_1()
            .bg(self.palette.surface)
            .border_color(self.palette.border)
            .text_color(self.palette.text)
            .text_xs()
            .child(self.text.clone())
    }
}
pub fn tooltip(text: String, palette: Palette, cx: &mut App) -> AnyView {
    cx.new(|_| Help { text, palette }).into()
}

struct ProviderHelp {
    provider: crate::core::types::ProviderSnapshot,
    palette: Palette,
    now: chrono::DateTime<chrono::Utc>,
    events: super::presentation::UiEvents,
}
impl Render for ProviderHelp {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        use super::presentation::{action_button, provider_name, status, UiAction};
        use crate::core::types::ServiceHealthIndicator;
        use gpui::{px, FontWeight};
        let p = self.palette;
        let provider = &self.provider;
        let incident = provider.service_status.as_ref().filter(|s| {
            matches!(
                s.indicator,
                ServiceHealthIndicator::Minor
                    | ServiceHealthIndicator::Major
                    | ServiceHealthIndicator::Critical
            )
        });
        div()
            .id("provider-help")
            .occlude()
            .p(px(8.))
            .min_w(px(126.))
            .max_w(px(240.))
            .rounded(px(4.))
            .bg(p.surface)
            .border_1()
            .border_color(p.border)
            .text_color(p.text)
            .font_family(if cfg!(target_os = "macos") {
                "SFMono-Regular"
            } else {
                "Cascadia Mono"
            })
            .flex()
            .flex_col()
            .gap(px(3.))
            .text_size(px(10.56))
            .child(
                div()
                    .font_weight(FontWeight::BOLD)
                    .text_size(px(11.264))
                    .child(provider_name(provider.provider_id)),
            )
            .children(incident.map(|s| {
                let url = s.status_page_url.clone();
                div()
                    .mt(px(4.))
                    .mb(px(2.))
                    .py(px(5.))
                    .px(px(6.))
                    .rounded(px(4.))
                    .border_1()
                    .bg(gpui::rgba(0xd2a95f24))
                    .border_color(gpui::rgba(0xd2a95f59))
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(
                        div()
                            .font_weight(FontWeight::BOLD)
                            .text_color(p.medium)
                            .text_size(px(11.44))
                            .line_height(gpui::relative(1.2))
                            .child(if s.indicator == ServiceHealthIndicator::Critical {
                                "⚠️ Service Outage"
                            } else {
                                "⚠️ Service Degraded"
                            }),
                    )
                    .children(s.incident_title.as_ref().map(|title| {
                        div()
                            .max_w(px(170.))
                            .truncate()
                            .text_size(px(10.208))
                            .line_height(gpui::relative(1.25))
                            .child(title.clone())
                    }))
                    .child(
                        action_button(
                            "incident-link",
                            UiAction::OpenUrl(url.clone()),
                            self.events.clone(),
                        )
                        .mt(px(3.))
                        .py(px(3.))
                        .px(px(6.))
                        .w_full()
                        .text_center()
                        .text_size(px(10.56))
                        .font_weight(FontWeight::SEMIBOLD)
                        .bg(gpui::rgba(0xd2a95f2e))
                        .border_1()
                        .border_color(gpui::rgba(0xd2a95f66))
                        .rounded(px(3.))
                        .hover(|s| {
                            s.bg(gpui::rgba(0xd2a95f59))
                                .border_color(gpui::rgba(0xd2a95fa6))
                                .text_color(gpui::rgb(0xffffff))
                        })
                        .child("상태 확인 [Status ↗]"),
                    )
            }))
            .children(provider.account_label.as_ref().map(|account| {
                div()
                    .text_color(p.muted)
                    .text_size(px(9.856))
                    .child(account.clone())
            }))
            .child(
                div()
                    .text_color(p.muted)
                    .text_size(px(9.856))
                    .child(format!("status: {}", status(provider, self.now))),
            )
    }
}
pub fn provider_tooltip(
    provider: crate::core::types::ProviderSnapshot,
    palette: Palette,
    now: chrono::DateTime<chrono::Utc>,
    events: super::presentation::UiEvents,
    cx: &mut App,
) -> AnyView {
    cx.new(|_| ProviderHelp {
        provider,
        palette,
        now,
        events,
    })
    .into()
}
