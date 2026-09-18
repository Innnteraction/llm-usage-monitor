use gpui::{
    point, px, rgb, size, App, Application, Bounds, Context, FontWeight,
    IntoElement, ParentElement, Render, SharedString, Window,
    WindowBackgroundAppearance, WindowBounds, WindowHandle, WindowKind, WindowOptions, div,
    prelude::*,
};
use llm_usage_monitor_core::core::engine::UsageMonitorEngine;
use llm_usage_monitor_core::core::types::AppSnapshot;
use llm_usage_monitor_core::shell::position::{
    calculate_popover_position, Point as PosPoint, WindowRect, WindowSize,
};
use llm_usage_monitor_core::shell::tray::SystemTrayManager;
use llm_usage_monitor_core::ui::{
    local_tokens::render_local_tokens_card,
    quota_card::render_quota_card,
    vendor_banner::render_vendor_health_banner,
};
use muda::MenuEvent;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tray_icon::TrayIconEvent;

const WINDOW_WIDTH: f32 = 400.0;
const WINDOW_HEIGHT: f32 = 640.0;

struct AppState {
    window_handle: Option<WindowHandle<PopoverView>>,
    pinned: bool,
    snapshot: Option<AppSnapshot>,
    refreshing: bool,
}

struct PopoverView {
    state: Arc<Mutex<AppState>>,
    title: SharedString,
}

impl PopoverView {
    pub fn new(state: Arc<Mutex<AppState>>) -> Self {
        Self {
            state,
            title: "LLM Usage Monitor".into(),
        }
    }
}

impl Render for PopoverView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let (is_pinned, snapshot, is_refreshing) = {
            let guard = self.state.lock().unwrap();
            (guard.pinned, guard.snapshot.clone(), guard.refreshing)
        };

        div()
            .flex()
            .flex_col()
            .size_full()
            .bg(rgb(0x18181b)) // zinc-900
            .text_color(rgb(0xf4f4f5)) // zinc-100
            .rounded_xl()
            .border_1()
            .border_color(rgb(0x27272a)) // zinc-800
            .shadow_xl()
            .p_4()
            .gap_3()
            // Header
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .pb_2()
                    .border_b_1()
                    .border_color(rgb(0x27272a))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .size_3()
                                    .rounded_full()
                                    .bg(if is_refreshing { rgb(0x38bdf8) } else { rgb(0x22c55e) }),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::BOLD)
                                    .child(self.title.clone()),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .px_1()
                                    .rounded_sm()
                                    .bg(rgb(0x27272a))
                                    .text_color(rgb(0xa1a1aa))
                                    .child("GPUI Native"),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .id("pin-btn")
                                    .px_2()
                                    .py_1()
                                    .rounded_md()
                                    .text_xs()
                                    .cursor_pointer()
                                    .bg(if is_pinned { rgb(0x3f3f46) } else { rgb(0x27272a) })
                                    .child(if is_pinned { "📌 Pinned" } else { "📍 Pin" })
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        let mut guard = this.state.lock().unwrap();
                                        guard.pinned = !guard.pinned;
                                        cx.notify();
                                    })),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(0x71717a))
                                    .child("v0.12.0"),
                            ),
                    ),
            )
            // Scrollable Content
            .child(
                div()
                    .id("popover-content-scroll")
                    .flex()
                    .flex_col()
                    .gap_3()
                    .overflow_y_scroll()
                    .children(
                        if let Some(snap) = snapshot {
                            vec![
                                // 1. Vendor Health Banner
                                render_vendor_health_banner(&snap.providers).into_any_element(),
                                // 2. Provider Quota Cards
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_2()
                                    .children(
                                        snap.providers.iter().map(|provider| {
                                            render_quota_card(provider).into_any_element()
                                        })
                                    )
                                    .into_any_element(),
                                // 3. Local Tokens Card
                                render_local_tokens_card(&snap.providers).into_any_element(),
                            ]
                        } else {
                            vec![
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .p_8()
                                    .text_sm()
                                    .text_color(rgb(0xa1a1aa))
                                    .child("⏳ 쿼터 및 사용량 데이터를 수집하고 있습니다...")
                                    .into_any_element()
                            ]
                        }
                    ),
            )
    }
}

