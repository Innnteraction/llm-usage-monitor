#!/usr/bin/env bash
# Sourced by install.sh; Bash 3.2 compatible (macOS system Bash).
tool_version() { command -v "$1" >/dev/null 2>&1 && "$1" --version 2>/dev/null | head -n 1 || true; }
confirm_action() {
  printf '%s\n' "$1"
  [ "$2" = true ] && return 0
  if [ "$non_interactive" = true ] || [ ! -t 0 ]; then echo 'Explicit consent required; use --accept-install / --accept-dependencies.' >&2; return 1; fi
  printf 'Type yes to agree: '; IFS= read -r reply
  [ "$reply" = yes ] || { echo 'Cancelled.' >&2; return 1; }
}
inspect_environment() {
  node_version="$(tool_version node)"; pnpm_version="$(tool_version pnpm)"
  node_needs=''; rust_needs=''
  case "$node_version" in v24.*) ;; *) node_needs='Node.js 24 (Homebrew node@24)';; esac
  [ "$pnpm_version" = "$required_pnpm" ] || node_needs="$node_needs pnpm $required_pnpm (npm registry)"
  command -v rustup >/dev/null 2>&1 || rust_needs='rustup (rust-lang.org)'
  command -v cargo >/dev/null 2>&1 || rust_needs="$rust_needs Rust stable / Cargo"
  if ! xcrun --find metal >/dev/null 2>&1; then rust_needs="$rust_needs Xcode + Metal toolchain (Apple)"; fi
  printf '%s\n' 'Node / Electron: simpler build preparation; bundles a web runtime.' 'Rust / GPUI: Rust + C++/SDK tools; larger initial build preparation.' 'Rust is expected to use less runtime memory; no verified comparative percentage is promised.' 'macOS live UI/login and complete visual parity still require manual verification.'
  printf 'Node missing: %s\nRust missing: %s\n' "${node_needs:-ready}" "${rust_needs:-ready}"
}
install_dependencies() {
  if [ "$variant" = node ]; then
    [ -z "$node_needs" ] || confirm_action "Install: $node_needs. Official npm/Homebrew sources; admin access may be required." "$accept_dependencies"
    case "$node_version" in
      v24.*) ;;
      '')
        if ! command -v brew >/dev/null 2>&1; then
          confirm_action 'Install Homebrew from github.com/Homebrew/install (administrator password may be required).' "$accept_dependencies"
          local bootstrap
          bootstrap="$(mktemp -t llm-homebrew)"
          curl --fail --location --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$bootstrap"
          /bin/bash "$bootstrap"; rm -f "$bootstrap"
          if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; else eval "$(/usr/local/bin/brew shellenv)"; fi
        fi
        brew install node@24
        export PATH="$(brew --prefix node@24)/bin:$PATH"
        ;;
      *) echo 'Existing Node is preserved. Select Node 24 in PATH and rerun: https://nodejs.org/en/download' >&2; return 1;;
    esac
    case "$(tool_version node)" in v24.*) ;; *) echo 'Node 24 verification failed.' >&2; return 1;; esac
    if [ "$(tool_version pnpm)" != "$required_pnpm" ]; then
      local tool_dir="$HOME/Library/Application Support/llm-usage-monitor/build-tools/pnpm-$required_pnpm"
      npm install --prefix "$tool_dir" --no-audit --no-fund "pnpm@$required_pnpm"
      export PATH="$tool_dir/node_modules/.bin:$PATH"
    fi
    [ "$(tool_version pnpm)" = "$required_pnpm" ] || return 1
  else
    [ -z "$rust_needs" ] || confirm_action "Install: $rust_needs. Rust official distribution; Apple setup may require user interaction." "$accept_dependencies"
    if ! xcrun --find metal >/dev/null 2>&1; then
      echo 'Install full Xcode from Apple, select its developer directory and complete first launch/license/Metal setup, then rerun. CLI tools alone may not provide Metal.' >&2
      open 'macappstore://itunes.apple.com/app/id497799835'
      return 1
    fi
    if ! command -v rustup >/dev/null 2>&1; then
      local bootstrap
      bootstrap="$(mktemp -t llm-rustup)"
      curl --fail --location --proto '=https' --tlsv1.2 https://sh.rustup.rs -o "$bootstrap"
      sh "$bootstrap" -y --default-toolchain none --no-modify-path
      rm -f "$bootstrap"
      export PATH="$HOME/.cargo/bin:$PATH"
    fi
    if ! rustup run stable cargo --version >/dev/null 2>&1; then
      confirm_action 'Install Rust stable (existing global default is preserved).' "$accept_dependencies"
      rustup toolchain install stable --profile minimal
    fi
    rustup run stable cargo --version
  fi
}
build_selected_app() {
  cd "$project_root"
  if [ "$variant" = node ]; then
    pnpm install --frozen-lockfile
    node scripts/package-install.mjs
    local arch
    arch="$(node -p 'process.arch')"
    built_app="$project_root/out/install-build/LLM Usage Monitor-darwin-$arch/LLM Usage Monitor.app"
  else
    rustup run stable cargo build --locked --release --bin llm-usage-monitor
    built_app="$project_root/target/release/llm-usage-monitor"
  fi
  [ -e "$built_app" ] || { echo 'Build artifact missing.' >&2; return 1; }
}
