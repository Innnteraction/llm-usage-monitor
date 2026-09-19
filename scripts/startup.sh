#!/usr/bin/env bash
set -euo pipefail
action="${1:-query}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target="$root/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$root/Contents/Info.plist")"
[ -f "$root/Contents/Resources/install-info.json" ] && [ -x "$target" ] || exit 2
manifest="$root/Contents/Resources/install-info.json"
[ "$(plutil -extract appId raw -o - "$manifest")" = llm-usage-monitor ] || exit 2
[ "$(plutil -extract schemaVersion raw -o - "$manifest")" = 1 ] || exit 2
[ -z "${2:-}" ] || [ "$2" = "$target" ] || exit 2
label=com.innnteraction.llm-usage-monitor
plist="$HOME/Library/LaunchAgents/$label.plist"
owned() { [ -f "$plist" ] && [ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$plist" 2>/dev/null || true)" = "$target" ]; }
case "$action" in
  query) ;;
  on)
    mkdir -p "$(dirname "$plist")"
    temp="$(mktemp "${plist}.XXXXXX")"
    trap 'rm -f "$temp"' EXIT
    # XML escaping avoids interpreting paths as PlistBuddy commands.
    escaped="$(printf '%s' "$target" | sed 's/\&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g')"
    cat > "$temp" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>$label</string><key>ProgramArguments</key><array><string>$escaped</string><string>--start-hidden</string></array><key>RunAtLoad</key><true/><key>ProcessType</key><string>Interactive</string><key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>
EOF
    plutil -lint "$temp" >/dev/null
    # Register on next login: bootstrap now would start a second collector.
    # Do not bootout the job here: a tray toggle must not terminate its own app.
    mv "$temp" "$plist"
    owned || exit 1
    ;;
  off) if owned; then rm -f "$plist"; fi;;
  *) exit 2;;
esac
if owned; then echo true; else echo false; fi
