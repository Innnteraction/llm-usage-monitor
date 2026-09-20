#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
source "$script_dir/install-common.sh"
variant=''; check=false; non_interactive=false; accept_install=false; accept_dependencies=false
autostart=preserve; no_start=false; uninstall=false
while [ $# -gt 0 ]; do
  case "$1" in
    --variant) variant="${2:?node (n) or rust (r) required}"; shift;;
    --check) check=true;; --non-interactive) non_interactive=true;;
    --accept-install) accept_install=true;; --accept-dependencies) accept_dependencies=true;;
    --autostart) autostart="${2:?on, off or preserve required}"; shift;;
    --no-start) no_start=true;; --uninstall) uninstall=true;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
  shift
done
[ "$(uname -s)" = Darwin ] || { echo 'Only macOS is supported by this script.' >&2; exit 2; }
case "$(uname -m)" in arm64|x86_64) ;; *) echo 'Unsupported CPU.' >&2; exit 2;; esac
case "$autostart" in preserve|on|off) ;; *) exit 2;; esac
required_pnpm="$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' "$project_root/apps/node/package.json")"
inspect_environment
[ "$check" = true ] && exit 0
if [ -z "$variant" ] && [ "$uninstall" = false ]; then
  if [ "$non_interactive" = true ] || [ ! -t 0 ]; then echo '--variant is required.' >&2; exit 2; fi
  printf 'Choose node (n) / rust (r), no default: '; IFS= read -r variant
fi
if [ -n "$variant" ]; then variant="$(resolve_variant "$variant")"; else [ "$uninstall" = true ] || exit 2; fi
install_parent="$HOME/Applications"
install_root="$install_parent/LLM Usage Monitor.app"
legacy_native="$install_parent/LLM Usage Monitor Native.app"
label=com.innnteraction.llm-usage-monitor
plist="$HOME/Library/LaunchAgents/$label.plist"
old_enabled=false
legacy_items="$(osascript "$script_dir/migrate-login-items.applescript" query)"
[ -z "$legacy_items" ] || old_enabled=true
if [ -f "$plist" ]; then
  old_target="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments' "$plist")"
  case "$old_target" in *"$install_root"*|*"$legacy_native"*) old_enabled=true;; *) echo 'Unrecognized startup entry; refusing to overwrite.' >&2; exit 1;; esac
fi
if [ "$autostart" = preserve ] && [ ! -e "$install_root" ] && [ ! -e "$legacy_native" ] && [ "$uninstall" = false ]; then
  if [ "$non_interactive" = true ] || [ ! -t 0 ]; then echo 'New installation requires --autostart on/off.' >&2; exit 2; fi
  printf 'Start at login? on / off: '; IFS= read -r autostart
  case "$autostart" in on|off) ;; *) exit 2;; esac
fi
enabled="$old_enabled"
[ "$autostart" != on ] || enabled=true
[ "$autostart" != off ] || enabled=false
confirm_action "Install/replace $variant at $install_root (uninstall=$uninstall). Known Native installation will be consolidated. UI preferences are not converted." "$accept_install"
for app_path in "$install_root" "$legacy_native"; do
  [ ! -L "$app_path" ] || { echo 'Symlink installation rejected.' >&2; exit 1; }
  if [ -e "$app_path" ]; then
    [ -f "$app_path/Contents/Info.plist" ] || { echo 'Unrecognized existing installation.' >&2; exit 1; }
    app_exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_path/Contents/Info.plist")"
    case "$app_exe" in 'LLM Usage Monitor'|'llm-usage-monitor') ;; *) echo 'Unrecognized existing app.' >&2; exit 1;; esac
    if lsof -t "$app_path/Contents/MacOS/$app_exe" >/dev/null 2>&1; then echo 'Quit the app from its tray menu and rerun.' >&2; exit 1; fi
  fi
