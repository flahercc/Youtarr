#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Backup requires Python 3.9 or newer.' >&2
  exit 1
fi
exec python3 "$SCRIPT_DIR/_backup_restore.py" backup "$@"
