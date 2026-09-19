#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
use gpui::{
    div, point, prelude::*, px, size, App, Application, Bounds, Context, IntoElement, Render,
    Window, WindowBackgroundAppearance, WindowBounds, WindowHandle, WindowKind, WindowOptions,
};
use llm_usage_monitor_core::{
    core::{engine::UsageMonitorEngine, types::*},
    shell::{
        position::{
            calculate_popover_position, clamp_popover_height, clamp_window_position,
            Point as PosPoint, WindowRect, WindowSize,
        },
        tray::SystemTrayManager,
    },
    ui::{
        compact::render_compact,
        icons::Icons,
        presentation::{UiAction, UiEvents},
        quota_card::render_quota_card,
        theme::ThemeMode,
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
    expanded: std::collections::HashSet<ProviderId>,
    expanded_errors: std::collections::HashSet<ProviderId>,
    desired_height: Option<f32>,
    max_height: f32,
    work_area: WindowRect,
    anchor: PosPoint,
    custom_position: Option<PosPoint>,
    dragging: bool,
    ui_error: Option<String>,
    demo: bool,
}
impl AppState {
    fn save_preferences(&self) {
        let value = serde_json::json!({"pinned": self.pinned});
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
    focus: gpui::FocusHandle,
}
impl Render for PopoverView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let (pinned, compact, theme, snapshot, refreshing, now, expanded, errors) = {
            let s = self.state.lock().unwrap();
            (
                s.pinned,
                s.compact,
                s.theme,
                s.snapshot.clone(),
                s.refreshing,
                s.fixed_now.unwrap_or_else(chrono::Utc::now),
                s.expanded.clone(),
                s.expanded_errors.clone(),
            )
        };
        let palette = theme.palette(window.appearance());
        let weak = cx.entity().downgrade();
        let events: UiEvents = std::rc::Rc::new(move |action, window, cx| {
            let _ = weak.update(cx, |view, cx| {
                let mut s = view.state.lock().unwrap();
                match &action {
                    UiAction::OpenUrl(url) => {
                        if !s.demo && llm_usage_monitor_core::shell::desktop::open_url(url).is_err()
                        {
                            s.ui_error = Some("Failed to open status page.".into());
                        }
                        cx.notify();
                        return;
                    }
                    UiAction::Setup(id, alternate) => {
                        use llm_usage_monitor_core::shell::desktop::{open_setup, Setup};
                        let setup = match (id, alternate) {
                            (ProviderId::Claude, false) => Setup::ClaudeLogin,
                            (ProviderId::Claude, true) => Setup::ClaudeTrust,
                            (ProviderId::Antigravity, false) => Setup::AntigravityLogin,
                            (ProviderId::Antigravity, true) => Setup::AntigravitySwitch,
                            _ => return,
                        };
                        if !s.demo && open_setup(setup).is_err() {
                            s.ui_error = Some("Failed to open setup terminal.".into());
                        }
                        cx.notify();
                        return;
                    }
                    _ => {}
                }
                let _ = window;
                let (set, id) = match action {
                    UiAction::Additional(id) => (&mut s.expanded, id),
                    UiAction::Error(id) => (&mut s.expanded_errors, id),
                    _ => unreachable!(),
                };
                if !set.remove(&id) {
                    set.insert(id);
                }
                cx.notify();
            });
        });
        let measured_state = self.state.clone();
        let font = if cfg!(target_os = "macos") {
            "SFMono-Regular"
        } else {
            "Cascadia Mono"
        };
        div().id("app-shell").track_focus(&self.focus)
            .on_key_down(cx.listener(|this, event: &gpui::KeyDownEvent, window, cx| {
                let key = &event.keystroke;
                if key.key == "escape" {
                    if !this.state.lock().unwrap().pinned {
                        this.state.lock().unwrap().window_handle = None;
                        window.remove_window();
                    }
                    return;
                }
                let modifier = if cfg!(target_os="macos") { key.modifiers.platform } else { key.modifiers.control };
                if modifier && key.modifiers.shift {
                    let mut s=this.state.lock().unwrap();
                    match key.key.to_lowercase().as_str() {
                        "c" => s.compact = !s.compact,
                        "l" => s.theme = s.theme.next(window.appearance()),
                        "p" => { if llm_usage_monitor_core::shell::desktop::set_topmost(window,!s.pinned).is_ok() {s.pinned = !s.pinned; s.save_preferences();} else {s.ui_error=Some("Failed to change always-on-top state.".into());} },
                        _ => return,
                    }
                    cx.notify();
                }
            }))
            .flex().flex_col().size_full().bg(palette.background).text_color(palette.text)
            .font_family(font).text_size(px(17.6)).line_height(gpui::relative(1.2))
            .pt(px(if compact {10.} else {12.})).px(px(if compact {10.} else {18.})).pb(px(6.))
            .child(div().flex().items_center().justify_between().gap(px(12.)).flex_shrink_0()
                .on_mouse_down(gpui::MouseButton::Left, cx.listener(|this,_,window,_| {this.state.lock().unwrap().dragging=true; window.start_window_move();}))
                .on_mouse_up(gpui::MouseButton::Left, cx.listener(|this,_,_,_| this.state.lock().unwrap().dragging=false))
                .child(div().id("refresh").cursor_pointer().text_size(px(14.432)).font_weight(gpui::FontWeight::BOLD).text_color(palette.muted)
                    .child(if refreshing { "LLM Usage Monitor…" } else { "LLM Usage Monitor" })
                    .on_mouse_down(gpui::MouseButton::Left, |_,_,cx|cx.stop_propagation())
                    .on_click(cx.listener(|this,_,_,cx| { let mut s=this.state.lock().unwrap(); if !s.refreshing && s.snapshot.is_some() {s.refresh_requested=true;} cx.notify(); })))
                .child(div().flex().items_center().gap(px(10.))
                    .child(div().id("compact").cursor_pointer().size(px(16.)).child(gpui::svg().path(if compact {"AddSquare"} else {"MinusSquare"}).size_full().text_color(palette.muted))
                        .on_mouse_down(gpui::MouseButton::Left,|_,_,cx|cx.stop_propagation())
                        .tooltip(move |_,cx|llm_usage_monitor_core::ui::tooltip::tooltip(if compact {"Expand to detailed mode"} else {"Collapse to compact mode"}.into(),palette,cx))
                        .on_click(cx.listener(|this,_,_,cx| {let mut s=this.state.lock().unwrap();s.compact=!s.compact;cx.notify();})))
                    .child(div().id("theme").cursor_pointer().size(px(16.)).child(gpui::svg().path(if palette.background == gpui::rgb(0x101010) {"Moon-filled"} else {"Sun-filled"}).size_full().text_color(palette.muted))
                        .on_mouse_down(gpui::MouseButton::Left,|_,_,cx|cx.stop_propagation())
                        .on_click(cx.listener(|this,_,window,cx| {let mut s=this.state.lock().unwrap();s.theme=s.theme.next(window.appearance());cx.notify();})))
                    .child(div().id("pin").cursor_pointer().size(px(16.)).child(gpui::svg().path(if pinned {"Pin-filled"} else {"Pin"}).size_full().text_color(palette.muted))
                        .on_mouse_down(gpui::MouseButton::Left,|_,_,cx|cx.stop_propagation())
                        .on_click(cx.listener(|this,_,window,cx| {let mut s=this.state.lock().unwrap();if llm_usage_monitor_core::shell::desktop::set_topmost(window,!s.pinned).is_ok() {s.pinned=!s.pinned;s.save_preferences();} else {s.ui_error=Some("Failed to change always-on-top state.".into());} cx.notify();})))
                    .child(div().id("help").cursor_pointer().size(px(16.)).child(gpui::svg().path("Help").size_full().text_color(palette.muted))
                        .on_mouse_down(gpui::MouseButton::Left,|_,_,cx|cx.stop_propagation())
                        .tooltip(move |_,cx|llm_usage_monitor_core::ui::tooltip::tooltip("LLM Usage Monitor v0.12.0\nquota: account · tokens: this PC\nCtrl/⌘+Shift+C  Toggle compact mode\nCtrl/⌘+Shift+L  Toggle theme (dark/light)\nCtrl/⌘+Shift+P  Toggle pin (always on top)\nEsc  Close popover (stay in tray)".into(),palette,cx)))))
            .children(self.state.lock().unwrap().ui_error.clone().map(|message|div().text_size(px(11.968)).text_color(palette.high).child(message)))
            .child(div().id("content").flex_1().min_h_0().overflow_y_scroll().mt(px(if compact {8.} else {12.}))
                .child(div().flex().flex_col().gap(px(7.)).flex_shrink_0().w_full()
                    .on_children_prepainted(move |bounds,_,_| {
                        if let (Some(first),Some(last))=(bounds.first(),bounds.last()) {
                            measured_state.lock().unwrap().desired_height=Some(f32::from(last.bottom()-first.top())+if compact {50.} else {56.});
                        }
                    })
                    .children(if let Some(snap)=snapshot {
                        let mut children=Vec::new();
                        if !compact && snap.providers.iter().any(|p| p.service_status.as_ref().is_some_and(|s| matches!(s.indicator, ServiceHealthIndicator::Minor | ServiceHealthIndicator::Major | ServiceHealthIndicator::Critical))) { children.push(render_vendor_health_banner(&snap.providers,palette,events.clone()).into_any_element()); }
                        if compact { children.push(render_compact(&snap.providers,palette,now,&errors,events.clone()).into_any_element()); }
                        else { for (index,p) in snap.providers.iter().enumerate() {children.push(render_quota_card(p,index,palette,now,expanded.contains(&p.provider_id),events.clone()).into_any_element());} }
                        children
                    } else {vec![div().text_size(px(11.968)).child("Loading quota…").into_any_element()]})))
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
    let width = 480_f32.min(area.width);
    let height = 360_f32.min((area.height - 4.).max(100.));
    state.lock().unwrap().max_height = (area.height - 4.).max(100.);
    let anchor = PosPoint::new(
        area.x + area.width - 140.,
        if cfg!(target_os = "macos") {
            area.y
        } else {
            area.y + area.height
        },
    );
    let anchor = native_geometry.map(|(anchor, _)| anchor).unwrap_or(anchor);
    let pos = {
        let mut s = state.lock().unwrap();
        s.work_area = area;
        s.anchor = anchor;
        s.dragging = false;
        s.custom_position
            .map(|p| clamp_window_position(p, WindowSize::new(width, height), area))
            .unwrap_or_else(|| {
                calculate_popover_position(anchor, area, WindowSize::new(width, height))
            })
    };
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
        is_movable: true,
        is_resizable: false,
        ..Default::default()
    };
    let view_state = state.clone();
    match cx.open_window(options, move |window, cx| {
        cx.new(|cx| {
            cx.observe_window_bounds(window, |this: &mut PopoverView, window, _| {
                let mut s = this.state.lock().unwrap();
                if s.dragging {
                    let origin = window.bounds().origin;
                    s.custom_position = Some(PosPoint::new(origin.x.into(), origin.y.into()));
                }
            })
            .detach();
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
            let pinned = view_state.lock().unwrap().pinned;
            if llm_usage_monitor_core::shell::desktop::set_topmost(window, pinned).is_err() {
                view_state.lock().unwrap().ui_error =
                    Some("Failed to change always-on-top state.".into());
            }
            let focus = cx.focus_handle();
            window.focus(&focus);
            PopoverView {
                state: view_state,
                focus,
            }
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
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_else(|| {
                eprintln!("Invalid demo snapshot");
                std::process::exit(2)
            })
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
    Application::new().with_assets(Icons).run(move |cx| {
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
            compact: false,
            theme: ThemeMode::System,
            snapshot: fixture.clone().or_else(|| demo.then(demo_snapshot)),
            refreshing: false,
            refresh_requested: !demo,
            preferences_path,
            tray_bounds: None,
            fixed_now,
            expanded: Default::default(),
            expanded_errors: Default::default(),
            desired_height: None,
            max_height: 1000.,
            work_area: WindowRect::new(0.,0.,1920.,1080.),
            anchor: PosPoint::new(1780.,1080.),
            custom_position: None,
            dragging: false,
            ui_error: None,
            demo,
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
        if !demo { tray.launch_item.set_checked(llm_usage_monitor_core::shell::desktop::launch_at_login().unwrap_or(false)); }
        state.lock().unwrap().tray_bounds = tray.bounds();
        if !hidden {
            open_popover(state.clone(), cx);
        }
        let (tx, rx) = mpsc::channel();
        let (startup_tx,startup_rx)=mpsc::channel();
        let mut startup_pending=false;
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
                    let resize = {
                        let mut s = state.lock().unwrap();
                        s.desired_height.take().and_then(|h| {
                            s.window_handle
                                .map(|handle| (handle, clamp_popover_height(Some(h),if h<304. {h.max(124.)} else {360.},s.max_height)))
                        })
                    };
                    if let Some((handle, height)) = resize {
                        let _ = async_cx.update(|cx| {
                            handle.update(cx, |view, window, _| {
                                if (f32::from(window.bounds().size.height) - height).abs() > 1. {
                                    let mut s=view.state.lock().unwrap();
                                    s.dragging=false;
                                    let width=480_f32.min(s.work_area.width);
                                    window.resize(size(px(width), px(height.ceil())));
                                    #[cfg(target_os="windows")]
                                    {
                                        let dimensions=WindowSize::new(width,height.ceil());
                                        let pos=s.custom_position.map(|p|clamp_window_position(p,dimensions,s.work_area))
                                            .unwrap_or_else(||calculate_popover_position(s.anchor,s.work_area,dimensions));
                                        if llm_usage_monitor_core::shell::desktop::set_position(window,pos.x,pos.y).is_err() {
                                            s.ui_error=Some("Failed to update window position.".into());
                                        }
                                    }
                                }
                            })
                        });
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
                    if let Ok(result)=startup_rx.try_recv() {
                        startup_pending=false;
                        tray.launch_item.set_enabled(true);
                        match result { Ok(actual)=>tray.launch_item.set_checked(actual), Err(previous)=>{tray.launch_item.set_checked(previous);state.lock().unwrap().ui_error=Some("Failed to change launch-at-login setting.".into());} }
                        let _=async_cx.refresh();
                    }
                    while let Ok(event) = MenuEvent::receiver().try_recv() {
                        state.lock().unwrap().tray_bounds = tray.bounds();
                        if event.id == *tray.launch_item.id() && !startup_pending {
                            let requested=tray.launch_item.is_checked();
                            if !demo {
                                startup_pending=true;tray.launch_item.set_enabled(false);
                                let tx=startup_tx.clone();
                                std::thread::spawn(move || {let result=llm_usage_monitor_core::shell::desktop::set_launch_at_login(requested).map_err(|_|!requested);let _=tx.send(result);});
                            }
                        } else if event.id == tray.quit_id {
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
                                    state.lock().unwrap().custom_position=None;
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
                        let demo_input = fixture.clone();
                        runtime_handle.spawn(async move {
                            let snapshot = if demo {
                                demo_input.unwrap_or_else(demo_snapshot)
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
