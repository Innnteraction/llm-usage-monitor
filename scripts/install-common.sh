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
