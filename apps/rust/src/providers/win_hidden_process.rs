use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::FromRawHandle;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::io::{DuplexStream, duplex};
use windows::core::{PCWSTR, PWSTR, w};
use windows::Win32::Foundation::{
    CloseHandle, ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, HANDLE, HANDLE_FLAG_INHERIT,
    HANDLE_FLAGS, INVALID_HANDLE_VALUE, SetHandleInformation, WAIT_OBJECT_0,
};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::StationsAndDesktops::{
    CreateDesktopW, DESKTOP_CONTROL_FLAGS, HDESK,
};
use windows::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessW, GetExitCodeProcess,
    PROCESS_INFORMATION, STARTF_USESHOWWINDOW, STARTF_USESTDHANDLES, STARTUPINFOW,
    TerminateProcess, WaitForSingleObject,
};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

const DESKTOP_ALL_ACCESS: u32 = 0x000F_01FF;
const GENERIC_READ_WRITE: u32 = 0x8000_0000 | 0x4000_0000;

struct HiddenDesktop {
    _handle: HDESK,
    name_wide: Vec<u16>,
}

unsafe impl Send for HiddenDesktop {}
unsafe impl Sync for HiddenDesktop {}

static HIDDEN_DESKTOP: OnceLock<Option<HiddenDesktop>> = OnceLock::new();

/// Returns a null-terminated UTF-16 name of an app-private hidden Win32 desktop.
/// Child processes spawned with `lpDesktop` set to this desktop cannot flash
/// console or GUI windows onto the user's interactive desktop.
pub(crate) fn hidden_desktop_wide() -> Option<&'static [u16]> {
    HIDDEN_DESKTOP
        .get_or_init(|| {
            let name = format!("llm-usage-monitor-bg-{}", std::process::id());
            let mut name_wide: Vec<u16> = name.encode_utf16().collect();
            name_wide.push(0);
            let hdesk = unsafe {
                CreateDesktopW(
                    PCWSTR(name_wide.as_ptr()),
                    PCWSTR::null(),
                    None,
                    DESKTOP_CONTROL_FLAGS(0),
                    DESKTOP_ALL_ACCESS,
                    None,
                )
            };
            match hdesk {
                Ok(handle) if !handle.is_invalid() => Some(HiddenDesktop {
                    _handle: handle,
                    name_wide,
                }),
                _ => None,
            }
        })
        .as_ref()
        .map(|d| d.name_wide.as_slice())
}

pub(crate) fn hidden_desktop_ptr() -> PCWSTR {
    hidden_desktop_wide()
        .map(|w| PCWSTR(w.as_ptr()))
        .unwrap_or(PCWSTR::null())
}

pub(crate) fn append_quoted_wide(arg: &OsStr, cmdline: &mut Vec<u16>) {
    let wide: Vec<u16> = arg.encode_wide().collect();
    let needs_quotes = wide.is_empty()
        || wide
            .iter()
            .any(|&c| c == b' ' as u16 || c == b'\t' as u16 || c == b'\n' as u16 || c == b'"' as u16);
    if !needs_quotes {
        cmdline.extend_from_slice(&wide);
        return;
    }
    cmdline.push(b'"' as u16);
    let mut i = 0;
    while i < wide.len() {
        let mut backslashes = 0;
        while i < wide.len() && wide[i] == b'\\' as u16 {
            i += 1;
            backslashes += 1;
        }
        if i == wide.len() {
            cmdline.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2));
            break;
        } else if wide[i] == b'"' as u16 {
            cmdline.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2 + 1));
            cmdline.push(b'"' as u16);
        } else {
            cmdline.extend(std::iter::repeat_n(b'\\' as u16, backslashes));
            cmdline.push(wide[i]);
        }
        i += 1;
    }
    cmdline.push(b'"' as u16);
}

