//! OS 명령은 UI에서 분리한다. 인증은 벤더 터미널에만 위임한다.
use anyhow::{bail, Context, Result};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
};

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

#[cfg(target_os = "windows")]
fn registry_command() -> Command {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new("reg.exe");
    command.creation_flags(0x08000000);
    command
}
#[cfg(target_os = "windows")]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const STARTUP_NAME: &str = "LLM Usage Monitor Native";
pub fn launch_at_login() -> Result<bool> {
    #[cfg(target_os = "windows")]
    {
        let output = registry_command()
            .args(["query", RUN_KEY, "/v", STARTUP_NAME])
            .output()?;
        return Ok(output.status.success());
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .args([
                "-e",
                &format!(
                    "tell application \"System Events\" to exists login item \"{STARTUP_NAME}\""
                ),
            ])
            .output()?;
        if !output.status.success() {
            bail!("login item read failed");
        }
        return Ok(String::from_utf8_lossy(&output.stdout).trim() == "true");
    }
    #[allow(unreachable_code)]
    Err(anyhow::anyhow!("unsupported platform"))
}
pub fn set_launch_at_login(enabled: bool) -> Result<bool> {
    let executable = std::env::current_exe()?;
    #[cfg(target_os = "windows")]
    {
        let mut command = registry_command();
        if enabled {
            command
                .args(["add", RUN_KEY, "/v", STARTUP_NAME, "/t", "REG_SZ", "/d"])
                .arg(format!("\"{}\" --start-hidden", executable.display()))
                .arg("/f");
        } else {
            if !launch_at_login()? {
                return Ok(false);
            }
            command.args(["delete", RUN_KEY, "/v", STARTUP_NAME, "/f"]);
        }
        if !command
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?
            .success()
        {
            bail!("login item update failed");
        }
    }
    #[cfg(target_os = "macos")]
    {
        let path = executable
            .to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let script = if enabled {
            format!("tell application \"System Events\" to if not (exists login item \"{STARTUP_NAME}\") then make login item at end with properties {{name:\"{STARTUP_NAME}\",path:\"{path}\",hidden:true}}")
        } else {
            format!("tell application \"System Events\" to if exists login item \"{STARTUP_NAME}\" then delete login item \"{STARTUP_NAME}\"")
        };
        if !Command::new("osascript")
            .args(["-e", &script])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?
            .success()
        {
            bail!("login item update failed");
        }
    }
    let actual = launch_at_login()?;
    if actual != enabled {
        bail!("login item verification failed");
    }
    Ok(actual)
}
