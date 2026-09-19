use gpui::{AssetSource, SharedString};
use std::borrow::Cow;
pub struct Icons;
impl AssetSource for Icons {
    fn load(&self, path: &str) -> anyhow::Result<Option<Cow<'static, [u8]>>> {
        Ok(match path {
            "AddSquare" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/AddSquare.svg"
            ))),
            "Antigravity" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Antigravity.svg"
            ))),
            "Claude" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Claude.svg"
            ))),
            "Help-filled" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Help-filled.svg"
            ))),
            "Help" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Help.svg"
            ))),
            "MinusSquare" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/MinusSquare.svg"
            ))),
            "Moon-filled" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Moon-filled.svg"
            ))),
            "Moon" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Moon.svg"
            ))),
            "OpenAI" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/OpenAI.svg"
            ))),
            "Pin-filled" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Pin-filled.svg"
            ))),
            "Pin" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Pin.svg"
            ))),
            "Sun-filled" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Sun-filled.svg"
            ))),
            "Sun" => Some(Cow::Borrowed(include_bytes!(
                "../../assets/native-icons/Sun.svg"
            ))),
            _ => None,
        })
    }
    fn list(&self, _: &str) -> anyhow::Result<Vec<SharedString>> {
        Ok(vec![])
    }
}

/// SVG silhouettes approximate the reference's subpixel drop-shadow; unlike a
/// box shadow they follow the icon strokes. Active/hover states use full text ink.
pub fn header_icon(
    path: &'static str,
    active: bool,
    p: super::theme::Palette,
) -> impl gpui::IntoElement {
    use gpui::{prelude::*, *};
    div()
        .group("header-icon")
        .relative()
        .size(px(16.))
        .text_color(if active { p.text } else { p.muted })
        .opacity(if active { 1. } else { 0.55 })
        .hover(move |s| s.text_color(p.text).opacity(1.))
        .children(
            [
                (-0.6, 0.),
                (0.6, 0.),
                (0., -0.6),
                (0., 0.6),
                (-0.4, -0.4),
                (0.4, 0.4),
                (-0.4, 0.4),
                (0.4, -0.4),
            ]
            .into_iter()
            .map(move |(x, y)| {
                svg()
                    .path(path)
                    .text_color(p.text)
                    .absolute()
                    .left(px(x))
                    .top(px(y))
                    .size_full()
                    .opacity(if active { 0.16 } else { 0. })
                    .group_hover("header-icon", |s| s.opacity(0.16))
            }),
        )
        .child(
            svg()
                .path(path)
                .text_color(if active { p.text } else { p.muted })
                .group_hover("header-icon", move |s| s.text_color(p.text))
                .relative()
                .size_full(),
        )
}
