"""Person masks and FFmpeg composition; ML dependencies live in a separate worker."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite"
MODEL_SHA256 = "191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b"


def worker_python():
    local = Path(__file__).resolve().parent.parent / ".venv-background" / "bin" / "python"
    return os.environ.get("BACKGROUND_PYTHON", str(local) if local.is_file() else sys.executable)


def model_path():
    root = Path(os.environ.get("FREEEDIT_MODEL_DIR", Path.home() / ".cache" / "freeedit"))
    return root / "selfie_segmenter_v1.tflite"


def ensure_model():
    from .pipeline import PipelineError
    target = model_path()
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == MODEL_SHA256:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=30) as response:
            data = response.read(2 * 1024**2 + 1)
        if hashlib.sha256(data).hexdigest() != MODEL_SHA256:
            raise PipelineError("Background model download failed verification. Try again.")
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(data)
        temporary.replace(target)
        return target
    except OSError as exc:
        raise PipelineError("Background model is unavailable. Check your internet connection and temporary storage, then retry.") from exc
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def create_mask(source, work, info, settings, progress, start=0, length=None):
    from .pipeline import FFMPEG, PipelineError
    from .execution import run_process
    length = info.duration if length is None else length
    progress("Preparing person segmentation", None)
    model = ensure_model()
    region = settings.get("region") or {"x": 0, "y": 0, "w": info.width, "h": info.height}
    config = {"ffmpeg": FFMPEG(), "source": str(source), "model": str(model),
              "region": region, "start": start, "duration": length,
              "output": str(work / "person-mask.mkv")}
    config_path = work / "background-worker.json"
    config_path.write_text(json.dumps(config))
    progress("Separating person from background", None)
    complete = False
    try:
        result = run_process([worker_python(), str(Path(__file__).with_name("background_worker.py")), str(config_path)],
                             capture_output=True, text=True, timeout=300 + length * 10,
                             stdin=subprocess.DEVNULL)
        if result.returncode:
            raise PipelineError("Background processing failed: " + result.stderr[-2000:])
        report = json.loads(result.stdout)
        if not report["person_detected"]:
            raise PipelineError("No person was found in the selected area. Choose the camera area or try a different part of the recording.")
        complete = True
        return work / "person-mask.mkv"
    except subprocess.TimeoutExpired as exc:
        raise PipelineError("Background processing timed out. Try a shorter recording.") from exc
    finally:
        config_path.unlink(missing_ok=True)
        if not complete:
            (work / "person-mask.mkv").unlink(missing_ok=True)


def filters(current, info, scale, settings, mask_input, image_input):
    """Composite inside the chosen camera area, before privacy masks and text."""
    region = settings.get("region") or {"x": 0, "y": 0, "w": info.width, "h": info.height}
    x, y, w, h = [int(round(region[k] * scale)) for k in ("x", "y", "w", "h")]
    # Keep rounded coordinates inside the scaled frame.
    w = min(w, int(round(info.width * scale / 2)) * 2 - x)
    h = min(h, int(round(info.height * scale / 2)) * 2 - y)
    if w < 2 or h < 2:
        from .pipeline import PipelineError
        raise PipelineError("Camera area is too small at this export resolution. Choose a larger area.")
    parts = [f"{current}split=2[bgbase][bgcrop]",
             f"[bgcrop]crop={w}:{h}:{x}:{y}:exact=1,format=yuv444p[bgperson]"]
    if settings["mode"] == "blur":
        parts += ["[bgperson]split=2[bgforeground][bgblur]",
                  f"[bgblur]gblur=sigma={settings['blur']}:steps=2[bgreplacement]"]
        foreground = "[bgforeground]"
    else:
        foreground = "[bgperson]"
        if settings["mode"] == "color":
            color = settings["color"].replace("#", "0x")
            parts.append(f"color=c={color}:s={w}x{h}:r=30:d={info.duration},format=yuv444p[bgreplacement]")
        else:
            parts.append(f"[{image_input}:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,format=yuv444p[bgreplacement]")
    parts += [f"[{mask_input}:v]scale={w}:{h},format=gray,negate[bgmask]",
              f"{foreground}[bgreplacement][bgmask]maskedmerge[bgcomposite]",
              f"[bgbase][bgcomposite]overlay={x}:{y}:eof_action=repeat:format=auto[bgresult]"]
    return parts, "[bgresult]"
