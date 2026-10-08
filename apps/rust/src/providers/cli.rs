use std::{
    env,
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
};

/// An app-local executable selection and the environment needed by its wrappers.
/// Never changes the user's shell or the parent process environment.
pub struct CliCommand {
    pub program: PathBuf,
    pub path: OsString,
}

impl CliCommand {
    pub fn new(program: impl AsRef<OsStr>) -> Self {
        let fallback = mac_fallback_directories();
        Self::resolve(program.as_ref(), env::var_os("PATH").as_deref(), &fallback)
    }

    fn resolve(program: &OsStr, current_path: Option<&OsStr>, fallback: &[PathBuf]) -> Self {
        let requested = Path::new(program);
        let mut directories: Vec<PathBuf> = current_path
            .map(env::split_paths)
            .into_iter()
            .flatten()
            .collect();
        let explicit = requested.is_absolute() || requested.components().count() > 1;
        let selected = if explicit {
            // A broken explicit override must not select a different installation.
            requested.to_path_buf()
        } else {
            directories
                .iter()
                .chain(fallback)
                .map(|dir| dir.join(requested))
                .find(|file| executable_file(file))
                .unwrap_or_else(|| requested.to_path_buf())
        };
        if let Some(parent) = selected.parent().filter(|p| !p.as_os_str().is_empty()) {
            append_directory(&mut directories, parent.to_path_buf());
        }
        for dir in fallback {
            append_directory(&mut directories, dir.clone());
        }
        Self {
            program: selected,
            path: env::join_paths(directories)
                .unwrap_or_else(|_| current_path.unwrap_or_default().to_os_string()),
        }
    }
}

fn append_directory(directories: &mut Vec<PathBuf>, directory: PathBuf) {
    if !directories.contains(&directory) {
        directories.push(directory);
    }
}

fn executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn mac_fallback_directories() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let mut directories = vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/opt/homebrew/sbin"),
            PathBuf::from("/usr/local/bin"),
        ];
        if let Some(home) = dirs::home_dir() {
            directories.push(home.join(".local/bin"));
            directories.push(home.join(".cargo/bin"));
        }
        directories
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt, process::Command};

    fn executable(dir: &Path, name: &str, source: &str) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, source).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn gui_path_resolves_all_providers_and_wrapper_runtime() {
        let root = tempfile::tempdir().unwrap();
        let homebrew = root.path().join("Homebrew bin");
        let local = root.path().join("local bin");
        executable(&homebrew, "node", "#!/bin/sh\nexit 0\n");
        executable(&homebrew, "codex", "#!/usr/bin/env node\n");
        for name in ["claude", "agy"] {
            executable(&local, name, "#!/bin/sh\nexit 0\n");
        }
        for name in ["codex", "claude", "agy"] {
            let cli = CliCommand::resolve(
                OsStr::new(name),
                Some(OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin")),
                &[homebrew.clone(), local.clone()],
            );
            assert!(cli.program.is_absolute());
            assert!(Command::new(&cli.program)
                .env("PATH", &cli.path)
                .status()
                .unwrap()
                .success());
        }
    }

    #[test]
    fn preserves_path_priority_and_explicit_override_without_fallback() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first");
        let second = root.path().join("second");
        let expected = executable(&first, "claude", "#!/bin/sh\nexit 0\n");
        executable(&second, "claude", "#!/bin/sh\nexit 0\n");
        let path = env::join_paths([&first]).unwrap();
        let cli = CliCommand::resolve(OsStr::new("claude"), Some(&path), &[second.clone()]);
        assert_eq!(cli.program, expected);
        assert_eq!(
            env::split_paths(&cli.path).collect::<Vec<_>>(),
            [first, second.clone()]
        );
        let missing = root.path().join("missing/claude");
        let cli = CliCommand::resolve(missing.as_os_str(), Some(&path), &[second]);
        assert_eq!(cli.program, missing);
        assert!(Command::new(cli.program).spawn().is_err());
    }

    #[test]
    fn rejects_directories_and_non_executable_files_and_deduplicates_fallbacks() {
        let root = tempfile::tempdir().unwrap();
        let invalid = root.path().join("invalid");
        fs::create_dir_all(invalid.join("claude")).unwrap();
        fs::write(invalid.join("codex"), "not executable").unwrap();
        let valid = root.path().join("valid");
        for name in ["claude", "codex"] {
            let expected = executable(&valid, name, "#!/bin/sh\nexit 0\n");
            let path = env::join_paths([&invalid]).unwrap();
            let cli = CliCommand::resolve(
                OsStr::new(name),
                Some(&path),
                &[valid.clone(), valid.clone()],
            );
            assert_eq!(cli.program, expected);
            assert_eq!(env::split_paths(&cli.path).count(), 2);
        }
        let cli = CliCommand::resolve(OsStr::new("missing"), None, &[]);
        assert_eq!(cli.program, Path::new("missing"));
    }
}
