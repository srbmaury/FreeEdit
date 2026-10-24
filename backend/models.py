"""Validated edit instructions shared by API admission and the renderer."""

import base64
import binascii
import struct
from typing import Annotated, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import pipeline


class TimeRange(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("End must be after start.")
        return self


class HideEdit(TimeRange):
    type: Literal["hide"]
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    w: float = Field(ge=4)
    h: float = Field(ge=4)
    style: Literal["black", "blur", "pixelate"] = "black"


class TextEdit(TimeRange):
    type: Literal["text"]
    x: int = Field(ge=-16384, le=16384)
    y: int = Field(ge=-16384, le=16384)
    image: str = Field(max_length=2_800_000)

    @field_validator("image")
    @classmethod
    def valid_png(cls, value):
        prefix = "data:image/png;base64,"
        try:
            if not value.startswith(prefix):
                raise ValueError("Text must be a PNG image.")
            raw = base64.b64decode(value[len(prefix):], validate=True)
            if raw[:8] != b"\x89PNG\r\n\x1a\n" or raw[12:16] != b"IHDR":
                raise ValueError("Invalid PNG header.")
            w, h = struct.unpack(">II", raw[16:24])
            if not (0 < w <= 8192 and 0 < h <= 8192 and w * h <= 8_000_000):
                raise ValueError("Text image is too large.")
        except (binascii.Error, struct.error) as exc:
            raise ValueError("Invalid PNG image.") from exc
        return value


class ProcessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    denoise: bool = True
    atten_lim: int | None = Field(default=None, ge=0, le=100)
    preset: Literal["balanced", "small", "high", "audio_only"] = "balanced"
    edits: list[Annotated[HideEdit | TextEdit, Field(discriminator="type")]] = Field(default_factory=list, max_length=100)
    cuts: list[TimeRange] = Field(default_factory=list, max_length=100)

    def validate_media(self, media):
        if self.edits and not media["has_video"]:
            raise HTTPException(422, "Visual edits require a video.")
        if self.preset == "audio_only" and not media["has_audio"]:
            raise HTTPException(422, "This recording has no audio to export.")
        for item in [*self.edits, *self.cuts]:
            if item.end > media["duration"] + 0.05:
                raise HTTPException(422, "Edit extends beyond the recording.")
            item.end = min(item.end, media["duration"])
            if item.start >= item.end:
                raise HTTPException(422, "Edit must include part of the recording.")
            if isinstance(item, HideEdit):
                if item.x + item.w > media["width"] or item.y + item.h > media["height"]:
                    raise HTTPException(422, "Mask extends beyond the video.")
        try:
            pipeline.kept_ranges([c.model_dump() for c in self.cuts], media["duration"])
        except pipeline.PipelineError as exc:
            raise HTTPException(422, str(exc)) from exc



class SilenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    threshold_db: float = Field(default=-40, ge=-70, le=-15)
    min_duration: float = Field(default=0.8, ge=0.3, le=10)
    padding: float = Field(default=0.2, ge=0.05, le=1)

    def validate_media(self, media):
        if not media["has_audio"]:
            raise HTTPException(422, "Silence detection requires an audio track.")


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    start: float = Field(default=0, ge=0)
    atten_lim: int | None = Field(default=18, ge=0, le=100)

    def validate_media(self, media):
        if not media["has_audio"]:
            raise HTTPException(422, "This recording has no audio track.")
        if self.start >= media["duration"]:
            raise HTTPException(422, "Preview must start inside the recording.")
