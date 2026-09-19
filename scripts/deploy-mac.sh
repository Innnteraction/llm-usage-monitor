#!/usr/bin/env bash
set -euo pipefail
args=(--variant node)
while [ $# -gt 0 ]; do
  case "$1" in
    --autostart) args+=(--autostart on);;
    --skip-build) echo 'Skip-build now performs a verified incremental build to avoid stale output.' >&2;;
    --no-start|--uninstall) args+=("$1");;
    *) echo "Unsupported legacy option: $1; use scripts/install.sh" >&2; exit 2;;
  esac
  shift
done
exec /bin/bash "$(dirname "${BASH_SOURCE[0]}")/install.sh" "${args[@]}"
