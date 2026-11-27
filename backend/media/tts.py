"""Offline Kokoro narration. Model weights are provisioned by setup-tts.sh."""

import importlib.util
import io
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from typing import Literal
import wave

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from backend.support.observability import event

MODEL_DIR = Path(os.environ.get("FREEEDIT_TTS_MODEL_DIR", Path.home() / ".cache/freeedit/tts"))
MODEL = MODEL_DIR / "kokoro-v1.0.int8.onnx"
VOICES = MODEL_DIR / "voices-v1.0.bin"
MAX_CHARS = 1000
MAX_CHUNK_CHARS = max(20, min(MAX_CHARS, int(os.environ.get("FREEEDIT_TTS_CHUNK_CHARS", "45"))))
ISOLATED = os.environ.get("FREEEDIT_TTS_ISOLATED", "false").lower() == "true"
LOW_MEMORY = os.environ.get("FREEEDIT_TTS_LOW_MEMORY", "false").lower() == "true"
WORKER_TIMEOUT = max(30, min(600, int(os.environ.get("FREEEDIT_TTS_TIMEOUT_SECONDS", "165"))))
_CLAUSE_BREAK = re.compile(r"(?<=[,;:—])\s+|\s+(?=(?:and|but|or|so|yet|because|although|while|than)\b)", re.I)
router = APIRouter(prefix="/api/tts")
_generation_lock = threading.Lock()
_engine = None


class NarrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    voice: Literal[
        "af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir", "am_puck",
        "bf_emma", "bm_george", "bm_lewis",
    ] = "af_heart"
    speed: float = Field(default=1, ge=.75, le=1.25)

    @field_validator("text")
    @classmethod
    def require_words(cls, value):
        if not any(character.isalnum() for character in value):
            raise ValueError("Enter text containing letters or numbers.")
        return value


def available():
    return MODEL.is_file() and VOICES.is_file() and importlib.util.find_spec("kokoro_onnx") is not None


def sentence_chunks(sentence: str):
    remaining = sentence.strip()
    while len(remaining) > MAX_CHUNK_CHARS:
        window = remaining[:MAX_CHUNK_CHARS + 1]
        breaks = [
            match.start() for match in _CLAUSE_BREAK.finditer(remaining)
            if MAX_CHUNK_CHARS // 2 <= match.start() <= MAX_CHUNK_CHARS
            and any(character.isalnum() for character in remaining[:match.start()])
        ]
        if breaks:
            end = breaks[-1]
        else:
            spaces = list(re.finditer(r"\s+", window))
            end = spaces[-1].start() if spaces else MAX_CHUNK_CHARS
        yield remaining[:end].rstrip()
        remaining = remaining[end:].lstrip()
    if remaining:
        yield remaining


def synthesize(settings: NarrationRequest) -> bytes:
    global _engine
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro

    if _engine is None:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        if LOW_MEMORY:
            # Avoid large retained arenas, shape-specific buffers and prepacked weights
            # on small hosting instances. The model may run more slowly.
            options.enable_cpu_mem_arena = False
            options.enable_mem_pattern = False
            options.enable_mem_reuse = True
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
            options.add_session_config_entry("session.disable_prepacking", "1")
        event("narration_model_loading", low_memory=LOW_MEMORY)
        session = ort.InferenceSession(str(MODEL), sess_options=options, providers=["CPUExecutionProvider"])
        _engine = Kokoro.from_session(session, str(VOICES))
        event("narration_model_ready")
    language = "en-gb" if settings.voice.startswith("b") else "en-us"
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        sample_rate = None
        for sentence in re.split(r"\n+|(?<=[.!?])\s+", settings.text):
            first_chunk = True
            for chunk in sentence_chunks(sentence):
                if not any(character.isalnum() for character in chunk):
                    continue
                samples, rate = _engine.create(chunk, voice=settings.voice, speed=settings.speed, lang=language)
                if not samples.size:
                    raise ValueError("No speech was produced.")
                if sample_rate is None:
                    sample_rate = rate
                    wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                elif first_chunk:
                    wav.writeframesraw(bytes(int(sample_rate * .15) * 2))
                first_chunk = False
                pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
                wav.writeframesraw(pcm.tobytes())
    return output.getvalue()


def memory_snapshot():
    """Best-effort cgroup diagnostics; no script or media contents."""
    result = {}
    for key, paths in (
        ("memory_bytes", ("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes")),
        ("memory_limit_bytes", ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes")),
        ("oom_events", ("/sys/fs/cgroup/memory.events",)),
    ):
        for path in paths:
            try:
                value = Path(path).read_text().strip()
                if key == "oom_events":
                    result[key] = dict(line.split() for line in value.splitlines())
                elif value.isdigit():
                    result[key] = int(value)
                break
            except (OSError, ValueError):
                continue
    return result


def synthesize_isolated(settings: NarrationRequest) -> bytes:
    started = time.monotonic()
    event("narration_worker_started", characters=len(settings.text), **memory_snapshot())
    try:
        result = subprocess.run(
            [sys.executable, "-m", "backend.media.tts_worker"],
            input=settings.model_dump_json().encode("utf-8"),
            stdout=subprocess.PIPE, stderr=None,
            timeout=WORKER_TIMEOUT, check=False,
        )
    except subprocess.TimeoutExpired:
        event("narration_worker_timeout", **memory_snapshot())
        raise HTTPException(504, "Narration took too long. Try a shorter script.") from None
    if result.returncode != 0:
        event("narration_worker_failed", exit_code=result.returncode, **memory_snapshot())
        if result.returncode in (-9, 137):
            raise HTTPException(503, "Narration worker was killed, possibly because of limited server memory. Try a shorter script.")
        raise HTTPException(500, "Narration worker could not finish. Check server logs.")
    if len(result.stdout) < 44 or result.stdout[:4] != b"RIFF" or result.stdout[8:12] != b"WAVE":
        event("narration_worker_invalid_audio")
        raise HTTPException(500, "Narration worker returned invalid audio.")
    event("narration_worker_completed", duration_ms=round((time.monotonic()-started)*1000), **memory_snapshot())
    return result.stdout


@router.get("")
def tts_status():
    return {"available": available(), "max_chars": MAX_CHARS}


@router.post("")
def generate_narration(settings: NarrationRequest):
    if not available():
        raise HTTPException(503, "Local narration is unavailable. Run the FreeEdit text-to-speech setup on this server.")
    if not _generation_lock.acquire(blocking=False):
        raise HTTPException(429, "Narration is already being generated. Try again shortly.", headers={"Retry-After": "2"})
    try:
        audio = synthesize_isolated(settings) if ISOLATED else synthesize(settings)
    except HTTPException:
        raise
    except Exception as exc:
        event("narration_failed", exception=type(exc).__name__)
        raise HTTPException(500, "Could not generate narration. Check the local voice model installation.") from None
    finally:
        _generation_lock.release()
    return Response(audio, media_type="audio/wav", headers={"Content-Disposition": 'inline; filename="narration.wav"'})
