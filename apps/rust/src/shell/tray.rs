use anyhow::{Context, Result};
use muda::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

pub struct SystemTrayManager {
    _tray_icon: TrayIcon,
    pub open_id: muda::MenuId,
    pub refresh_id: muda::MenuId,
    pub reset_pos_id: muda::MenuId,
    pub quit_id: muda::MenuId,
    pub launch_item: CheckMenuItem,
    pub interval_items: Vec<(u64, CheckMenuItem)>,
    pub pause_when_hidden_item: CheckMenuItem,
}

pub fn load_tray_icon() -> Result<Icon> {
    let png_bytes = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets/icons/tray-icon.png"));
    let img =
        image::load_from_memory(png_bytes).context("Failed to decode embedded tray-icon.png")?;
    let rgba = img.into_rgba8();
    let (width, height) = rgba.dimensions();
    Icon::from_rgba(rgba.into_raw(), width, height)
        .context("Failed to create tray Icon from rgba buffer")
}

impl SystemTrayManager {
    pub fn bounds(&self) -> Option<super::position::WindowRect> {
        self._tray_icon.rect().map(|rect| {
            super::position::WindowRect::new(
                rect.position.x as f32,
                rect.position.y as f32,
                rect.size.width as f32,
                rect.size.height as f32,
            )
        })
    }

    pub fn set_interval_checked(&self, minutes: u64) {
        for (item_minutes, item) in &self.interval_items {
            item.set_checked(*item_minutes == minutes);
        }
    }

    pub fn new(initial_interval_minutes: u64, initial_pause_when_hidden: bool) -> Result<Self> {
        let tray_menu = Menu::new();

        // 1. 비활성 헤더 라벨
        let header = MenuItem::new("LLM Usage Monitor v0.14.0", false, None);
        let _ = tray_menu.append(&header);
        let _ = tray_menu.append(&PredefinedMenuItem::separator());

        // 2. 열기
        let open_item = MenuItem::new("Open", true, None);
        let open_id = open_item.id().clone();
        let _ = tray_menu.append(&open_item);

        // 3. 새로고침
        let refresh_item = MenuItem::new("Refresh", true, None);
        let refresh_id = refresh_item.id().clone();
        let _ = tray_menu.append(&refresh_item);

        // 3-1. 업데이트 주기 서브메뉴 (1~10분)
        let interval_submenu = Submenu::new("Update interval", true);
        let mut interval_items = Vec::with_capacity(10);
        for minutes in 1_u64..=10_u64 {
            let item = CheckMenuItem::new(
                format!("{minutes} min"),
                true,
                minutes == initial_interval_minutes,
                None,
            );
            let _ = interval_submenu.append(&item);
            interval_items.push((minutes, item));
        }
        let _ = tray_menu.append(&interval_submenu);

        // 3-2. 숨김 시 추적 중단 토글
        let pause_when_hidden_item = CheckMenuItem::new(
            "Pause when hidden",
            true,
            initial_pause_when_hidden,
            None,
        );
        let _ = tray_menu.append(&pause_when_hidden_item);

        // 4. 위치 초기화
        let reset_pos_item = MenuItem::new("Reset Position", true, None);
        let reset_pos_id = reset_pos_item.id().clone();
        let _ = tray_menu.append(&reset_pos_item);

        let launch_item = CheckMenuItem::new(
            if cfg!(target_os = "windows") {
                "Start on Windows login"
            } else {
                "Start at login"
            },
            true,
            false,
            None,
        );
        let _ = tray_menu.append(&launch_item);
        // 5. 구분선 & 종료
        let _ = tray_menu.append(&PredefinedMenuItem::separator());
        let quit_item = MenuItem::new("Quit", true, None);
        let quit_id = quit_item.id().clone();
        let _ = tray_menu.append(&quit_item);

        let icon = load_tray_icon().context("Failed to load embedded tray icon")?;

        let tray_icon = TrayIconBuilder::new()
            .with_menu(Box::new(tray_menu))
            .with_menu_on_left_click(false)
            .with_icon_as_template(cfg!(target_os = "macos"))
            .with_tooltip("LLM Usage Monitor")
            .with_icon(icon)
            .build()
            .context("Failed to build tray icon")?;

        Ok(Self {
            _tray_icon: tray_icon,
            open_id,
            refresh_id,
            reset_pos_id,
            quit_id,
            launch_item,
            interval_items,
            pause_when_hidden_item,
        })
    }
}
