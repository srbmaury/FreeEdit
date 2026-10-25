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


class CameraRegion(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=8)
    h: int = Field(ge=8)


class BackgroundSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    mode: Literal["blur", "color", "image"]
    preset: Literal["studio", "twilight", "forest", "custom"] = "custom"
    blur: int = Field(default=16, ge=4, le=40)
    color: str = Field(default="#e5e7eb", pattern=r"^#[a-fA-F0-9]{6}$")
    image: str | None = Field(default=None, max_length=900_000)
    region: CameraRegion | None = None

    @field_validator("image")
    @classmethod
    def valid_image(cls, value):
        return TextEdit.valid_png(value) if value is not None else None

    @model_validator(mode="after")
    def image_required(self):
        if self.mode == "image" and not self.image:
            raise ValueError("Choose a background image first.")
        if self.mode != "image":
            self.image = None
        return self

    def validate_media(self, media):
        if not media["has_video"]:
            raise HTTPException(422, "Background effects require a video.")
        if self.region and (self.region.x + self.region.w > media["width"] or self.region.y + self.region.h > media["height"]):
            raise HTTPException(422, "Camera area extends beyond the video.")


class PresenterSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    box: CameraRegion
    offset: float = Field(default=0, ge=0)
    trim_start: float = Field(default=0, ge=0)
    trim_end: float = Field(gt=0)
    effect: Literal["original", "blur", "remove"] = "original"
    sound: Literal["main", "presenter", "both", "muted"] = "main"
    main_volume: float = Field(default=1, ge=0, le=2)
    presenter_volume: float = Field(default=1, ge=0, le=2)

    def validate_media(self, media, other):
        if not media["has_video"] or not other["has_video"]:
            raise HTTPException(422, "Both recordings must contain video.")
        if self.offset >= media["duration"] or self.trim_start >= self.trim_end or self.trim_end > other["duration"] + .05:
            raise HTTPException(422, "Keep presenter timing inside the recordings.")
        self.trim_end = min(self.trim_end, other["duration"])
        if self.box.x + self.box.w > media["width"] or self.box.y + self.box.h > media["height"]:
            raise HTTPException(422, "Presenter inset extends beyond the main video.")
        if self.sound in ("main", "both") and not media["has_audio"]:
            raise HTTPException(422, "The main video has no sound. Choose Presenter or Muted.")
        if self.sound in ("presenter", "both") and not other["has_audio"]:
            raise HTTPException(422, "The presenter video has no sound. Choose Main or Muted.")


class ReframeSection(TimeRange):
    zoom: float = Field(default=1.5, ge=1, le=3)
    focus_x: float = Field(default=.5, ge=0, le=1)
    focus_y: float = Field(default=.5, ge=0, le=1)
    transition: float = Field(default=.35, ge=0, le=1.5)


class ReframeSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    aspect: Literal["original", "wide", "vertical", "square"] = "original"
    zoom: float = Field(default=1, ge=1, le=3)
    focus_x: float = Field(default=.5, ge=0, le=1)
    focus_y: float = Field(default=.5, ge=0, le=1)
    sections: list[ReframeSection] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def no_overlaps(self):
        ordered = sorted(self.sections, key=lambda section: section.start)
        if any(a.end > b.start for a, b in zip(ordered, ordered[1:])):
            raise ValueError("Reframe sections cannot overlap.")
        self.sections = ordered
        return self


class AudioSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    level_speech: bool = False
    fade_in: float = Field(default=0, ge=0, le=5)
    fade_out: float = Field(default=0, ge=0, le=5)


class ProcessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    presenter: PresenterSettings | None = None
    background: BackgroundSettings | None = None
    reframe: ReframeSettings | None = None
    audio: AudioSettings = Field(default_factory=AudioSettings)
    denoise: bool = True
    atten_lim: int | None = Field(default=None, ge=0, le=100)
    preset: Literal["balanced", "small", "high", "audio_only"] = "balanced"
    edits: list[Annotated[HideEdit | TextEdit, Field(discriminator="type")]] = Field(default_factory=list, max_length=100)
    cuts: list[TimeRange] = Field(default_factory=list, max_length=100)

    def validate_media(self, media):
        if self.reframe and (not media["has_video"] or self.preset == "audio_only"):
            raise HTTPException(422, "Reframing requires video output.")
        if self.reframe:
            if any(section.end > media["duration"] + .05 for section in self.reframe.sections):
                raise HTTPException(422, "Reframe sections must stay inside the recording.")
            for section in self.reframe.sections:
                section.end = min(section.end, media["duration"])
        if self.background:
            self.background.validate_media(media)
            if self.preset == "audio_only":
                raise HTTPException(422, "Background effects are not included in audio-only exports.")
        if self.edits and not media["has_video"]:
            raise HTTPException(422, "Visual edits require a video.")
        if self.preset == "audio_only" and not media["has_audio"] and not self.presenter:
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
    start: float = Field(default=0, ge=0)
    end: float | None = Field(default=None, gt=0)
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    threshold_db: float = Field(default=-40, ge=-70, le=-15)
    min_duration: float = Field(default=0.8, ge=0.3, le=10)
    padding: float = Field(default=0.2, ge=0.05, le=1)

    def validate_media(self, media):
        if not media["has_audio"]:
            raise HTTPException(422, "Silence detection requires an audio track.")
        if self.end is None:
            self.end = media["duration"]
        if not self.start < self.end <= media["duration"] + .05:
            raise HTTPException(422, "Choose a pause-analysis range inside the recording.")
        self.end = min(self.end, media["duration"])


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    start: float = Field(default=0, ge=0)
    atten_lim: int | None = Field(default=18, ge=0, le=100)

    def validate_media(self, media):
        if not media["has_audio"]:
            raise HTTPException(422, "This recording has no audio track.")
        if self.start >= media["duration"]:
            raise HTTPException(422, "Preview must start inside the recording.")


class BackgroundPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    start: float = Field(default=0, ge=0)
    background: BackgroundSettings

    def validate_media(self, media):
        self.background.validate_media(media)
        if self.start >= media["duration"]:
            raise HTTPException(422, "Preview must start inside the recording.")


class CompositionPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    presenter: PresenterSettings
    start: float = Field(default=0, ge=0)

    def validate_media(self, media):
        if self.start >= media["duration"]:
            raise HTTPException(422, "Preview must start inside the main video.")


class ResultPreviewRequest(ProcessRequest):
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    def validate_media(self, media):
        super().validate_media(media)
        if not self.start < self.end <= media["duration"] + .05 or self.end - self.start > 15.001:
            raise HTTPException(422, "Choose up to 15 seconds inside the recording.")
        self.end = min(self.end, media["duration"])
        keep = pipeline.kept_ranges([c.model_dump() for c in self.cuts], media["duration"]) or [(0, media["duration"])]
        if not any(min(b, self.end) - max(a, self.start) > .05 for a, b in keep):
            raise HTTPException(422, "This range is entirely cut out. Choose a range with retained footage.")