fn open_or_focus_popover(
    state: Arc<Mutex<AppState>>,
    cx: &mut App,
) {
    let mut guard = state.lock().unwrap();

    // 1. 이미 열려 있으면 닫기 (토글)
    if let Some(handle) = guard.window_handle {
        handle.update(cx, |_, window, _| {
            window.remove_window();
        }).ok();
        guard.window_handle = None;
        return;
    }

    // 2. 주 모니터 작업 영역 기반으로 트레이 위치 계산
    let displays = cx.displays();
    let primary_display = displays.first().cloned();

    let (display_id, work_area) = if let Some(ref disp) = primary_display {
        let b = disp.bounds();
        (
            Some(disp.id()),
            WindowRect::new(
                f32::from(b.origin.x),
                f32::from(b.origin.y),
                f32::from(b.size.width),
                f32::from(b.size.height),
            ),
        )
    } else {
        (
            None,
            WindowRect::new(0.0, 0.0, 1920.0, 1080.0),
        )
    };

    // 기본 앵커: 작업표시줄 하단 오른쪽 (Windows 기본 트레이 위치)
    let anchor = PosPoint::new(
        work_area.x + work_area.width - 140.0,
        work_area.y + work_area.height,
    );

    let window_size = WindowSize::new(WINDOW_WIDTH, WINDOW_HEIGHT);
    let target_pos = calculate_popover_position(anchor, work_area, window_size);

    let window_bounds = Bounds {
        origin: point(px(target_pos.x), px(target_pos.y)),
        size: size(px(WINDOW_WIDTH), px(WINDOW_HEIGHT)),
    };

    let window_options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(window_bounds)),
        display_id,
        titlebar: None,
        window_background: WindowBackgroundAppearance::Transparent,
        focus: true,
        show: true,
        kind: WindowKind::PopUp,
        is_movable: false,
        ..Default::default()
    };

    let state_clone = Arc::clone(&state);
    let state_blur = Arc::clone(&state);

    let handle = cx.open_window(window_options, move |window, cx| {
        cx.new(|cx| {
            // Blur(외부 클릭) 감지하여 닫기
            cx.observe_window_activation(window, move |_, window, _| {
                if !window.is_window_active() {
                    let guard = state_blur.lock().unwrap();
                    if !guard.pinned {
                        window.remove_window();
                    }
                }
            }).detach();

            PopoverView::new(state_clone)
        })
    });

    if let Ok(handle) = handle {
        guard.window_handle = Some(handle);
    }
}

async fn trigger_collection(
    state: Arc<Mutex<AppState>>,
    engine: Arc<UsageMonitorEngine>,
    async_cx: &gpui::AsyncApp,
) {
    {
        let mut guard = state.lock().unwrap();
        guard.refreshing = true;
    }
    let _ = async_cx.refresh();

    let snapshot = engine.fetch_all_snapshots().await;

    {
        let mut guard = state.lock().unwrap();
        guard.snapshot = Some(snapshot);
        guard.refreshing = false;
    }
    let _ = async_cx.refresh();
}

fn main() {
    Application::new().run(|cx: &mut App| {
        let state = Arc::new(Mutex::new(AppState {
            window_handle: None,
            pinned: false,
            snapshot: None,
            refreshing: false,
        }));

        // 데이터 디렉토리 및 수집 엔진 초기화
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("llm-usage-monitor");
        let _ = std::fs::create_dir_all(&data_dir);
        let engine = Arc::new(UsageMonitorEngine::new(data_dir));

        // 1. 시스템 트레이 초기화
        let tray_manager = match SystemTrayManager::new() {
            Ok(mgr) => mgr,
            Err(e) => {
                eprintln!("Failed to initialize system tray: {e:?}");
                return;
            }
        };

        let open_id = tray_manager.open_id.clone();
        let refresh_id = tray_manager.refresh_id.clone();
        let reset_pos_id = tray_manager.reset_pos_id.clone();
        let quit_id = tray_manager.quit_id.clone();

        // 2. 초기 팝오버 표시
        open_or_focus_popover(Arc::clone(&state), cx);

        // 3. 비동기 백그라운드 수집 및 트레이 이벤트 루프
        let state_events = Arc::clone(&state);
        let engine_events = Arc::clone(&engine);
        let async_cx = cx.to_async();

        cx.foreground_executor().spawn(async move {
            let state = state_events;
            let engine = engine_events;
            let tray_channel = TrayIconEvent::receiver();
            let menu_channel = MenuEvent::receiver();

            // 최초 1회 즉시 데이터 수집
            trigger_collection(Arc::clone(&state), Arc::clone(&engine), &async_cx).await;

            let mut last_poll = tokio::time::Instant::now();
            let poll_interval = Duration::from_secs(60);

            loop {
                // 주기적 자동 수집 (60초 주기)
                if last_poll.elapsed() >= poll_interval {
                    trigger_collection(Arc::clone(&state), Arc::clone(&engine), &async_cx).await;
                    last_poll = tokio::time::Instant::now();
                }

                // 트레이 클릭
                if let Ok(event) = tray_channel.try_recv() {
                    match event {
                        TrayIconEvent::Click { button, button_state, .. } => {
                            if button == tray_icon::MouseButton::Left
                                && button_state == tray_icon::MouseButtonState::Up
                            {
                                let state_clone = Arc::clone(&state);
                                let _ = async_cx.update(move |cx| {
                                    open_or_focus_popover(state_clone, cx);
                                });
                            }
                        }
                        _ => {}
                    }
                }

                // 메뉴 클릭
                if let Ok(event) = menu_channel.try_recv() {
                    if event.id == quit_id {
                        let _ = async_cx.update(|cx| {
                            cx.quit();
                        });
                        break;
                    } else if event.id == open_id {
                        let state_clone = Arc::clone(&state);
                        let _ = async_cx.update(move |cx| {
                            open_or_focus_popover(state_clone, cx);
                        });
                    } else if event.id == refresh_id {
                        trigger_collection(Arc::clone(&state), Arc::clone(&engine), &async_cx).await;
                    } else if event.id == reset_pos_id {
                        println!("Tray: Reset position requested");
                    }
                }

                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }).detach();

        // 트레이 인스턴스 영구 유지
        let _ = Box::leak(Box::new(tray_manager));
    });
}
