#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
if [ ! -x .venv/bin/python ]; then
  echo "No .venv found. Run ./setup.sh first." >&2
  exit 1
fi
echo "FreeEdit is running at http://localhost:${PORT}"
exec .venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port "$PORT"
