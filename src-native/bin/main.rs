#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
use gpui::{
    div, point, prelude::*, px, size, App, Application, Bounds, Context, IntoElement, Render,
    Window, WindowBackgroundAppearance, WindowBounds, WindowHandle, WindowKind, WindowOptions,
};
use llm_usage_monitor_core::{
    core::{engine::UsageMonitorEngine, types::*},
    shell::{
        position::{calculate_popover_position, Point as PosPoint, WindowRect, WindowSize},
        tray::SystemTrayManager,
    },
    ui::{
        compact::render_compact, local_tokens::render_local_tokens_card,
        quota_card::render_quota_card, theme::ThemeMode,
        vendor_banner::render_vendor_health_banner,
    },
};
use muda::MenuEvent;
use std::{
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tray_icon::TrayIconEvent;

struct AppState {
    window_handle: Option<WindowHandle<PopoverView>>,
    pinned: bool,
    compact: bool,
    theme: ThemeMode,
    snapshot: Option<AppSnapshot>,
    refreshing: bool,
    refresh_requested: bool,
    preferences_path: PathBuf,
    tray_bounds: Option<WindowRect>,
    fixed_now: Option<chrono::DateTime<chrono::Utc>>,
}
impl AppState {
    fn save_preferences(&self) {
        let theme = match self.theme {
            ThemeMode::System => "system",
            ThemeMode::Light => "light",
            ThemeMode::Dark => "dark",
        };
        let value =
            serde_json::json!({"compact": self.compact, "theme": theme, "pinned": self.pinned});
        let _ = std::fs::write(&self.preferences_path, value.to_string());
    }
}
// GPUI Windows는 마지막 창 제거 시 PostQuitMessage를 보낸다.
// 표시되지 않는 최소 창을 유지해야 팝오버 제거 후에도 트레이가 동작한다.
#[cfg(target_os = "windows")]
struct TrayKeepAlive;
#[cfg(target_os = "windows")]
impl Render for TrayKeepAlive {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}

struct PopoverView {
    state: Arc<Mutex<AppState>>,
}
impl Render for PopoverView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let (pinned, compact, theme, snapshot, refreshing, now) = {
            let s = self.state.lock().unwrap();
            (
                s.pinned,
                s.compact,
                s.theme,
                s.snapshot.clone(),
                s.refreshing,
                s.fixed_now.unwrap_or_else(chrono::Utc::now),
            )
        };
        let palette = theme.palette(window.appearance());
        div()
            .flex()
            .flex_col()
            .size_full()
            .bg(palette.background)
            .text_color(palette.text)
            .rounded_xl()
            .border_1()
            .border_color(palette.border)
            .p_3()
            .gap_2()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(div().text_sm().child("LLM Usage Monitor"))
                    .child(
                        div()
                            .text_xs()
                            .text_color(palette.muted)
                            .child(if refreshing {
                                "수집 중…"
                            } else {
                                "v0.12.0"
                            }),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap_2()
                    .text_xs()
                    .child(
                        div()
                            .id("refresh")
                            .px_2()
                            .py_1()
                            .bg(palette.surface)
                            .rounded_md()
                            .cursor_pointer()
                            .child(if refreshing {
                                "갱신 중…"
                            } else {
                                "새로고침"
                            })
                            .on_click(cx.listener(|this, _, _, cx| {
                                let mut s = this.state.lock().unwrap();
                                if !s.refreshing {
                                    s.refresh_requested = true;
                                }
                                cx.notify();
                            })),
                    )
                    .child(
                        div()
                            .id("compact")
                            .px_2()
                            .py_1()
                            .bg(palette.surface)
                            .rounded_md()
                            .cursor_pointer()
                            .child(if compact {
                                "카드 보기"
                            } else {
                                "간략 보기"
                            })
                            .on_click(cx.listener(|this, _, _, cx| {
                                let mut s = this.state.lock().unwrap();
                                s.compact = !s.compact;
                                s.save_preferences();
                                cx.notify();
                            })),
                    )
                    .child(
                        div()
                            .id("theme")
                            .px_2()
                            .py_1()
                            .bg(palette.surface)
                            .rounded_md()
                            .cursor_pointer()
                            .child(theme.label())
                            .on_click(cx.listener(|this, _, _, cx| {
                                let mut s = this.state.lock().unwrap();
                                s.theme = s.theme.next();
                                s.save_preferences();
                                cx.notify();
                            })),
                    )
                    .child(
                        div()
                            .id("pin")
                            .px_2()
                            .py_1()
                            .bg(palette.surface)
                            .rounded_md()
                            .cursor_pointer()
                            .child(if pinned { "고정 해제" } else { "고정" })
                            .on_click(cx.listener(|this, _, _, cx| {
                                let mut s = this.state.lock().unwrap();
                                s.pinned = !s.pinned;
                                s.save_preferences();
                                cx.notify();
                            })),
                    ),
            )
            .child(
                div()
                    .id("content")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .children(if let Some(snap) = snapshot {
                        vec![
                            render_vendor_health_banner(&snap.providers, palette)
                                .into_any_element(),
                            if compact {
                                render_compact(&snap.providers, palette, now).into_any_element()
                            } else {
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_2()
                                    .children(
                                        snap.providers
                                            .iter()
                                            .map(|p| render_quota_card(p, palette, now)),
                                    )
                                    .into_any_element()
                            },
                            render_local_tokens_card(&snap.providers, palette).into_any_element(),
                            div()
                                .text_xs()
                                .text_color(palette.muted)
                                .child(format!(
                                    "갱신 {} · 사용률·리셋에 마우스를 올리면 도움말",
                                    snap.updated_at
                                        .with_timezone(&chrono::Local)
                                        .format("%H:%M:%S")
                                ))
                                .into_any_element(),
                        ]
                    } else {
                        vec![div()
                            .p_4()
                            .text_sm()
                            .child("쿼터와 로컬 사용량을 수집하고 있습니다…")
                            .into_any_element()]
                    }),
            )
    }
}

