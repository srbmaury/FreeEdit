"""Small, on-demand checks; no model downloads or media processing."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
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
    try:
        ffmpeg = pipeline.FFMPEG()
        encoders = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=5)
        filters = subprocess.run([ffmpeg, "-hide_banner", "-filters"], capture_output=True, text=True, timeout=5)
        needed_encoders = {"libx264", "aac", "pcm_s16le", "ffv1"}
        needed_filters = {"silencedetect", "acompressor", "alimiter", "volume", "overlay", "zoompan"}
        available_encoders = {line.split()[1] for line in encoders.stdout.splitlines() if len(line.split()) >= 2}
        available_filters = {line.split()[1] for line in filters.stdout.splitlines() if len(line.split()) >= 2}
        missing = sorted((needed_encoders - available_encoders) | (needed_filters - available_filters))
        render_ready = not missing and encoders.returncode == filters.returncode == 0
        render_message = "Required video/audio encoders and filters available" if render_ready else "Install a full FFmpeg build. Missing: " + ", ".join(missing)
    except (OSError, subprocess.TimeoutExpired, pipeline.PipelineError):
        render_ready = False
        render_message = "Could not check rendering support. Install FFmpeg and retry."
    checks.append({"name": "Rendering support", "ready": render_ready, "message": render_message})
    try:
        with tempfile.TemporaryFile(dir=work) as temporary:
            temporary.write(b"freeedit-storage-check")
            temporary.flush()
        writable = True
    except OSError:
        writable = False
    checks.append({"name": "Temporary storage", "ready": writable,
                   "message": "Writable" if writable else "Set FREEEDIT_JOBS_DIR to a writable folder and restart."})
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
    background_message = "Run ./setup-background.sh, or configure BACKGROUND_PYTHON to that environment."
    try:
        result = subprocess.run([worker_python(), "-c", "import mediapipe, cv2, numpy"], capture_output=True, timeout=15)
        background_ready = result.returncode == 0
        if background_ready:
            background_message = "Person segmentation available"
    except subprocess.TimeoutExpired:
        background_ready = False
        background_message = "Background initialization timed out. Run ./setup-background.sh to prepare its runtime, then retry."
    except OSError:
        background_ready = False
    checks.append({"name": "Background effects", "ready": background_ready, "message": background_message})
    model = model_path()
    model_ready = model.is_file() and hashlib.sha256(model.read_bytes()).hexdigest() == MODEL_SHA256
    checks.append({"name": "Background model", "ready": model_ready,
                   "message": "Verified model cached" if model_ready else "Downloaded and verified on first background preview/export. Run ./setup-background.sh to prepare it now."})
    free = shutil.disk_usage(work).free
    checks.append({'name': 'Temporary disk', 'ready': free >= 256 * 1024 * 1024, 'message': f'{free / 1024**3:.1f} GB available'})
    return {'checks': checks}


def require_export_space(work: Path, duration: float, channels: int, background: bool = False):
    # Reserve room for decoded/clean WAV, output, and encoder overhead.
    source = work / 'sequence.mp4'
    if not source.is_file():
        source = next(work.glob('source.*'))
    required = max(256 * 1024**2, source.stat().st_size * 2 + int(duration * 48000 * max(1, channels) * 4))
    if background:
        required += int(duration * 1024**2)  # Conservative headroom for the streamed lossless mask.
    if shutil.disk_usage(work).free < required:
        raise pipeline.PipelineError('Not enough temporary disk space. Free disk space or use a shorter recording.')


def require_preview_space(work: Path, duration: float, media: dict):
    # The preview window is lossless. Reserve its uncompressed upper bound,
    # plus audio/intermediate/output headroom, independently of full file size.
    pixels = media.get("width", 0) * media.get("height", 0)
    frames = duration * media.get("frame_rate", 30) if media.get("has_video") else 0
    required = 256 * 1024**2 + int(pixels * 4 * frames + duration * 48000 * max(1, media.get("audio_channels", 2)) * 8)
    if shutil.disk_usage(work).free < required:
        raise pipeline.PipelineError("Not enough temporary space for this preview. Select a shorter range or free disk space.")


def verify_render(work: Path):
    """Optional setup smoke check using generated media; no model or user files."""
    with tempfile.TemporaryDirectory(prefix="setup-check-", dir=work) as folder:
        target = Path(folder)
        source = target / "source.mp4"
        pipeline._run_ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=1",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-t", "1", str(source)], 1, "Checking encoders", lambda *_: None)
        output = pipeline.process(source, target, denoise_audio=False, atten_lim=None,
            edits=[{"type": "hide", "start": 0, "end": 1, "x": 8, "y": 8, "w": 24, "h": 24, "style": "black"}],
            cuts=[{"start": .4, "end": .6}], preset="balanced", progress=lambda *_: None,
            reframe={"aspect": "original", "zoom": 1.2, "focus_x": .5, "focus_y": .5},
            audio={"level_speech": True, "fade_in": .1, "fade_out": .1})
        info = pipeline.probe(output)
        if not info.has_video or not info.has_audio or abs(info.duration - .8) > .1:
            raise pipeline.PipelineError("Setup render produced unexpected media. Check the FFmpeg installation.")
