"""Small, on-demand checks; no model downloads or media processing."""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import pipeline
from .background import model_path, worker_python, MODEL_SHA256
import hashlib


def inspect_setup(work: Path):
    checks = []
    for name, env in [('ffmpeg', 'FFMPEG_BIN'), ('ffprobe', 'FFPROBE_BIN')]:
        try:
            path = pipeline.find_binary(name, env)
            result = subprocess.run([path, '-version'], capture_output=True, timeout=5)
            ready = result.returncode == 0
        except (OSError, subprocess.TimeoutExpired, pipeline.PipelineError):
            ready = False
        checks.append({'name': name, 'ready': ready, 'message': 'Available' if ready else f'Install {name} or configure {env}.'})
    python = os.environ.get('DEEPFILTER_PYTHON', sys.executable)
    script = """import importlib.util,json
from pathlib import Path
names=('numpy','torch','torchaudio','soundfile','df')
missing=[n for n in names if importlib.util.find_spec(n) is None]
model=False
if importlib.util.find_spec('appdirs'):
 import appdirs
 root=Path(appdirs.user_cache_dir('DeepFilterNet'))/'DeepFilterNet3'
 model=(root/'config.ini').is_file() and any((root/'checkpoints').glob('*.ckpt*'))
print(json.dumps({'missing':missing,'model':model}))
"""
    try:
        result = subprocess.run([python, '-c', script], capture_output=True, text=True, timeout=10)
        info = json.loads(result.stdout) if result.returncode == 0 else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        info = None
    ready = info is not None and not info['missing']
    message = 'Dependencies available' if ready else ('Missing: ' + ', '.join(info['missing']) if info else 'Configure DEEPFILTER_PYTHON to a working Python environment.')
    checks.append({'name': 'Noise reduction', 'ready': ready, 'message': message})
    checks.append({'name': 'Noise model', 'ready': bool(info and info['model']),
                   'message': 'Cached model found' if info and info['model'] else 'No model found in the standard cache. The first noise-reduction run may need internet to download it.'})
    try:
        result = subprocess.run([worker_python(), "-c", "import mediapipe, cv2, numpy"], capture_output=True, timeout=15)
        background_ready = result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        background_ready = False
    checks.append({"name": "Background effects", "ready": background_ready,
                   "message": "Person segmentation available" if background_ready else "Run ./setup-background.sh, or configure BACKGROUND_PYTHON to that environment."})
    model = model_path()
    model_ready = model.is_file() and hashlib.sha256(model.read_bytes()).hexdigest() == MODEL_SHA256
    checks.append({"name": "Background model", "ready": model_ready,
                   "message": "Verified model cached" if model_ready else "Downloaded and verified on first background preview/export. Run ./setup-background.sh to prepare it now."})
    free = shutil.disk_usage(work).free
    checks.append({'name': 'Temporary disk', 'ready': free >= 256 * 1024 * 1024, 'message': f'{free / 1024**3:.1f} GB available'})
    return {'checks': checks}


def require_export_space(work: Path, duration: float, channels: int, background: bool = False):
    # Reserve room for decoded/clean WAV, output, and encoder overhead.
    source = next(work.glob('source.*'))
    required = max(256 * 1024**2, source.stat().st_size * 2 + int(duration * 48000 * max(1, channels) * 4))
    if background:
        required += int(duration * 1024**2)  # Conservative headroom for the streamed lossless mask.
    if shutil.disk_usage(work).free < required:
        raise pipeline.PipelineError('Not enough temporary disk space. Free disk space or use a shorter recording.')
