#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PYTHON="${PYTHON_BIN:-.venv/bin/python}"
if [ ! -x "$PYTHON" ]; then
  echo "Run ./setup.sh first, or set PYTHON_BIN to a Python 3.12 executable." >&2
  exit 1
fi
if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3,12) else 1)'; then
  echo "Background setup requires Python 3.12." >&2
  exit 1
fi
"$PYTHON" -m venv .venv-background
.venv-background/bin/python -m pip install -r requirements-background.txt
.venv-background/bin/python - <<'PYTHON'
import mediapipe as mp
from backend.background import ensure_model

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
