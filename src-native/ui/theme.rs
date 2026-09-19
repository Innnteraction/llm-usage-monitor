use gpui::{rgb, Rgba, WindowAppearance};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}
impl ThemeMode {
    pub fn next(self, appearance: WindowAppearance) -> Self {
        match self {
            Self::System => {
                if matches!(
                    appearance,
                    WindowAppearance::Dark | WindowAppearance::VibrantDark
                ) {
                    Self::Light
                } else {
                    Self::Dark
                }
            }
            Self::Light => Self::Dark,
            Self::Dark => Self::Light,
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
                background: rgb(0x101010),
                surface: rgb(0x101010),
                border: rgb(0x858585),
                text: rgb(0xe0e0e0),
                muted: rgb(0xa5a5a5),
                low: rgb(0x80ae88),
                medium: rgb(0xd2a95f),
                high: rgb(0xdf6269),
                track: rgb(0x3b3b3b),
            }
        } else {
            Palette {
                background: rgb(0xf5f5f7),
                surface: rgb(0xf5f5f7),
                border: rgb(0xd8d8de),
                text: rgb(0x1d1d1f),
                muted: rgb(0x5e5e64),
                low: rgb(0x15803d),
                medium: rgb(0xb45309),
                high: rgb(0xdc2626),
                track: rgb(0xd8d8de),
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
    pub low: Rgba,
    pub medium: Rgba,
    pub high: Rgba,
    pub track: Rgba,
}