fn close_popover(state: &Arc<Mutex<AppState>>, cx: &mut App) {
    let handle = state.lock().unwrap().window_handle.take();
    if let Some(handle) = handle {
        let _ = handle.update(cx, |_, window, _| window.remove_window());
    }
}
fn open_popover(state: Arc<Mutex<AppState>>, cx: &mut App) {
    let existing = state.lock().unwrap().window_handle;
    if let Some(handle) = existing {
        if handle
            .update(cx, |_, window, _| window.activate_window())
            .is_ok()
        {
            return;
        }
        state.lock().unwrap().window_handle = None;
    }
    let displays = cx.displays();
    #[cfg(target_os = "windows")]
    let tray_bounds = state.lock().unwrap().tray_bounds;
    #[cfg(target_os = "windows")]
    let native_geometry =
        tray_bounds.and_then(llm_usage_monitor_core::shell::position::native_tray_work_area);
    #[cfg(not(target_os = "windows"))]
    let native_geometry: Option<(PosPoint, WindowRect)> = None;
    let display = native_geometry
        .and_then(|(anchor, _)| {
            displays
                .iter()
                .find(|d| {
                    let b = d.bounds();
                    let (x, y, w, h) = (
                        f32::from(b.origin.x),
                        f32::from(b.origin.y),
                        f32::from(b.size.width),
                        f32::from(b.size.height),
                    );
                    anchor.x >= x && anchor.x <= x + w && anchor.y >= y && anchor.y <= y + h
                })
                .cloned()
        })
        .or_else(|| displays.first().cloned());
    let area = display
        .as_ref()
        .map(|d| {
            let b = d.bounds();
            WindowRect::new(
                b.origin.x.into(),
                b.origin.y.into(),
                b.size.width.into(),
                b.size.height.into(),
            )
        })
        .unwrap_or(WindowRect::new(0., 0., 1920., 1080.));
    let area = native_geometry.map(|(_, work)| work).unwrap_or(area);
    let width = 400_f32.min(area.width);
    let height = 640_f32.min((area.height - 64.).max(100.));
    let anchor = PosPoint::new(
        area.x + area.width - 140.,
        if cfg!(target_os = "macos") {
            area.y
        } else {
            area.y + area.height
        },
    );
    let anchor = native_geometry
        .map(|(anchor, _)| anchor)
        .unwrap_or(anchor);
    let pos = calculate_popover_position(anchor, area, WindowSize::new(width, height));
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: point(px(pos.x), px(pos.y)),
            size: size(px(width), px(height)),
        })),
        display_id: display.map(|d| d.id()),
        titlebar: None,
        window_background: WindowBackgroundAppearance::Opaque,
        focus: true,
        show: true,
        kind: WindowKind::PopUp,
        is_movable: false,
        is_resizable: false,
        ..Default::default()
    };
    let view_state = state.clone();
    match cx.open_window(options, move |window, cx| {
        cx.new(|cx| {
            cx.observe_window_activation(window, |this: &mut PopoverView, window, _| {
                let mut s = this.state.lock().unwrap();
                if !window.is_window_active() && !s.pinned {
                    s.window_handle = None;
                    drop(s);
                    window.remove_window();
                }
            })
            .detach();
            cx.observe_window_appearance(window, |_, _, cx| cx.notify())
                .detach();
            PopoverView { state: view_state }
        })
    }) {
        Ok(handle) => state.lock().unwrap().window_handle = Some(handle),
        Err(_) => eprintln!("네이티브 창을 열지 못했습니다."),
    }
}

