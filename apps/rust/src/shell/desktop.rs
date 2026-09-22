//! OS 명령은 UI에서 분리한다. 인증은 벤더 터미널에만 위임한다.
use anyhow::{bail, Context, Result};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

/// GPUI 0.2.2는 모니터 변경 시 숨김 창에도 ShowWindow를 호출할 수 있다.
/// 트레이 수명 유지용 창에만 적용하며 GPUI의 창 소유권은 유지한다.
#[cfg(target_os = "windows")]
pub fn keep_tray_host_hidden(window: &gpui::Window) -> Result<()> {
    let handle = HasWindowHandle::window_handle(window)
        .map_err(|_| anyhow::anyhow!("window handle unavailable"))?;
    let RawWindowHandle::Win32(handle) = handle.as_raw() else {
        bail!("unsupported window platform");
    };
    // GPUI 창을 생성한 UI 스레드에서만 호출한다.
    unsafe {
        hidden_tray_host::install(windows::Win32::Foundation::HWND(handle.hwnd.get() as *mut _))
    }
}

#[cfg(target_os = "windows")]
mod hidden_tray_host {
    use anyhow::{bail, Result};
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::*,
        },
    };

    const SUBCLASS_ID: usize = 1;

    unsafe extern "system" fn procedure(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        _: usize,
    ) -> LRESULT {
        match message {
            WM_WINDOWPOSCHANGING => {
                if let Some(position) = (lparam.0 as *mut WINDOWPOS).as_mut() {
                    position.flags &= !SWP_SHOWWINDOW;
                    position.flags |= SWP_NOACTIVATE;
                }
            }
            WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
            WM_NCDESTROY => {
                let _ = RemoveWindowSubclass(hwnd, Some(procedure), id);
            }
            _ => {}
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }

    pub(super) unsafe fn install(hwnd: HWND) -> Result<()> {
        if !SetWindowSubclass(hwnd, Some(procedure), SUBCLASS_ID, 0).as_bool() {
            bail!("could not protect tray host visibility");
        }
        // show:false에서는 GPUI가 요청한 1×1 배치를 미루므로 실제 HWND에도 적용한다.
        // ShowWindow 반환값은 성공 여부가 아니라 이전 표시 상태다.
        let _ = ShowWindow(hwnd, SW_HIDE);
        // OS 최소 크기 보정은 유지한다. 외곽을 1×1로 강제하면 GPUI의 그리기 영역이
        // 사라져 DirectX 렌더러가 실패할 수 있으므로 숨김 여부를 불변 조건으로 삼는다.
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            1,
            1,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_HIDEWINDOW,
        )?;
        if IsWindowVisible(hwnd).as_bool() {
            bail!("tray host remained visible");
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows::core::w;

        struct TestWindow(HWND);
        impl Drop for TestWindow {
            fn drop(&mut self) {
                unsafe {
                    let _ = DestroyWindow(self.0);
                }
            }
        }

        unsafe fn window() -> TestWindow {
            TestWindow(
                CreateWindowExW(
                    WS_EX_TOOLWINDOW,
                    w!("STATIC"),
                    w!("synthetic tray host"),
                    WS_POPUP,
                    0,
                    0,
                    100,
                    100,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap(),
            )
        }

        #[test]
        fn native_show_requests_keep_host_hidden_without_affecting_other_windows() {
            unsafe {
                let host = window();
                let popover = window();
                install(host.0).unwrap();
                let mut bounds = windows::Win32::Foundation::RECT::default();
                GetWindowRect(host.0, &mut bounds).unwrap();
                assert_eq!(
                    (bounds.right - bounds.left, bounds.bottom - bounds.top),
                    (1, 1)
                );
                for _ in 0..3 {
                    // GPUI 모니터 복구 경로와 일반 표시 요청을 실제 OS에 전달한다.
                    let _ = ShowWindow(host.0, SW_SHOWNORMAL);
                    assert!(!IsWindowVisible(host.0).as_bool());
                    SetWindowPos(
                        host.0,
                        None,
                        0,
                        0,
                        1,
                        1,
                        SWP_SHOWWINDOW | SWP_NOZORDER | SWP_NOACTIVATE,
                    )
                    .unwrap();
                    assert!(!IsWindowVisible(host.0).as_bool());
                    let _ = ShowWindow(popover.0, SW_SHOWNOACTIVATE);
                    assert!(IsWindowVisible(popover.0).as_bool());
                    let _ = ShowWindow(popover.0, SW_HIDE);
                    assert!(!IsWindowVisible(popover.0).as_bool());
                    assert!(IsWindow(Some(host.0)).as_bool());
                }
                assert!(install(HWND(std::ptr::null_mut())).is_err());
                // WM_NCDESTROY에서 subclass를 제거한 후 정상적으로 파괴된다.
                let hwnd = host.0;
                drop(host);
                assert!(!IsWindow(Some(hwnd)).as_bool());
            }
        }
    }
}

pub fn prefers_reduced_motion() -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::*;
        let mut enabled: i32 = 1;
        return unsafe {
            SystemParametersInfoW(
                SPI_GETCLIENTAREAANIMATION,
                0,
                Some((&mut enabled as *mut i32).cast()),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
        }
        .is_err()
            || enabled == 0;
    }
    #[cfg(not(target_os = "windows"))]
    false
}