pub(crate) fn build_command_line(command: &OsStr, args: &[&str]) -> Vec<u16> {
    let command_str = command.to_string_lossy();
    let file_lower = command_str
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&command_str)
        .to_ascii_lowercase();
    let is_batch = file_lower.ends_with(".cmd") || file_lower.ends_with(".bat");

    let mut cmdline = Vec::<u16>::new();
    if is_batch {
        let comspec = std::env::var_os("ComSpec")
            .unwrap_or_else(|| OsString::from("cmd.exe"));
        append_quoted_wide(&comspec, &mut cmdline);
        cmdline.extend("/d /s /c \"".encode_utf16());
        append_quoted_wide(command, &mut cmdline);
        for arg in args {
            cmdline.push(b' ' as u16);
            append_quoted_wide(OsStr::new(arg), &mut cmdline);
        }
        cmdline.push(b'"' as u16);
    } else {
        append_quoted_wide(command, &mut cmdline);
        for arg in args {
            cmdline.push(b' ' as u16);
            append_quoted_wide(OsStr::new(arg), &mut cmdline);
        }
    }
    cmdline.push(0);
    cmdline
}

pub(crate) fn build_environment_block(
    path_override: Option<&OsStr>,
    extra: &[(&str, &str)],
    remove: &[&str],
) -> Vec<u16> {
    let mut vars: BTreeMap<String, (OsString, OsString)> = BTreeMap::new();
    for (k, v) in std::env::vars_os() {
        let upper = k.to_string_lossy().to_uppercase();
        if remove.iter().any(|r| r.eq_ignore_ascii_case(&upper)) {
            continue;
        }
        vars.insert(upper, (k, v));
    }
    if let Some(path_val) = path_override {
        vars.insert(
            "PATH".to_string(),
            (OsString::from("PATH"), path_val.to_os_string()),
        );
    }
    for (k, v) in extra {
        vars.insert(
            k.to_uppercase(),
            (OsString::from(k), OsString::from(v)),
        );
    }
    let mut block = Vec::new();
    for (_, (k, v)) in vars {
        block.extend(k.encode_wide());
        block.push(b'=' as u16);
        block.extend(v.encode_wide());
        block.push(0);
    }
    block.push(0);
    block
}

pub(crate) struct HiddenJobProcess {
    job: HANDLE,
    process: HANDLE,
}

unsafe impl Send for HiddenJobProcess {}
unsafe impl Sync for HiddenJobProcess {}

impl HiddenJobProcess {
    pub(crate) fn kill(&self) {
        unsafe {
            if !self.process.is_invalid() {
                let _ = TerminateProcess(self.process, 1);
            }
        }
    }
}

impl Drop for HiddenJobProcess {
    fn drop(&mut self) {
        unsafe {
            if !self.process.is_invalid() {
                let _ = TerminateProcess(self.process, 1);
            }
            if !self.job.is_invalid() {
                let _ = CloseHandle(self.job);
            }
            if !self.process.is_invalid() {
                let _ = CloseHandle(self.process);
            }
        }
    }
}

pub(crate) struct HiddenOutput {
    pub(crate) success: bool,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

pub(crate) enum HiddenExecError {
    NotInstalled,
    TimedOut,
    Failed,
}

fn create_kill_on_close_job() -> HANDLE {
    unsafe {
        let job = CreateJobObjectW(None, None).unwrap_or(INVALID_HANDLE_VALUE);
        if !job.is_invalid() {
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let _ = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
        }
        job
    }
}

fn create_inheritable_pipe() -> io::Result<(HANDLE, HANDLE)> {
    unsafe {
        let mut read = INVALID_HANDLE_VALUE;
        let mut write = INVALID_HANDLE_VALUE;
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: true.into(),
        };
        CreatePipe(&mut read, &mut write, Some(&sa), 0)
            .map_err(|e| io::Error::from_raw_os_error(e.code().0))?;
        Ok((read, write))
    }
}

fn open_nul_inheritable() -> io::Result<HANDLE> {
    unsafe {
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: true.into(),
        };
        CreateFileW(
            w!("NUL"),
            GENERIC_READ_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            Some(&sa),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
        .map_err(|e| io::Error::from_raw_os_error(e.code().0))
    }
}