done
if [ "$uninstall" = false ]; then install_dependencies; build_selected_app; fi
mkdir -p "$install_parent"
transaction="$(mktemp -d "$install_parent/.llm-install.XXXXXX")"
stage="$transaction/new.app"
committed=false; replaced=false
legacy_removed=false
rollback() {
  result=$?
  recovery_failed=false
  if [ "$committed" = false ] && [ "$replaced" = true ]; then
    rm -rf "$install_root" || recovery_failed=true
    if [ -d "$transaction/previous.app" ]; then mv "$transaction/previous.app" "$install_root" || recovery_failed=true; fi
    if [ -d "$transaction/native.app" ]; then mv "$transaction/native.app" "$legacy_native" || recovery_failed=true; fi
    if [ -f "$transaction/startup.plist" ]; then
      mkdir -p "$(dirname "$plist")" && cp "$transaction/startup.plist" "$plist" || recovery_failed=true
    else rm -f "$plist" || recovery_failed=true; fi
    if [ "$legacy_removed" = true ]; then
      while IFS="$(printf '\t')" read -r item_name item_path item_hidden; do
        [ -z "$item_name" ] || osascript "$script_dir/migrate-login-items.applescript" restore "$item_name" "$item_path" "$item_hidden" || recovery_failed=true
      done <<< "$legacy_items"
    fi
  fi
  if [ "$recovery_failed" = true ]; then
    echo "Recovery incomplete. Preserve and inspect backup: $transaction" >&2
    result=1
  else
    rm -rf "$transaction" || echo "Backup cleanup remains: $transaction" >&2
  fi
  exit "$result"
}
trap rollback EXIT
[ ! -f "$plist" ] || cp "$plist" "$transaction/startup.plist"
if [ "$uninstall" = false ]; then
  if [ "$variant" = node ]; then cp -R "$built_app" "$stage"; else
    mkdir -p "$stage/Contents/MacOS" "$stage/Contents/Resources"
    cp "$built_app" "$stage/Contents/MacOS/llm-usage-monitor"
    chmod +x "$stage/Contents/MacOS/llm-usage-monitor"
    cp "$project_root/assets/icons/app-icon.icns" "$stage/Contents/Resources/app-icon.icns"
    cat > "$stage/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>llm-usage-monitor</string><key>CFBundleIdentifier</key><string>com.innnteraction.llm-usage-monitor</string><key>CFBundleName</key><string>LLM Usage Monitor</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconFile</key><string>app-icon</string><key>LSUIElement</key><true/><key>NSAppleEventsUsageDescription</key><string>Open Terminal for vendor CLI sign-in and folder trust.</string></dict></plist>
EOF
  fi
  cp "$script_dir/startup.sh" "$stage/Contents/Resources/startup.sh"
  if [ "$variant" = node ]; then
  version="$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' "$project_root/apps/node/package.json" | head -n 1)"
  else
    version="$(sed -n 's/^version *= *"\([^"]*\)".*/\1/p' "$project_root/apps/rust/Cargo.toml" | head -n 1)"
  fi
  [ -n "$version" ] || { echo "Application version is missing." >&2; exit 1; }
  revision="$(git -C "$project_root" rev-parse --short HEAD 2>/dev/null || printf source-zip)"
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$stage/Contents/Info.plist")"
  printf '{"schemaVersion":1,"appId":"llm-usage-monitor","variant":"%s","version":"%s","revision":"%s","executable":"%s"}\n' "$variant" "$version" "$revision" "$executable" > "$stage/Contents/Resources/install-info.json"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$stage/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $version" "$stage/Contents/Info.plist"
  codesign --force --deep --sign - "$stage"
  codesign --verify --deep "$stage"
fi
# Recheck after a potentially long build; never kill the user's process.
for app_path in "$install_root" "$legacy_native"; do
  if [ -d "$app_path" ]; then
    app_exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_path/Contents/Info.plist")"
    if lsof -t "$app_path/Contents/MacOS/$app_exe" >/dev/null 2>&1; then echo 'Quit the app and retry.' >&2; exit 1; fi
  fi
done
[ ! -d "$install_root" ] || mv "$install_root" "$transaction/previous.app"
replaced=true
[ ! -d "$legacy_native" ] || mv "$legacy_native" "$transaction/native.app"
legacy_removed=true
osascript "$script_dir/migrate-login-items.applescript" remove >/dev/null
if [ "$uninstall" = true ]; then
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  rm -f "$plist"
else
  mv "$stage" "$install_root"
  if [ "$enabled" = true ]; then action=on; else action=off; rm -f "$plist"; fi
  /bin/bash "$install_root/Contents/Resources/startup.sh" "$action"
fi
committed=true
printf 'Completed: variant=%s version=%s revision=%s path=%s autostart=%s uninstall=%s\n' "$variant" "${version:-n/a}" "${revision:-n/a}" "$install_root" "$enabled" "$uninstall"
if [ "$uninstall" = false ] && [ "$no_start" = false ]; then open "$install_root"; fi