#[cfg(target_os = "windows")]
pub fn window_work_area(window: &gpui::Window) -> Result<super::position::WindowRect> {
    use windows::Win32::{
        Foundation::HWND,
        Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        },
    };
    let handle = HasWindowHandle::window_handle(window)
        .map_err(|_| anyhow::anyhow!("window handle unavailable"))?;
    let RawWindowHandle::Win32(handle) = handle.as_raw() else {
        bail!("unsupported window platform");
    };
    // 모니터 선택은 물리 HWND에 맡기고, 좌표 변환은 GPUI와 같은 배율을 사용한다.
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    unsafe {
        let monitor =
            MonitorFromWindow(HWND(handle.hwnd.get() as *mut _), MONITOR_DEFAULTTONEAREST);
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            bail!("window work area unavailable");
        }
    }
    let r = info.rcWork;
    super::position::WindowRect::new(
        r.left as f32,
        r.top as f32,
        (r.right - r.left) as f32,
        (r.bottom - r.top) as f32,
    )
    .to_logical(window.scale_factor())
    .context("invalid window work area")
}

#[cfg(target_os = "windows")]
pub fn set_position(window: &gpui::Window, x: f32, y: f32) -> Result<()> {
    use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::*};
    let handle = HasWindowHandle::window_handle(window)
        .map_err(|_| anyhow::anyhow!("window handle unavailable"))?;
    let RawWindowHandle::Win32(handle) = handle.as_raw() else {
        bail!("unsupported window platform");
    };
    let scale = window.scale_factor();
    unsafe {
        SetWindowPos(
            HWND(handle.hwnd.get() as *mut _),
            None,
            (x * scale).round() as i32,
            (y * scale).round() as i32,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )?;
    }
    Ok(())
}

/// GPUI Windows의 기본 start_window_move는 no-op이다.
/// 현재 이벤트가 끝난 뒤 OS 이동 루프에 진입해 GPUI callback 재진입을 피한다.
pub fn start_window_move(window: &mut gpui::Window) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::{
            Foundation::{HWND, LPARAM, WPARAM},
            UI::{Input::KeyboardAndMouse::ReleaseCapture, WindowsAndMessaging::*},
        };
        let handle = HasWindowHandle::window_handle(window)
            .map_err(|_| anyhow::anyhow!("window handle unavailable"))?;
        let RawWindowHandle::Win32(handle) = handle.as_raw() else {
            bail!("unsupported window platform");
        };
        unsafe {
            let _ = ReleaseCapture();
            PostMessageW(
                Some(HWND(handle.hwnd.get() as *mut _)),
                WM_SYSCOMMAND,
                WPARAM((SC_MOVE | HTCAPTION) as usize),
                LPARAM(0),
            )?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    window.start_window_move();
    Ok(())
}

pub fn set_topmost(window: &gpui::Window, enabled: bool) -> Result<()> {
    let handle = HasWindowHandle::window_handle(window)
        .map_err(|_| anyhow::anyhow!("window handle unavailable"))?;
    match handle.as_raw() {
        #[cfg(target_os = "windows")]
        RawWindowHandle::Win32(handle) => {
            use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::*};
            // GPUI 소유의 현재 창 handle을 빌려 Z 순서만 변경한다.
            unsafe {
                SetWindowPos(
                    HWND(handle.hwnd.get() as *mut _),
                    Some(if enabled {
                        HWND_TOPMOST
                    } else {
                        HWND_NOTOPMOST
                    }),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                )?;
            }
            Ok(())
        }
        #[cfg(target_os = "macos")]
        RawWindowHandle::AppKit(handle) => {
            // GPUI 메인 스레드에서 살아 있는 NSView만 빌린다.
            let view = unsafe { &*handle.ns_view.as_ptr().cast::<objc2_app_kit::NSView>() };
            let window = view.window().context("native window unavailable")?;
            window.setLevel(if enabled {
                objc2_app_kit::NSStatusWindowLevel
            } else {
                objc2_app_kit::NSNormalWindowLevel
            });
            Ok(())
        }
        _ => bail!("unsupported window platform"),
    }
}

