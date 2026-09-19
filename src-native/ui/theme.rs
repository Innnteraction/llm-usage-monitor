use gpui::{rgb, Rgba, WindowAppearance};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}
impl ThemeMode {
    pub fn next(self) -> Self {
        match self {
            Self::System => Self::Light,
            Self::Light => Self::Dark,
            Self::Dark => Self::System,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::System => "시스템",
            Self::Light => "라이트",
            Self::Dark => "다크",
        }
    }
    pub fn palette(self, appearance: WindowAppearance) -> Palette {
        let dark = match self {
            Self::Dark => true,
            Self::Light => false,
            Self::System => matches!(
                appearance,
                WindowAppearance::Dark | WindowAppearance::VibrantDark
            ),
        };
        if dark {
            Palette {
                background: rgb(0x18181b),
                surface: rgb(0x27272a),
                border: rgb(0x3f3f46),
                text: rgb(0xf4f4f5),
                muted: rgb(0xa1a1aa),
            }
        } else {
            Palette {
                background: rgb(0xfafafa),
                surface: rgb(0xffffff),
                border: rgb(0xd4d4d8),
                text: rgb(0x18181b),
                muted: rgb(0x52525b),
            }
        }
    }
}
#[derive(Clone, Copy)]
pub struct Palette {
    pub background: Rgba,
    pub surface: Rgba,
    pub border: Rgba,
    pub text: Rgba,
    pub muted: Rgba,
}
