pub mod antigravity;
pub mod claude;
pub mod codex;
mod cli;

pub use antigravity::AntigravityProvider;
pub use claude::ClaudeProvider;
pub use codex::CodexProvider;
pub use cli::CliCommand;

/// Background collection must never create a Windows console window.
fn background_command(program: &str) -> tokio::process::Command {
    let cli = CliCommand::new(program);
    let mut command = tokio::process::Command::new(cli.program);
    command.env("PATH", cli.path);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command.kill_on_drop(true);
    command
}
