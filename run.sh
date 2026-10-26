#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
if [ ! -x .venv/bin/python ]; then
  echo "No .venv found. Run ./setup.sh first." >&2
  exit 1
fi
exec .venv/bin/python -m backend.launch --port "$PORT"
