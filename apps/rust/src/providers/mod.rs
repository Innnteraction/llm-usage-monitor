pub mod antigravity;
pub mod claude;
pub mod codex;
mod cli;

pub use antigravity::AntigravityProvider;
pub use claude::ClaudeProvider;
pub use codex::CodexProvider;
pub use cli::CliCommand;

use std::env;
use std::path::{Path, PathBuf};

pub(crate) fn resolve_claude_probe_dir() -> PathBuf {
    if let Ok(dir) = env::var("CLAUDE_PROBE_DIRECTORY") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let base = dirs::data_local_dir().unwrap_or_else(env::temp_dir);
    base.join("LLM Usage Monitor").join("claude-probe")
}

pub(crate) fn executable_candidates(name: &str, is_windows: bool) -> Vec<String> {
    let base = if name == "antigravity" { "agy" } else { name };
    if is_windows {
        if base
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(base)
            .contains('.')
        {
            return vec![base.to_string()];
        }
        vec![
            format!("{base}.exe"),
            format!("{base}.cmd"),
            format!("{base}.bat"),
            base.to_string(),
        ]
    } else {
        vec![base.to_string()]
    }
}

pub(crate) fn platform_fallback_directories<F>(
    is_windows: bool,
    is_macos: bool,
    get_env: F,
) -> Vec<PathBuf>
where
    F: Fn(&str) -> Option<String>,
{
    let non_empty = |key: &str| {
        get_env(key)
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    let mut dirs = Vec::new();
    if is_windows {
        if let Some(local) = non_empty("LOCALAPPDATA") {
            dirs.push(local.join("Programs").join("OpenAI").join("Codex").join("bin"));
            dirs.push(local.join("Programs").join("Codex").join("bin"));
        }
        if let Some(pf) = non_empty("ProgramFiles") {
            dirs.push(pf.join("OpenAI").join("Codex").join("bin"));
        }
        if let Some(profile) = non_empty("USERPROFILE") {
            dirs.push(
                profile
                    .join(".codex")
                    .join("packages")
                    .join("standalone")
                    .join("current")
                    .join("bin"),
            );
        }
        if let Some(local) = non_empty("LOCALAPPDATA") {
            dirs.push(local.join("pnpm"));
        }
        if let Some(appdata) = non_empty("APPDATA") {
            dirs.push(appdata.join("npm"));
        }
        if let Some(profile) = non_empty("USERPROFILE") {
            dirs.push(profile.join(".local").join("bin"));
        }
        if let Some(local) = non_empty("LOCALAPPDATA") {
            dirs.push(local.join("agy").join("bin"));
            dirs.push(local.join("Programs").join("Antigravity").join("bin"));
        }
        if let Some(profile) = non_empty("USERPROFILE") {
            dirs.push(profile.join(".gemini").join("antigravity-cli").join("bin"));
            dirs.push(profile.join("scoop").join("shims"));
        }
    } else if is_macos {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/opt/homebrew/sbin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        if let Some(home) = non_empty("HOME") {
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join(".cargo").join("bin"));
        }
    }
    dirs
}

pub(crate) fn find_cli_binary_in_dirs<F>(
    name: &str,
    is_windows: bool,
    search_dirs: &[PathBuf],
    is_file: F,
) -> Option<PathBuf>
where
    F: Fn(&Path) -> bool,
{
    let candidates = executable_candidates(name, is_windows);
    for dir in search_dirs {
        for candidate in &candidates {
            let full = dir.join(candidate);
            if is_file(&full) {
                return Some(full);
            }
        }
    }
    None
}

pub(crate) fn resolve_cli_binary(name: &str, env_override: Option<&str>) -> String {
    if let Some(var) = env_override {
        if let Ok(val) = env::var(var) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    resolve_command_path(name)
}

pub(crate) fn resolve_command_path(command: &str) -> String {
    let path = Path::new(command);
    if path.components().count() > 1 {
        return command.to_string();
    }
    let is_windows = cfg!(windows);
    let is_macos = cfg!(target_os = "macos");
    let mut search_dirs: Vec<PathBuf> = env::var_os("PATH")
        .map(|paths| env::split_paths(&paths).collect())
        .unwrap_or_default();
    search_dirs.extend(platform_fallback_directories(is_windows, is_macos, |k| {
        env::var(k).ok()
    }));
    find_cli_binary_in_dirs(command, is_windows, &search_dirs, |p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| {
            if command == "antigravity" {
                "agy".to_string()
            } else {
                command.to_string()
            }
        })
}

/// Background collection must never create a Windows console window.
fn background_command(program: &str) -> tokio::process::Command {
    let resolved = resolve_command_path(program);
    let cli = CliCommand::new(&resolved);
    let mut command = tokio::process::Command::new(&cli.program);
    command.env("PATH", &cli.path);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let probe_dir = resolve_claude_probe_dir();
    if std::fs::create_dir_all(&probe_dir).is_ok() {
        command.current_dir(probe_dir);
    }
    command.kill_on_drop(true);
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_candidates_prefer_exe_over_batch_wrappers() {
        assert_eq!(
            executable_candidates("claude", true),
            vec!["claude.exe", "claude.cmd", "claude.bat", "claude"]
        );
        assert_eq!(
            executable_candidates("antigravity", true),
            vec!["agy.exe", "agy.cmd", "agy.bat", "agy"]
        );
        assert_eq!(
            executable_candidates("codex", true),
            vec!["codex.exe", "codex.cmd", "codex.bat", "codex"]
        );
        assert_eq!(executable_candidates("claude", false), vec!["claude"]);
    }

    #[test]
    fn binary_search_prefers_exe_in_same_directory_and_falls_back_across_dirs() {
        let dir1 = PathBuf::from("C:/bin1");
        let dir2 = PathBuf::from("C:/bin2");
        let found = find_cli_binary_in_dirs(
            "claude",
            true,
            &[dir1.clone(), dir2.clone()],
            |path| path == dir1.join("claude.cmd") || path == dir1.join("claude.exe"),
        );
        assert_eq!(found, Some(dir1.join("claude.exe")));

        let fallback = find_cli_binary_in_dirs(
            "codex",
            true,
            &[dir1, dir2.clone()],
            |path| path == dir2.join("codex.exe"),
        );
        assert_eq!(fallback, Some(dir2.join("codex.exe")));
    }
}