fn spawn_raw_hidden(
    program: &OsStr,
    args: &[&str],
    cwd: &Path,
    env_path: &OsStr,
    pipe_stdin: bool,
    pipe_stderr: bool,
) -> Result<(HiddenJobProcess, Option<File>, File, Option<File>), HiddenExecError> {
    unsafe {
        let nul_in = if !pipe_stdin {
            Some(open_nul_inheritable().map_err(|_| HiddenExecError::Failed)?)
        } else {
            None
        };
        let (stdin_read, stdin_write) = if pipe_stdin {
            let (r, w) = create_inheritable_pipe().map_err(|_| {
                if let Some(n) = nul_in {
                    let _ = CloseHandle(n);
                }
                HiddenExecError::Failed
            })?;
            let _ = SetHandleInformation(w, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0));
            (r, Some(w))
        } else {
            (nul_in.unwrap(), None)
        };

        let (stdout_read, stdout_write) = create_inheritable_pipe().map_err(|_| {
            let _ = CloseHandle(stdin_read);
            if let Some(w) = stdin_write {
                let _ = CloseHandle(w);
            }
            HiddenExecError::Failed
        })?;
        let _ = SetHandleInformation(stdout_read, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0));

        let nul_err = if !pipe_stderr {
            open_nul_inheritable().ok()
        } else {
            None
        };
        let (stderr_read, stderr_write) = if pipe_stderr {
            let (r, w) = create_inheritable_pipe().map_err(|_| {
                let _ = CloseHandle(stdin_read);
                if let Some(w) = stdin_write {
                    let _ = CloseHandle(w);
                }
                let _ = CloseHandle(stdout_read);
                let _ = CloseHandle(stdout_write);
                HiddenExecError::Failed
            })?;
            let _ = SetHandleInformation(r, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0));
            (Some(r), w)
        } else {
            (None, nul_err.unwrap_or(INVALID_HANDLE_VALUE))
        };

        let job = create_kill_on_close_job();
        let mut cmdline = build_command_line(program, args);
        let mut env_block = build_environment_block(Some(env_path), &[], &[]);
        let cwd_wide: Option<Vec<u16>> = cwd.is_dir().then(|| {
            let mut v: Vec<u16> = cwd.as_os_str().encode_wide().collect();
            v.push(0);
            v
        });

        let si = STARTUPINFOW {
            cb: std::mem::size_of::<STARTUPINFOW>() as u32,
            lpDesktop: PWSTR(hidden_desktop_ptr().0.cast_mut()),
            dwFlags: STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW,
            wShowWindow: SW_HIDE.0 as u16,
            hStdInput: stdin_read,
            hStdOutput: stdout_write,
            hStdError: stderr_write,
            ..Default::default()
        };

        let mut pi = PROCESS_INFORMATION::default();
        let res = CreateProcessW(
            PCWSTR::null(),
            Some(PWSTR(cmdline.as_mut_ptr())),
            None,
            None,
            true,
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            Some(env_block.as_mut_ptr().cast()),
            cwd_wide
                .as_ref()
                .map(|c| PCWSTR(c.as_ptr()))
                .unwrap_or(PCWSTR::null()),
            &si,
            &mut pi,
        );

        let _ = CloseHandle(stdin_read);
        let _ = CloseHandle(stdout_write);
        if !stderr_write.is_invalid() {
            let _ = CloseHandle(stderr_write);
        }

        if let Err(err) = res {
            if let Some(w) = stdin_write {
                let _ = CloseHandle(w);
            }
            let _ = CloseHandle(stdout_read);
            if let Some(r) = stderr_read {
                let _ = CloseHandle(r);
            }
            if !job.is_invalid() {
                let _ = CloseHandle(job);
            }
            let win_err = err.code().0 as u32 & 0xFFFF;
            if win_err == ERROR_FILE_NOT_FOUND.0 || win_err == ERROR_PATH_NOT_FOUND.0 {
                return Err(HiddenExecError::NotInstalled);
            }
            return Err(HiddenExecError::Failed);
        }

        let _ = CloseHandle(pi.hThread);
        if !job.is_invalid() {
            let _ = AssignProcessToJobObject(job, pi.hProcess);
        }

        let guard = HiddenJobProcess {
            job,
            process: pi.hProcess,
        };
        let stdin_file = stdin_write.map(|h| File::from_raw_handle(h.0 as _));
        let stdout_file = File::from_raw_handle(stdout_read.0 as _);
        let stderr_file = stderr_read.map(|h| File::from_raw_handle(h.0 as _));
        Ok((guard, stdin_file, stdout_file, stderr_file))
    }
}

