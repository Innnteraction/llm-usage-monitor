#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
source "$script_dir/install-common.sh"
variant=''; check=false; non_interactive=false; accept_install=false; accept_dependencies=false
autostart=preserve; no_start=false; uninstall=false
while [ $# -gt 0 ]; do
  case "$1" in
    --variant) variant="${2:?node or rust required}"; shift;;
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
required_pnpm="$(sed -n 's/.*"packageManager": "pnpm@\([^"]*\)".*/\1/p' "$project_root/package.json")"
inspect_environment
[ "$check" = true ] && exit 0
if [ -z "$variant" ] && [ "$uninstall" = false ]; then
  if [ "$non_interactive" = true ] || [ ! -t 0 ]; then echo '--variant is required.' >&2; exit 2; fi
  printf 'Choose node / rust (no default): '; IFS= read -r variant
fi
case "$variant" in node|rust) ;; '') [ "$uninstall" = true ] || exit 2;; *) exit 2;; esac
echo 'Installation layer is being prepared; --check is available.' >&2
exit 2
