#!/usr/bin/env bash
# One-time setup for macOS (Apple Silicon). Needs Homebrew.
set -euo pipefail
cd "$(dirname "$0")"

brew list python@3.12 >/dev/null 2>&1 || brew install python@3.12
command -v cargo  >/dev/null 2>&1 || brew install rust     # deepfilterlib builds with Rust
command -v ffmpeg >/dev/null 2>&1 || brew install ffmpeg

if [ ! -d .venv ]; then
  "$(brew --prefix python@3.12)/bin/python3.12" -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

echo
echo "Setup complete. Start the app with: ./run.sh"
