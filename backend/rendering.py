"""One rendering contract for exports and bounded result previews."""
import copy
import shutil
from pathlib import Path

from . import pipeline


def render(source: Path, work: Path, settings: dict, progress, presenter: Path | None = None,
           audio_offset: float = 0, audio_duration: float | None = None) -> Path:
    composition_work = work / "composition"
    try:
        if settings.get("presenter"):
            from .composition import compose, compose_audio
            info = pipeline.probe(source)
            audio_only = settings["preset"] == "audio_only"
            required = (256 * 1024**2 + int(info.duration * 48000 * 2 * 2) if audio_only else
                        source.stat().st_size * 4 + presenter.stat().st_size * 2 + int(info.duration * 1024**2))
            if shutil.disk_usage(work).free < required:
                raise pipeline.PipelineError("Not enough temporary disk space to combine these recordings.")
            composition_work.mkdir(exist_ok=True)
            if settings.get("background") and not audio_only:
                source = pipeline.process(source, composition_work, denoise_audio=False, atten_lim=None,
                    edits=[], cuts=[], preset="high", background=settings["background"],
                    progress=progress, preserve_resolution=True)
            mixer = compose_audio if audio_only else compose
            source = mixer(source, presenter, composition_work, settings["presenter"], progress)
        return pipeline.process(source, work, denoise_audio=settings["denoise"], atten_lim=settings["atten_lim"],
            preset=settings["preset"], edits=settings["edits"], cuts=settings["cuts"], progress=progress,
            background=settings.get("background") if not settings.get("presenter") else None,
            speed_regions=settings.get("speed_regions"), audio_regions=settings.get("audio_regions"), framing=settings.get("framing"), reframe=settings.get("reframe"), audio=settings.get("audio"),
            audio_offset=audio_offset, audio_duration=audio_duration)
    finally:
        shutil.rmtree(composition_work, ignore_errors=True)


def preview(source: Path, presenter: Path | None, work: Path, settings: dict,
            start: float, end: float, duration: float, progress) -> tuple[Path, list]:
    """Seek/decode only the requested source window; preserve original easing."""
    keep = pipeline.kept_ranges(settings["cuts"], duration) or [(0, duration)]
    ranges = [(max(a, start), min(b, end)) for a, b in keep if min(b, end) - max(a, start) > .05]
    if not ranges:
        raise pipeline.PipelineError("This range is entirely cut out.")
    sample = work / "sample.mkv"
    info = pipeline.probe(source)
    length = end - start
    # Retain the keyframe preroll so fps can hold the preceding frame when
    # the range starts between sparse/VFR frames. Accurate seek discards it.
    args = ["-ss", str(start), "-noaccurate_seek", "-i", str(source), "-t", str(length),
            "-map", "0:v:0?", "-map", "0:a:0?"]
    if info.has_video:
        args += ["-vf", f"fps={info.frame_rate}:start_time=0,tpad=stop_mode=clone:stop_duration={length},trim=duration={length}",
                 "-c:v", "ffv1"]
    if info.has_audio:
        args += ["-af", "atrim=start=0,asetpts=PTS-STARTPTS", "-c:a", "pcm_s16le"]
    pipeline._run_ffmpeg([*args, str(sample)], length, "Preparing selected range", progress)
    local = copy.deepcopy(settings)
    # Animation progress depends on the complete annotation interval. Clipping
    # it would restart an entrance or add an exit at the preview boundary.
    for key in ("edits", "cuts"):
        local[key] = []
        for edit in settings[key]:
            if min(end, edit["end"]) <= max(start, edit["start"]):
                continue
            animated = edit.get("type") == "annotation"
            local[key].append({**edit,
                "start": (edit["start"] if animated else max(start, edit["start"])) - start,
                "end": (edit["end"] if animated else min(end, edit["end"])) - start})
    local["audio_regions"] = [{**region,"start":region["start"]-start,"end":region["end"]-start}
        for region in settings.get("audio_regions", [])]
    local["speed_regions"] = [{**r,"start":max(start,r["start"])-start,"end":min(end,r["end"])-start}
        for r in settings.get("speed_regions", []) if r["end"] > start and r["start"] < end]
    if local.get("reframe"):
        # Keep complete section lengths, including negative local starts, so
        # clipping a preview never restarts or shortens a zoom transition.
        for section in local["reframe"]["sections"]:
            section["start"] -= start
            section["end"] -= start
    if local.get("presenter"):
        other = local["presenter"]
        other["trim_start"] += max(0, start - other["offset"])
        other["offset"] = max(0, other["offset"] - start)
        if other["trim_start"] >= other["trim_end"]:
            # No presenter frames in this interval; preserve its audio policy.
            other["offset"] = end - start + 1
            other["trim_start"] = other["trim_end"] - .001
    segments = pipeline.speed_segments(keep, settings.get("speed_regions", []))
    offset = sum(max(0, min(b, start)-a)/rate for a,b,rate in segments if a < start)
    output_duration = sum((b-a)/rate for a,b,rate in segments)
    try:
        output = render(sample, work, local, progress, presenter, offset, output_duration)
    finally:
        sample.unlink(missing_ok=True)
        (work / "raw.wav").unlink(missing_ok=True)
        shutil.rmtree(work / "denoised", ignore_errors=True)
    return output, pipeline.speed_segments(ranges, settings.get("speed_regions", [])) if settings.get("speed_regions") else ranges