pub fn open_url(value: &str) -> Result<()> {
    let url = reqwest::Url::parse(value).context("invalid external URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("invalid external URL");
    }
    #[cfg(target_os = "windows")]
    {
        use windows::{
            core::PCWSTR,
            Win32::{
                Foundation::HWND,
                UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
            },
        };
        let target: Vec<u16> = url.as_str().encode_utf16().chain(Some(0)).collect();
        let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                Some(HWND(std::ptr::null_mut())),
                PCWSTR(verb.as_ptr()),
                PCWSTR(target.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            bail!("external browser failed");
        }
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url.as_str())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err(anyhow::anyhow!("unsupported platform"))
}
#[derive(Clone, Copy, Debug)]
pub enum Setup {
    ClaudeLogin,
    ClaudeTrust,
    AntigravityLogin,
    AntigravitySwitch,
}
fn probe_dir() -> PathBuf {
    std::env::var_os("CLAUDE_PROBE_DIRECTORY")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("LLM Usage Monitor")
                .join("claude-probe")
        })
}
pub fn setup_command(action: Setup) -> Result<Command> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("wt.exe");
        cmd.arg("new-tab");
        match action {
            Setup::ClaudeLogin => {
                cmd.args([
                    "--title",
                    "Claude Code Sign In",
                    "claude.exe",
                    "auth",
                    "login",
                    "--claudeai",
                ]);
            }
            Setup::ClaudeTrust => {
                let path = probe_dir();
                cmd.args(["--title", "Claude Code Probe Setup", "--startingDirectory"])
                    .arg(&path)
                    .args([
                        "claude.exe",
                        "--safe-mode",
                        "--ax-screen-reader",
                        "--restricted",
                        "--strict-mcp-config",
                        "--tools",
                        "",
                    ]);
            }
            Setup::AntigravityLogin => {
                cmd.args(["--title", "Antigravity CLI Sign In", "agy"]);
            }
            Setup::AntigravitySwitch => {
                cmd.args(["--title","Antigravity Account Switch","powershell.exe","-NoExit","-Command","Write-Host '=== Antigravity Account Switch ===' -ForegroundColor Cyan; Write-Host 'To switch accounts, run /logout and then sign in with your desired Google Account.' -ForegroundColor Yellow; & 'agy'"]);
            }
        }
        return Ok(cmd);
    }
    #[cfg(target_os = "macos")]
    {
        let script=match action {
            Setup::ClaudeLogin=>"claude auth login --claudeai".into(),
            Setup::ClaudeTrust=>format!("cd '{}' && claude --safe-mode --ax-screen-reader --restricted --strict-mcp-config --tools ''",probe_dir().to_string_lossy().replace('\'',"'\\''")),
            Setup::AntigravityLogin=>"agy".into(),
            Setup::AntigravitySwitch=>"echo '=== Antigravity Account Switch ===' && echo 'To switch accounts, run /logout and then sign in with your desired Google Account.' && agy".into(),
        };
        let mut cmd = Command::new("osascript");
        cmd.args([
            "-e",
            &format!(
                "tell application \"Terminal\" to do script \"{}\"",
                script.replace('\\', "\\\\").replace('"', "\\\"")
            ),
            "-e",
            "tell application \"Terminal\" to activate",
        ]);
        return Ok(cmd);
    }
    #[allow(unreachable_code)]
    Err(anyhow::anyhow!("unsupported platform"))
}
pub fn open_setup(action: Setup) -> Result<()> {
    if matches!(action, Setup::ClaudeTrust) {
        std::fs::create_dir_all(probe_dir())?;
    }
    setup_command(action)?
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn external_url_rejects_non_web_and_embedded_credentials() {
        for url in [
            "file:///synthetic",
            "javascript:alert(1)",
            "https://synthetic:secret@example.invalid",
            "not a URL",
        ] {
            assert!(open_url(url).is_err());
        }
    }
    #[test]
    #[cfg(target_os = "windows")]
    fn terminal_commands_delegate_auth_without_reading_credentials() {
        let cmd = setup_command(Setup::ClaudeLogin).unwrap();
        let args: Vec<_> = cmd.get_args().map(|x| x.to_string_lossy()).collect();
        assert_eq!(&args[args.len() - 3..], &["auth", "login", "--claudeai"]);
        let cmd = setup_command(Setup::ClaudeTrust).unwrap();
        assert!(cmd.get_args().any(|s| s == "--safe-mode"));
        assert!(!cmd
            .get_args()
            .any(|s| s == "--dangerously-skip-permissions"));
    }
}

fn managed_startup(action: &str) -> Result<bool> {
    let executable = std::env::current_exe()?;
    managed_startup_at(action, &executable)
}

