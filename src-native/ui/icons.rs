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
