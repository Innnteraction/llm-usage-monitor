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