fn managed_startup_at(action: &str, executable: &std::path::Path) -> Result<bool> {
    let parent = executable
        .parent()
        .context("executable directory unavailable")?;
    let directory = if cfg!(target_os = "macos") {
        parent.join("../Resources")
    } else {
        parent.to_path_buf()
    };
    let manifest_path = directory.join("install-info.json");
    if !manifest_path.exists() {
        if action == "query" {
            return Ok(false);
        }
        bail!("Install the app with scripts/install before enabling login startup.");
    }
    let data = std::fs::read_to_string(manifest_path)?;
    let manifest: serde_json::Value = serde_json::from_str(data.trim_start_matches('\u{feff}'))?;
    if manifest["schemaVersion"] != 1
        || manifest["appId"] != "llm-usage-monitor"
        || manifest["variant"] != "rust"
        || manifest["executable"].as_str() != executable.file_name().and_then(|n| n.to_str())
    {
        bail!("Managed installation identity mismatch.");
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("powershell.exe");
        c.creation_flags(0x08000000);
        c.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(directory.join("startup.ps1"))
        .args(["-Action", action, "-Executable"])
        .arg(&executable);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut c = Command::new("/bin/bash");
        c.arg(directory.join("startup.sh"))
            .arg(action)
            .arg(&executable);
        c
    };
    run_startup_helper(&mut command, std::time::Duration::from_secs(15))
}

fn run_startup_helper(command: &mut Command, timeout: std::time::Duration) -> Result<bool> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(std::time::Duration::from_millis(20))
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                if let Err(error) = result {
                    return Err(error.into());
                }
                bail!("Login startup operation timed out.");
            }
        }
    }
    let output = child.wait_with_output()?;
    if !output.status.success() {
        bail!("Login startup operation failed.");
    }
    match String::from_utf8_lossy(&output.stdout).trim() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => bail!("Invalid login startup response."),
    }
}
pub fn launch_at_login() -> Result<bool> {
    managed_startup("query")
}
pub fn set_launch_at_login(enabled: bool) -> Result<bool> {
    let actual = managed_startup(if enabled { "on" } else { "off" })?;
    if actual != enabled {
        bail!("Login startup verification failed.");
    }
    Ok(actual)
}

#[cfg(test)]
mod startup_tests {
    use super::*;
    #[test]
    fn rejects_failed_invalid_and_stuck_helpers() {
        #[cfg(windows)]
        let scripts = ["exit 1", "Write-Output invalid", "while ($true) {}"];
        #[cfg(not(windows))]
        let scripts = ["exit 1", "echo invalid", "while :; do :; done"];
        for (index, script) in scripts.into_iter().enumerate() {
            #[cfg(windows)]
            let mut command = {
                use std::os::windows::process::CommandExt;
                let mut c = Command::new("powershell.exe");
                c.creation_flags(0x08000000).args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    script,
                ]);
                c
            };
            #[cfg(not(windows))]
            let mut command = {
                let mut c = Command::new("/bin/bash");
                c.args(["-c", script]);
                c
            };
            let timeout = std::time::Duration::from_millis(if index == 2 { 200 } else { 5000 });
            let error = run_startup_helper(&mut command, timeout)
                .unwrap_err()
                .to_string();
            assert!(
                error.contains(["failed", "Invalid", "timed out"][index]),
                "{error}"
            );
        }
    }
    #[test]
    fn calls_installed_helper_and_rejects_foreign_manifest() {
        let root = tempfile::tempdir().unwrap();
        let parent = root.path().join("설치 App/MacOS");
        std::fs::create_dir_all(&parent).unwrap();
        let executable = parent.join("Synthetic App.exe");
        let directory = if cfg!(target_os = "macos") {
            parent.join("../Resources")
        } else {
            parent
        };
        std::fs::create_dir_all(&directory).unwrap();
        let manifest = directory.join("install-info.json");
        std::fs::write(&manifest, "\u{feff}{\"schemaVersion\":1,\"appId\":\"llm-usage-monitor\",\"variant\":\"rust\",\"executable\":\"Synthetic App.exe\"}").unwrap();
        #[cfg(windows)]
        std::fs::write(directory.join("startup.ps1"), "param($Action,$Executable)\nif ($Executable -notlike '*Synthetic App.exe') { throw 'Wrong executable' }; if ($Action -eq 'on') { 'true' } else { 'false' }").unwrap();
        #[cfg(not(windows))]
        std::fs::write(directory.join("startup.sh"), "#!/bin/bash\ncase \"$2\" in *\"Synthetic App.exe\") ;; *) exit 1;; esac\nif [ \"$1\" = on ]; then echo true; else echo false; fi\n").unwrap();
        assert!(!managed_startup_at("query", &executable).unwrap());
        assert!(managed_startup_at("on", &executable).unwrap());
        assert!(!managed_startup_at("off", &executable).unwrap());
        std::fs::write(manifest, "{\"variant\":\"node\"}").unwrap();
        assert!(managed_startup_at("on", &executable).is_err());
    }
}
