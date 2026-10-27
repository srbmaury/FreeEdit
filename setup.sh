#!/usr/bin/env bash
# One-time setup for macOS. Needs Homebrew.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required on macOS. Install it from https://brew.sh, then rerun ./setup.sh." >&2
  exit 1
fi
if [[ "${1:-}" != "" && "${1:-}" != "--warm-model" ]]; then
  echo "Usage: ./setup.sh [--warm-model]" >&2
  exit 1
fi
brew list python@3.12 >/dev/null 2>&1 || brew install python@3.12
command -v cargo  >/dev/null 2>&1 || brew install rust     # deepfilterlib builds with Rust
command -v ffmpeg >/dev/null 2>&1 || brew install ffmpeg

if [ ! -d .venv ]; then
  "$(brew --prefix python@3.12)/bin/python3.12" -m venv .venv
fi
if ! .venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3,12) else 1)'; then
  echo "Existing .venv must use Python 3.12. Rename/remove it and rerun ./setup.sh." >&2
  exit 1
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements-web.lock -r requirements.txt
.venv/bin/python -m pip check

.venv/bin/python -m backend.preflight --verify-render "$@"
echo
echo "Setup complete. Start the app with: ./run.sh"
