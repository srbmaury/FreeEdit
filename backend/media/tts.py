"""Offline Kokoro narration. Model weights are provisioned by setup-tts.sh."""

import importlib.util
import io
import os
from pathlib import Path
import re
import textwrap
import threading
from typing import Literal
import wave

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

MODEL_DIR = Path(os.environ.get("FREEEDIT_TTS_MODEL_DIR", Path.home() / ".cache/freeedit/tts"))
MODEL = MODEL_DIR / "kokoro-v1.0.int8.onnx"
VOICES = MODEL_DIR / "voices-v1.0.bin"
MAX_CHARS = 1000
MAX_CHUNK_CHARS = 45
router = APIRouter(prefix="/api/tts")
_generation_lock = threading.Lock()
_engine = None


class NarrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    voice: Literal["af_heart", "am_michael", "bf_emma", "bm_george"] = "af_heart"
    speed: float = Field(default=1, ge=.75, le=1.25)

    @field_validator("text")
    @classmethod
    def require_words(cls, value):
        if not any(character.isalnum() for character in value):
            raise ValueError("Enter text containing letters or numbers.")
        return value


def available():
    return MODEL.is_file() and VOICES.is_file() and importlib.util.find_spec("kokoro_onnx") is not None


def synthesize(settings: NarrationRequest) -> bytes:
    global _engine
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro

    if _engine is None:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(MODEL), sess_options=options, providers=["CPUExecutionProvider"])
        _engine = Kokoro.from_session(session, str(VOICES))
    language = "en-gb" if settings.voice.startswith("b") else "en-us"
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        sample_rate = None
        for sentence in re.split(r"\n+|(?<=[.!?])\s+", settings.text):
            for chunk in textwrap.wrap(sentence, width=MAX_CHUNK_CHARS, break_on_hyphens=False):
                if not any(character.isalnum() for character in chunk):
                    continue
                samples, rate = _engine.create(chunk, voice=settings.voice, speed=settings.speed, lang=language)
                if not samples.size:
                    raise ValueError("No speech was produced.")
                if sample_rate is None:
                    sample_rate = rate
                    wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                else:
                    wav.writeframesraw(bytes(int(sample_rate * .15) * 2))
                pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
                wav.writeframesraw(pcm.tobytes())
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
