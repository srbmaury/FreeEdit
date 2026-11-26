"""Offline Kokoro narration. Model weights are provisioned by setup-tts.sh."""

import importlib.util
import io
import os
from pathlib import Path
import re
import threading
from typing import Literal
import wave

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

MODEL_DIR = Path(os.environ.get("FREEEDIT_TTS_MODEL_DIR", Path.home() / ".cache/freeedit/tts"))
MODEL = MODEL_DIR / "kokoro-v1.0.int8.onnx"
VOICES = MODEL_DIR / "voices-v1.0.bin"
MAX_CHARS = 1000
MAX_CHUNK_CHARS = max(45, min(MAX_CHARS, int(os.environ.get("FREEEDIT_TTS_CHUNK_CHARS", "120"))))
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


def _edge_silence(samples, rate):
    import numpy as np

    # Look only for quiet edges. Keep a short cushion at the join so quiet
    # consonants next to speech stay intact.
    frame = max(1, rate // 100)
    if len(samples) < frame:
        return 0, 0
    pad = (-len(samples)) % frame
    peaks = np.max(np.abs(np.pad(samples, (0, pad)).reshape(-1, frame)), axis=1)
    active = np.flatnonzero(peaks > 0.004)
    if not active.size:
        return 0, 0
    return active[0] * frame, max(0, len(samples) - (active[-1] + 1) * frame)


def _join_pause(ending, leading, rate, seconds):
    target = round(rate * seconds)
    if ending + leading <= target:
        return 0, 0, target - ending - leading
    keep_ending = min(ending, max(target // 2, target - leading))
    keep_leading = target - keep_ending
    return ending - keep_ending, leading - keep_leading, 0


def synthesize(settings: NarrationRequest) -> bytes:
    global _engine
    import numpy as np

    if _engine is None:
        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(MODEL), sess_options=options, providers=["CPUExecutionProvider"])
        _engine = Kokoro.from_session(session, str(VOICES))
    language = "en-gb" if settings.voice.startswith("b") else "en-us"
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        previous = None
        for sentence in re.split(r"\n+|(?<=[.!?])\s+", settings.text):
            first_chunk = True
            for chunk in sentence_chunks(sentence):
                if not any(character.isalnum() for character in chunk):
                    continue
                samples, rate = _engine.create(chunk, voice=settings.voice, speed=settings.speed, lang=language)
                if not samples.size:
                    raise ValueError("No speech was produced.")
                pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
                leading, trailing = _edge_silence(samples, rate)
                if previous is None:
                    wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                else:
                    if first_chunk:
                        pause = 0.22
                    elif last_chunk.endswith((",", ";", ":", "—")):
                        pause = 0.11
                    else:
                        pause = 0.06
                    cut_end, cut_start, padding = _join_pause(previous_trailing, leading, rate, pause)
                    wav.writeframesraw(previous[:len(previous) - cut_end].tobytes())
                    if padding:
                        wav.writeframesraw(bytes(padding * 2))
                    pcm = pcm[cut_start:]
                previous, previous_trailing = pcm, trailing
                last_chunk = chunk
                first_chunk = False
        if previous is not None:
            wav.writeframesraw(previous.tobytes())
    return output.getvalue()


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
        audio = synthesize(settings)
    except Exception:
        raise HTTPException(500, "Could not generate narration. Check the local voice model installation.") from None
    finally:
        _generation_lock.release()
    return Response(audio, media_type="audio/wav", headers={"Content-Disposition": 'inline; filename="narration.wav"'})