pub(crate) async fn run_hidden_output(
    program: OsString,
    args: Vec<String>,
    cwd: std::path::PathBuf,
    env_path: OsString,
    timeout: Duration,
    capture_stderr: bool,
) -> Result<HiddenOutput, HiddenExecError> {
    tokio::task::spawn_blocking(move || {
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let (guard, _stdin, mut stdout_file, stderr_opt) =
            spawn_raw_hidden(&program, &arg_refs, &cwd, &env_path, false, capture_stderr)?;

        let stdout_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stdout_file.read_to_end(&mut buf);
            buf
        });
        let stderr_thread = stderr_opt.map(|mut f| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = f.read_to_end(&mut buf);
                buf
            })
        });

        let wait_ms = timeout.as_millis().min(u32::MAX as u128) as u32;
        let waited = unsafe { WaitForSingleObject(guard.process, wait_ms) };
        if waited != WAIT_OBJECT_0 {
            guard.kill();
            drop(guard);
            let _ = stdout_thread.join();
            if let Some(t) = stderr_thread {
                let _ = t.join();
            }
            return Err(HiddenExecError::TimedOut);
        }

        let mut exit_code: u32 = 1;
        unsafe {
            let _ = GetExitCodeProcess(guard.process, &mut exit_code);
        }
        let stdout = stdout_thread.join().unwrap_or_default();
        let stderr = stderr_thread
            .map(|t| t.join().unwrap_or_default())
            .unwrap_or_default();
        Ok(HiddenOutput {
            success: exit_code == 0,
            stdout,
            stderr,
        })
    })
    .await
    .map_err(|_| HiddenExecError::Failed)?
}

pub(crate) struct HiddenStdioChild {
    guard: Arc<HiddenJobProcess>,
}

impl HiddenStdioChild {
    pub(crate) fn kill(&self) {
        self.guard.kill();
    }
}

pub(crate) fn spawn_hidden_stdio(
    program: &OsStr,
    args: &[&str],
    cwd: &Path,
    env_path: &OsStr,
) -> Result<(HiddenStdioChild, DuplexStream, DuplexStream), HiddenExecError> {
    let (guard, stdin_opt, mut stdout_file, _stderr) =
        spawn_raw_hidden(program, args, cwd, env_path, true, false)?;
    let mut stdin_file = stdin_opt.expect("pipe_stdin was true");

    let (stdin_client, mut stdin_bridge) = duplex(64 * 1024);
    let (mut stdout_tx, stdout_rx) = duplex(64 * 1024);

    // Use a dedicated OS thread with std::sync::mpsc for stdin so we never block tokio workers.
    let (tx_bytes, rx_bytes) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        while let Ok(bytes) = rx_bytes.recv() {
            if stdin_file.write_all(&bytes).is_err() || stdin_file.flush().is_err() {
                break;
            }
        }
    });
    tokio::spawn(async move {
        use tokio::io::AsyncReadExt;
        let mut buf = [0u8; 8192];
        while let Ok(n) = stdin_bridge.read(&mut buf).await {
            if n == 0 {
                break;
            }
            if tx_bytes.send(buf[..n].to_vec()).is_err() {
                break;
            }
        }
    });

    // Dedicated OS thread for stdout reading -> mpsc -> tokio duplex writer.
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(32);
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match stdout_file.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if out_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        while let Some(chunk) = out_rx.recv().await {
            if stdout_tx.write_all(&chunk).await.is_err() {
                break;
            }
        }
    });

    Ok((
        HiddenStdioChild {
            guard: Arc::new(guard),
        },
        stdin_client,
        stdout_rx,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn hidden_desktop_runs_command_without_window_and_captures_output() {
        let temp = tempfile::tempdir().unwrap();
        let path_env = std::env::var_os("PATH").unwrap_or_default();
        let out = run_hidden_output(
            OsString::from("cmd.exe"),
            vec!["/d".into(), "/s".into(), "/c".into(), "echo hidden-desktop-ok".into()],
            temp.path().to_path_buf(),
            path_env,
            Duration::from_secs(5),
            true,
        )
        .await;
        let out = match out {
            Ok(o) => o,
            Err(_) => panic!("hidden desktop command execution failed"),
        };
        assert!(out.success);
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("hidden-desktop-ok"));
    }
}