fn demo_snapshot() -> AppSnapshot {
    let now = chrono::Utc::now();
    AppSnapshot {
        schema_version: 1,
        updated_at: now,
        refreshing: vec![],
        providers: [
            ProviderId::Codex,
            ProviderId::Claude,
            ProviderId::Antigravity,
        ]
        .into_iter()
        .map(|id| ProviderSnapshot {
            provider_id: id,
            account_label: Some("demo@example.invalid".into()),
            auth_kind: None,
            status: SnapshotStatus::Fresh,
            fetched_at: now,
            last_successful_at: Some(now),
            quota_windows: vec![
                QuotaWindow {
                    id: format!("{}-5h", id.as_str()),
                    kind: QuotaKind::FiveHour,
                    label: "5시간".into(),
                    used_percent: Some(35.),
                    resets_at: Some(now + chrono::Duration::hours(2)),
                    source: ProviderSource::LocalFixture,
                    status: SnapshotStatus::Fresh,
                },
                QuotaWindow {
                    id: format!("{}-weekly", id.as_str()),
                    kind: QuotaKind::Weekly,
                    label: "주간".into(),
                    used_percent: None,
                    resets_at: None,
                    source: ProviderSource::LocalFixture,
                    status: SnapshotStatus::Unavailable,
                },
            ],
            local_usage: None,
            error: None,
            service_status: None,
        })
        .collect(),
    }
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let fixture_path = args.iter().find_map(|a| a.strip_prefix("--demo-snapshot="));
    let fixture: Option<AppSnapshot> = fixture_path.map(|path| {
        std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_else(|| { eprintln!("Invalid demo snapshot"); std::process::exit(2) })
    });
    let demo = fixture.is_some() || args.iter().any(|a| a == "--demo");
    let fixed_now = fixture.as_ref().map(|s| s.updated_at);
    let hidden = args.iter().any(|a| a == "--start-hidden");
    let hide_after = args.iter().find_map(|a| {
        a.strip_prefix("--hide-after=")
            .and_then(|v| v.parse::<u64>().ok())
    });
    let quit_after = args.iter().find_map(|a| {
        a.strip_prefix("--quit-after=")
            .and_then(|v| v.parse::<u64>().ok())
    });
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("collector runtime");
    let runtime_handle = runtime.handle().clone();
    Application::new().run(move |cx| {
        let data_dir = if demo {
            std::env::temp_dir().join(format!("llm-monitor-demo-{}", std::process::id()))
        } else {
            dirs::data_local_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("llm-usage-monitor-native")
        };
        let _ = std::fs::create_dir_all(&data_dir);
        let preferences_path = data_dir.join("preferences.json");
        let preferences: serde_json::Value = std::fs::read(&preferences_path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        let state = Arc::new(Mutex::new(AppState {
            window_handle: None,
            pinned: preferences["pinned"].as_bool().unwrap_or(demo),
            compact: preferences["compact"].as_bool().unwrap_or(false),
            theme: match preferences["theme"].as_str() {
                Some("light") => ThemeMode::Light,
                Some("dark") => ThemeMode::Dark,
                _ => ThemeMode::System,
            },
            snapshot: fixture.clone().or_else(|| demo.then(demo_snapshot)),
            refreshing: false,
            refresh_requested: !demo,
            preferences_path,
            tray_bounds: None,
            fixed_now,
        }));
        let engine = Arc::new(UsageMonitorEngine::new(data_dir));
        let tray = match SystemTrayManager::new() {
            Ok(t) => t,
            Err(_) => {
                eprintln!("트레이 초기화에 실패했습니다.");
                cx.quit();
                return;
            }
        };
        #[cfg(target_os = "windows")]
        if cx
            .open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: point(px(0.), px(0.)),
                        size: size(px(1.), px(1.)),
                    })),
                    focus: false,
                    show: false,
                    titlebar: None,
                    kind: WindowKind::PopUp,
                    is_movable: false,
                    is_resizable: false,
                    ..Default::default()
                },
                |_, cx| cx.new(|_| TrayKeepAlive),
            )
            .is_err()
        {
            eprintln!("트레이 유지 창 초기화에 실패했습니다.");
            cx.quit();
            return;
        }
        state.lock().unwrap().tray_bounds = tray.bounds();
        if !hidden {
            open_popover(state.clone(), cx);
        }
        let (tx, rx) = mpsc::channel();
        let async_cx = cx.to_async();
        let timer = cx.background_executor().clone();
        cx.foreground_executor()
            .spawn(async move {
                let _tray_lifetime = &tray;
                let start = Instant::now();
                let mut hidden_once = false;
                let mut last_poll = Instant::now();
                let mut last_render = Instant::now();
                loop {
                    if !hidden_once
                        && hide_after.is_some_and(|seconds| start.elapsed().as_secs() >= seconds)
                    {
                        let state = state.clone();
                        let _ = async_cx.update(move |cx| close_popover(&state, cx));
                        hidden_once = true;
                    }
                    if quit_after.is_some_and(|seconds| start.elapsed().as_secs() >= seconds) {
                        let _ = async_cx.update(|cx| cx.quit());
                        break;
                    }
                    while let Ok(event) = TrayIconEvent::receiver().try_recv() {
                        state.lock().unwrap().tray_bounds = tray.bounds();
                        if let TrayIconEvent::Click {
                            button: tray_icon::MouseButton::Left,
                            button_state: tray_icon::MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let state = state.clone();
                            let _ = async_cx.update(move |cx| {
                                let open = state.lock().unwrap().window_handle.is_some();
                                if open {
                                    close_popover(&state, cx);
                                } else {
                                    open_popover(state, cx);
                                }
                            });
                        }
                    }
                    while let Ok(event) = MenuEvent::receiver().try_recv() {
                        state.lock().unwrap().tray_bounds = tray.bounds();
                        if event.id == tray.quit_id {
                            let _ = async_cx.update(|cx| cx.quit());
                            return;
                        }
                        if event.id == tray.refresh_id {
                            let mut s = state.lock().unwrap();
                            if !s.refreshing {
                                s.refresh_requested = true;
                            }
                        }
                        if event.id == tray.open_id || event.id == tray.reset_pos_id {
                            let state = state.clone();
                            let reset = event.id == tray.reset_pos_id;
                            let _ = async_cx.update(move |cx| {
                                if reset {
                                    close_popover(&state, cx);
                                }
                                open_popover(state, cx);
                            });
                        }
                    }
                    if let Ok(snapshot) = rx.try_recv() {
                        let mut s = state.lock().unwrap();
                        s.snapshot = Some(snapshot);
                        s.refreshing = false;
                        drop(s);
                        last_poll = Instant::now();
                        let _ = async_cx.refresh();
                    }
                    let should_collect = {
                        let mut s = state.lock().unwrap();
                        if !s.refreshing
                            && (s.refresh_requested
                                || last_poll.elapsed() >= Duration::from_secs(60))
                        {
                            s.refresh_requested = false;
                            s.refreshing = true;
                            true
                        } else {
                            false
                        }
                    };
                    if should_collect {
                        let _ = async_cx.refresh();
                        let tx = tx.clone();
                        let engine = engine.clone();
                        runtime_handle.spawn(async move {
                            let snapshot = if demo {
                                demo_snapshot()
                            } else {
                                engine.fetch_all_snapshots().await
                            };
                            let _ = tx.send(snapshot);
                        });
                    }
                    if last_render.elapsed() >= Duration::from_secs(30) {
                        if state.lock().unwrap().window_handle.is_some() {
                            let _ = async_cx.refresh();
                        }
                        last_render = Instant::now();
                    }
                    timer.timer(Duration::from_millis(100)).await;
                }
            })
            .detach();
    });
    runtime.shutdown_background();
}
