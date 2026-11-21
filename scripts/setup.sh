#!/usr/bin/env bash
# One-time setup for macOS. Needs Homebrew.
set -euo pipefail
cd "$(dirname "$0")/.."

background=false
preflight_args=(--verify-render)
for option in "$@"; do
  case "$option" in
    --background) background=true ;;
    --warm-model) preflight_args+=(--warm-model) ;;
    *) echo "Usage: ./scripts/setup.sh [--background] [--warm-model]" >&2; exit 1 ;;
  esac
done

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required on macOS. Install it from https://brew.sh, then rerun ./scripts/setup.sh." >&2
  exit 1
fi
brew list python@3.12 >/dev/null 2>&1 || brew install python@3.12
command -v cargo  >/dev/null 2>&1 || brew install rust     # deepfilterlib builds with Rust
command -v ffmpeg >/dev/null 2>&1 || brew install ffmpeg

if [ ! -d .venv ]; then
  "$(brew --prefix python@3.12)/bin/python3.12" -m venv .venv
fi
if ! .venv/bin/python -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3,12) else 1)'; then
  echo "Existing .venv must use Python 3.12. Rename/remove it and rerun ./scripts/setup.sh." >&2
  exit 1
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install --group web --group noise
.venv/bin/python -m pip check

if "$background"; then
  .venv/bin/python -m venv .venv-background
  .venv/bin/python -m pip --python .venv-background install --group background
  .venv-background/bin/python - <<'PYTHON'
import mediapipe as mp
from backend.media.background import ensure_model

model = ensure_model()
options = mp.tasks.vision.ImageSegmenterOptions(
    base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
    running_mode=mp.tasks.vision.RunningMode.VIDEO,
    output_confidence_masks=True,
    output_category_mask=False,
)
with mp.tasks.vision.ImageSegmenter.create_from_options(options):
    print("Background runtime and verified model ready:", model)
PYTHON
  echo "Background effects are ready. Restart FreeEdit if it was running."
fi

.venv/bin/python -m backend.preflight "${preflight_args[@]}"
echo
echo "Setup complete. Start the app with: ./scripts/run.sh"
