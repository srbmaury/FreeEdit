#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

python_bin="${PYTHON_BIN:-.venv/bin/python}"
"$python_bin" -m pip install "pip>=25.1"
"$python_bin" -m pip install --group narration

model_dir="${FREEEDIT_TTS_MODEL_DIR:-$HOME/.cache/freeedit/tts}"
mkdir -p "$model_dir"
release=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
verify() {
  "$python_bin" -c 'import hashlib, sys; f = open(sys.argv[1], "rb"); sys.exit(hashlib.file_digest(f, "sha256").hexdigest() != sys.argv[2])' "$1" "$2"
}
while read -r file sha256; do
  if [ ! -s "$model_dir/$file" ] || ! verify "$model_dir/$file" "$sha256"; then
    partial="$(mktemp "$model_dir/$file.XXXXXX")"
    trap 'rm -f "$partial"' EXIT
    curl --fail --location --retry 2 "$release/$file" --output "$partial"
    if ! verify "$partial" "$sha256"; then
      echo "Checksum mismatch for $file" >&2
      exit 1
    fi
    mv "$partial" "$model_dir/$file"
    trap - EXIT
  fi
done <<'MODELS'
kokoro-v1.0.int8.onnx 6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb
voices-v1.0.bin bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
MODELS

FREEEDIT_TTS_MODEL_DIR="$model_dir" "$python_bin" - <<'PY'
from backend.tts import NarrationRequest, synthesize

audio = synthesize(NarrationRequest(text="FreeEdit is ready to generate narration."))
assert audio.startswith(b"RIFF")
print("Local narration is ready. Restart FreeEdit if it was running.")
PY
