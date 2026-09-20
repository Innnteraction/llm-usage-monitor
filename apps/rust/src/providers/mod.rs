pub mod antigravity;
pub mod claude;
pub mod codex;

pub use antigravity::AntigravityProvider;
pub use claude::ClaudeProvider;
pub use codex::CodexProvider;

/// Background collection must never create a Windows console window.
fn background_command(program: &str) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command.kill_on_drop(true);
    command
}
