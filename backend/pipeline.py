"""FFmpeg + DeepFilterNet processing pipeline.

Flow for a video:
    source.* --ffmpeg--> raw.wav --DeepFilterNet3--> denoised/raw_DeepFilterNet3.wav
    source.* + denoised wav + overlays --ffmpeg--> output.*
"""

from __future__ import annotations

import base64
import array
from fractions import Fraction
import json
import math
import tempfile
import threading
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .execution import check_cancelled, run_process, start_process, kill_process

ProgressFn = Callable[[str, float | None], None]

HIDE_STYLES = {"blur", "pixelate", "black"}


EXPORT_PRESETS = {
    "balanced": {"label": "Balanced", "max_side": 0, "crf": 23, "audio_kbps": 192},
    "small": {"label": "Small file", "max_side": 1280, "crf": 28, "audio_kbps": 128},
    "high": {"label": "High quality", "max_side": 0, "crf": 18, "audio_kbps": 192},
    "audio_only": {"label": "Audio only", "max_side": 0},
}


class PipelineError(Exception):
    pass


def find_binary(name: str, env_var: str) -> str:
    """Resolve a binary from an env override, the running venv, or PATH."""
    override = os.environ.get(env_var)
    if override:
        return override
    venv_bin = Path(sys.executable).parent / name
    if venv_bin.exists():
        return str(venv_bin)
    found = shutil.which(name)
    if not found:
        raise PipelineError(f"'{name}' not found. Install it or set {env_var}.")
    return found


FFMPEG = lambda: find_binary("ffmpeg", "FFMPEG_BIN")  # noqa: E731
FFPROBE = lambda: find_binary("ffprobe", "FFPROBE_BIN")  # noqa: E731


@dataclass
class MediaInfo:
    duration: float
    has_video: bool
    has_audio: bool
    width: int = 0
    height: int = 0
    audio_channels: int = 0
    frame_rate: float = 30.0


def probe(path: Path) -> MediaInfo:
    try:
        out = run_process(
            [FFPROBE(), "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
            capture_output=True, text=True, timeout=30,
        )
    except subprocess.TimeoutExpired as exc:
        raise PipelineError("Reading this file timed out.") from exc
    if out.returncode != 0:
        raise PipelineError("Could not read this file. Is it a valid audio/video file?")
    data = json.loads(out.stdout)
    streams = data.get("streams", [])
    # Ignore cover-art "video" streams in audio files
    video = next(
        (s for s in streams if s.get("codec_type") == "video"
         and not s.get("disposition", {}).get("attached_pic")),
        None,
    )
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    width, height = (int(video.get("width", 0)), int(video.get("height", 0))) if video else (0, 0)
    # Phone videos may carry a 90/270° rotation; ffmpeg auto-rotates when filtering
    if video and _rotation(video) in (90, 270):
        width, height = height, width
    duration = float(data.get("format", {}).get("duration") or 0)
    if not (video or audio) or not math.isfinite(duration) or duration <= 0:
        raise PipelineError("This file has no playable media with a known duration.")
    return MediaInfo(
        duration=duration,
        has_video=video is not None,
        has_audio=audio is not None,
        width=width,
        height=height,
        audio_channels=int(audio.get("channels", 2)) if audio else 0,
        frame_rate=source_frame_rate(video),
    )


def source_frame_rate(video: dict | None) -> float:
    if not video:
        return 30.0
    try:
        rate = float(Fraction(video.get("avg_frame_rate") or video.get("r_frame_rate") or "30"))
        return round(min(60, max(1, rate)), 3) if math.isfinite(rate) and rate > 0 else 30.0
    except (ValueError, ZeroDivisionError, TypeError):
        return 30.0


def _rotation(stream: dict) -> int:
    rot = stream.get("tags", {}).get("rotate")
    if rot is None:
        for sd in stream.get("side_data_list", []):
            if "rotation" in sd:
                rot = sd["rotation"]
    try:
        return abs(int(float(rot or 0))) % 360
    except ValueError:
        return 0


def _run_ffmpeg(args: list[str], duration: float, label: str, progress: ProgressFn) -> None:
    """Run ffmpeg, reporting percentage progress from its -progress output."""
    cmd = [FFMPEG(), "-hide_banner", "-loglevel", "error", "-y", "-nostats", "-progress", "pipe:1", *args]
    timeout = max(30, float(os.environ.get("FFMPEG_TIMEOUT_SECONDS", 300 + duration * 10)))
    expired = threading.Event()
    # stderr must drain independently of progress or FFmpeg can deadlock.
    with tempfile.TemporaryFile(mode="w+t") as errors:
        proc = start_process(cmd, stdout=subprocess.PIPE, stderr=errors, text=True, stdin=subprocess.DEVNULL)
        def terminate():
            expired.set()
            kill_process(proc)
        timer = threading.Timer(timeout, terminate)
        timer.start()
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                if line.startswith("out_time_us=") and duration > 0:
                    try:
                        secs = int(line.split("=", 1)[1]) / 1_000_000
                        progress(label, max(0.0, min(1.0, secs / duration)))
                    except ValueError:
                        pass
            code = proc.wait()
        finally:
            timer.cancel()
            if proc.poll() is None:
                kill_process(proc)
            proc.wait()
            if proc.stdout:
                proc.stdout.close()
        check_cancelled()
        if expired.is_set():
            raise PipelineError(f"Export timed out during '{label}'. Try a shorter recording.")
        if code != 0:
            errors.seek(0)
            tail = "\n".join(errors.read()[-4000:].strip().splitlines()[-8:])
            raise PipelineError(f"ffmpeg failed during '{label}':\n{tail}")


WORKER = Path(__file__).with_name("df_worker.py")


def denoise(wav_in: Path, out_dir: Path, atten_lim: int | None, duration: float) -> Path:
    """Run DeepFilterNet3 in a separate Python process (see df_worker.py)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{wav_in.stem}_DeepFilterNet3.wav"
    python = os.environ.get("DEEPFILTER_PYTHON", sys.executable)
    cmd = [python, str(WORKER), str(wav_in), str(out), str(atten_lim) if atten_lim is not None else ""]
    try:
        proc = run_process(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL,
                              timeout=300 + duration * 5)
    except subprocess.TimeoutExpired:
        raise PipelineError("DeepFilterNet timed out.")
    if proc.returncode != 0 or not out.exists():
        tail = "\n".join(proc.stderr.strip().splitlines()[-8:])
        raise PipelineError(f"DeepFilterNet failed:\n{tail}")
    return out


def _even(v: float) -> int:
    return max(0, int(round(v / 2)) * 2)


def _enable(item: dict, duration: float) -> str:
    start = max(0.0, float(item.get("start", 0)))
    end = float(item.get("end", duration) or duration)
    return f"between(t,{start:.3f},{end:.3f})"


def output_scale(info: MediaInfo, preset: str = "balanced") -> float:
    """Fit the preset and server limits without upscaling.

    Small hosts can't decode + filter + encode Retina-size frames in 512 MB.
    """
    limit = int(os.environ.get("MAX_OUTPUT_SIDE", 0))
    preset_limit = EXPORT_PRESETS[preset]["max_side"]
    limit = min(limit, preset_limit) if limit and preset_limit else limit or preset_limit
    longest = max(info.width, info.height)
    return limit / longest if limit and longest > limit else 1.0


def reframe_geometry(width: int, height: int, settings: dict) -> tuple[int, int, int, int]:
    """Even crop rectangle, matching frontend/media-utils.js for normal video sizes."""
    ratios = {"wide": 16 / 9, "vertical": 9 / 16, "square": 1}
    aspect = settings["aspect"]
    ratio = ratios.get(aspect, width / height)
    available_w = min(width, height * ratio)
    available_h = min(height, width / ratio)
    w = max(2, min(width // 2 * 2, int(available_w / settings["zoom"] / 2) * 2))
    h = max(2, min(height // 2 * 2, int(available_h / settings["zoom"] / 2) * 2))
    x = int((width - w) * settings["focus_x"] / 2) * 2
    y = int((height - h) * settings["focus_y"] / 2) * 2
    return x, y, w, h


def reframe_expressions(sections: list[dict], axis: str) -> str:
    """Smoothstep per-section weights evaluated on the original input timeline.

    axis: z (zoom), x or y (focus). Each section eases from the unzoomed
    frame into the chosen region and returns to the unzoomed frame.
    """
    expr = "1" if axis == "z" else "0.5"
    for section in sections:
        start, end = section["start"], section["end"]
        ease = min(section["transition"], (end - start) / 2)
        if ease < .001:
            weight = f"between(T,{start:.3f},{end:.3f})"
        else:
            incoming = f"min(1,max(0,(T-{start:.3f})/{ease:.3f}))"
            outgoing = f"min(1,max(0,({end:.3f}-T)/{ease:.3f}))"
            # Both ends use cubic ease-in/ease-out: C1-continuous at joins.
            weight = f"({incoming})*({outgoing})"
            weight = f"({weight})*({weight})*(3-2*({weight}))"
        value = section["zoom"] - 1 if axis == "z" else section["focus_" + axis] - .5
        if abs(value) >= .000001:
            expr += f"+({value:.6f})*({weight})"
    return expr


def build_timed_reframe(vlabel: str, width: int, height: int, settings: dict, fps: float) -> tuple[list[str], str]:
    """Constant aspect ratio; animate zoom and focus in original-timeline sections.

    A time-varying base crop recenters the aspect-ratio region, then zoompan
    animates the zoom inside it. The combined crop maps to the same source
    rectangle as the browser's geometry calculation.
    """
    if settings["aspect"] not in ("original", "wide", "vertical", "square"):
        raise PipelineError("Unsupported reframe aspect ratio.")
    _, _, w, h = reframe_geometry(width, height,
        {"aspect": settings["aspect"], "zoom": 1, "focus_x": .5, "focus_y": .5})
    sections = settings["sections"]
    z = reframe_expressions(sections, "z").replace("T", "in_time")
    fx_t = reframe_expressions(sections, "x").replace("T", "t")
    fy_t = reframe_expressions(sections, "y").replace("T", "t")
    fx_in = reframe_expressions(sections, "x").replace("T", "in_time")
    fy_in = reframe_expressions(sections, "y").replace("T", "in_time")
    graph = [
        f"{vlabel}fps={fps:.3f},crop={w}:{h}:x='(iw-ow)*({fx_t})':y='(ih-oh)*({fy_t})':exact=1[reframebase]",
        f"[reframebase]zoompan=z='{z}':x='(iw-iw/zoom)*({fx_in})':y='(ih-ih/zoom)*({fy_in})':d=1:s={w}x{h}:fps={fps:.3f}[reframed]"
    ]
    return graph, "[reframed]"


def build_video_edits(
    edits: list[dict], info: MediaInfo, work: Path, scale: float = 1.0,
    background=None, mask_input=None, image_input=None,
) -> tuple[list[str], list[Path], str]:
    """Filter chains for hide regions and text overlays.

    Returns (filter_parts, text_images, final_label). Text images are referenced
    as [IMG<n>] placeholders; the caller swaps them for real input indices once
    the input order is known. Times are on the original (uncut) timeline.
    Edit coordinates are in source pixels and get multiplied by `scale`.
    """
    W, H = info.width, info.height
    parts: list[str] = []
    images: list[Path] = []
    # Some screen recordings stop emitting frames before their audio ends.
    # Hold the last frame through the media duration before applying timed edits.
    parts.append(f"[0:v]tpad=stop_mode=clone:stop_duration={info.duration:.3f},trim=duration={info.duration:.3f}[vbase]")
    cur = "[vbase]"
    n = 0
    if scale < 1:
        W, H = _even(W * scale), _even(H * scale)
        parts.append(f"{cur}scale={W}:{H}[v0]")
        cur = "[v0]"

    def next_label() -> str:
        nonlocal n
        n += 1
        return f"[v{n}]"

    if background:
        from .background import filters
        background_parts, cur = filters(cur, info, scale, background, mask_input, image_input)
        parts += background_parts

    for i, e in enumerate(edits):
        kind = e.get("type")
        en = _enable(e, info.duration)
        if kind == "hide":
            style = e.get("style", "black")
            if style == "black":
                x, y = math.floor(e["x"] * scale), math.floor(e["y"] * scale)
                w = min(W, math.ceil((e["x"] + e["w"]) * scale)) - x
                h = min(H, math.ceil((e["y"] + e["h"]) * scale)) - y
            else:
                x, y = _even(e["x"] * scale), _even(e["y"] * scale)
                w = _even(min(e["w"] * scale, W - x))
                h = _even(min(e["h"] * scale, H - y))
                if w < 4 or h < 4:
                    continue
            if style not in HIDE_STYLES:
                style = "blur"
            if style == "black":
                out = next_label()
                parts.append(f"{cur}drawbox=x={x}:y={y}:w={w}:h={h}:color=black:t=fill:enable='{en}'{out}")
                cur = out
                continue
            base, patch = f"[b{i}]", f"[p{i}]"
            parts.append(f"{cur}split=2{base}[c{i}]")
            if style == "blur":
                r = max(1, min(w, h) // 8)
                rc = max(1, min(w, h) // 16)
                fx = f"boxblur=luma_radius={r}:luma_power=3:chroma_radius={rc}:chroma_power=3"
            else:  # pixelate
                block = max(4, min(w, h) // 12)
                sw, sh = max(1, w // block), max(1, h // block)
                fx = f"scale={sw}:{sh}:flags=area,scale={w}:{h}:flags=neighbor"
            parts.append(f"[c{i}]crop={w}:{h}:{x}:{y},{fx}{patch}")
            out = next_label()
            parts.append(f"{base}{patch}overlay={x}:{y}:enable='{en}'{out}")
            cur = out
        elif kind == "text":
            png = e.get("image", "")
            if not png.startswith("data:image/png;base64,"):
                continue
            img_path = work / f"text_{i}.png"
            img_path.write_bytes(base64.b64decode(png.split(",", 1)[1]))
            images.append(img_path)
            img = f"[IMG{len(images) - 1}]"
            if scale < 1:
                parts.append(f"{img}scale=iw*{scale:.5f}:-1[t{i}]")
                img = f"[t{i}]"
            out = next_label()
            x, y = int(e["x"] * scale), int(e["y"] * scale)
            # Single-frame input; overlay's default eof_action=repeat keeps it on
            # screen. (A `-loop 1` input is an endless stream that ffmpeg reads
            # ahead of, buffering gigabytes once cuts shift the output timeline.)
            parts.append(f"{cur}{img}overlay={x}:{y}:enable='{en}'{out}")
            cur = out

    return parts, images, cur


def kept_ranges(cuts: list[dict], duration: float) -> list[tuple[float, float]] | None:
    """Turn 'remove' ranges into the ranges to keep. None means nothing is cut."""
    spans = sorted(
        (max(0.0, float(c["start"])), min(duration, float(c["end"])))
        for c in cuts
        if float(c["end"]) - float(c["start"]) > 0.01
    )
    if not spans:
        return None
    merged: list[list[float]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    keep, t = [], 0.0
    for a, b in merged:
        if a - t > 0.05:
            keep.append((t, a))
        t = max(t, b)
    if duration - t > 0.05:
        keep.append((t, duration))
    if not keep:
        raise PipelineError("You removed the whole video. Keep at least a short part of it.")
    return keep


def build_cuts(
    vlabel: str, alabel: str | None, keep: list[tuple[float, float]]
) -> tuple[list[str], str, str | None]:
    """Drop the removed ranges and close the gaps.

    Video uses select + setpts, which streams frame by frame. (split + trim +
    concat would queue every frame of the later segments while the first is
    being encoded: ~1 GB for a 5 s gap at 1080p60.) Timestamps are shifted by
    the total length removed before each frame, so VFR input stays in sync.
    Audio is small, so plain atrim + concat is fine there.
    """
    parts: list[str] = []
    keep_expr = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in keep)
    # STARTPTS drops any leading removed range; each later gap is subtracted
    # once a frame is past it
    shift = "+".join(
        f"gte(T,{keep[i + 1][0]:.3f})*{keep[i + 1][0] - keep[i][1]:.3f}"
        for i in range(len(keep) - 1)
    ) or "0"
    parts.append(f"{vlabel}select='{keep_expr}',setpts='PTS-STARTPTS-({shift})/TB'[vcut]")

    if not alabel:
        return parts, "[vcut]", None
    audio_parts, audio_out = build_audio_cuts(alabel, keep)
    return parts + audio_parts, "[vcut]", audio_out


def build_audio_cuts(alabel: str, keep: list[tuple[float, float]]) -> tuple[list[str], str]:
    k = len(keep)
    parts = []
    asrc = [f"[as{i}]" for i in range(k)] if k > 1 else [alabel]
    if k > 1:
        parts.append(f"{alabel}asplit={k}{''.join(asrc)}")
    for i, (a, b) in enumerate(keep):
        parts.append(f"{asrc[i]}atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[at{i}]")
    parts.append(f"{''.join(f'[at{i}]' for i in range(k))}concat=n={k}:v=0:a=1[aout]")
    return parts, "[aout]"


def audio_waveform(source: Path, duration: float) -> list[float]:
    """Read a compact amplitude envelope without holding decoded audio in RAM."""
    rate = 8000
    samples_per_bin = max(1, math.ceil(duration * rate / 4096))
    cmd = [FFMPEG(), "-hide_banner", "-loglevel", "error", "-nostdin", "-i", str(source),
           "-map", "0:a:0", "-vn", "-ac", "1",
           "-af", f"aresample={rate}:async=1:first_pts=0", "-t", str(duration), "-f", "s16le", "pipe:1"]
    with tempfile.TemporaryFile() as audio:
        try:
            result = run_process(cmd, stdout=audio, stderr=subprocess.PIPE, timeout=30 + duration)
        except subprocess.TimeoutExpired as exc:
            raise PipelineError("Waveform generation timed out.") from exc
        if result.returncode:
            raise PipelineError("Waveform is unavailable for this file.")
        audio.seek(0)
        peaks = []
        for _ in range(math.ceil(duration * rate / samples_per_bin)):
            chunk = audio.read(samples_per_bin * 2)
            samples = array.array("h")
            samples.frombytes(chunk)
            if sys.byteorder != "little":
                samples.byteswap()
            peaks.append(max((abs(value) for value in samples), default=0))
    maximum = max(peaks, default=0) or 1
    return [round(peak / maximum, 4) for peak in peaks]


def detect_silence(source: Path, duration: float, threshold_db: float, min_duration: float, padding: float) -> dict:
    """Return conservative suggestions; the user chooses which become cuts."""
    cmd = [FFMPEG(), "-hide_banner", "-nostdin", "-i", str(source), "-map", "0:a:0",
           "-af", f"silencedetect=noise={threshold_db}dB:d={min_duration}", "-f", "null", "-"]
    try:
        result = run_process(cmd, capture_output=True, text=True, timeout=60 + duration * 2)
    except subprocess.TimeoutExpired as exc:
        raise PipelineError("Silence detection timed out. Try a shorter recording.") from exc
    if result.returncode:
        raise PipelineError("Could not analyze the audio in this recording.")
    intervals = []
    start = None
    for kind, value in re.findall(r"silence_(start|end):\s*(-?[\d.]+)", result.stderr):
        t = min(duration, max(0, float(value)))
        if kind == "start":
            start = t
        elif start is not None:
            intervals.append((start, t))
            start = None
    if start is not None:
        intervals.append((start, duration))
    suggestions = [{"start": round(a + padding, 3), "end": round(b - padding, 3)}
                   for a, b in intervals if b - a - padding * 2 >= 0.1]
    return {"segments": suggestions[:100], "truncated": len(suggestions) > 100}


def process(
    source: Path,
    work: Path,
    *,
    denoise_audio: bool,
    atten_lim: int | None,
    edits: list[dict],
    cuts: list[dict],
    progress: ProgressFn,
    preset: str = "balanced",
    background: dict | None = None,
    preserve_resolution: bool = False,
    reframe: dict | None = None,
) -> Path:
    progress("Reading file", None)
    info = probe(source)
    do_denoise = denoise_audio and info.has_audio
    clean_wav: Path | None = None

    if do_denoise:
        raw = work / "raw.wav"
        _run_ffmpeg(["-i", str(source), "-vn", "-ar", "48000", str(raw)],
                    info.duration, "Extracting audio", progress)
        progress("Removing background noise", None)
        clean_wav = denoise(raw, work / "denoised", atten_lim, info.duration)

    keep = kept_ranges(cuts, info.duration)
    if not info.has_video or preset == "audio_only":
        out = work / "output.wav"
        args = ["-i", str(clean_wav or source), "-vn"]
        if keep:
            audio_parts, alabel = build_audio_cuts("[0:a:0]", keep)
            args += ["-filter_complex", ";".join(audio_parts), "-map", alabel]
        else:
            args += ["-map", "0:a:0"]
        args += ["-ar", "48000", "-c:a", "pcm_s16le", str(out)]
        _run_ffmpeg(args, sum(b - a for a, b in keep) if keep else info.duration, "Exporting audio", progress)
        return out

    settings = EXPORT_PRESETS[preset]
    scale = 1.0 if preserve_resolution else output_scale(info, preset)
    mask = None
    replacement = None
    extra_index = 2 if clean_wav else 1
    if background:
        from .background import create_mask
        mask = create_mask(source, work, info, background, progress)
        if background["mode"] == "image":
            replacement = work / "background.png"
            replacement.write_bytes(base64.b64decode(background["image"].split(",", 1)[1]))
    parts, images, vlabel = build_video_edits(edits, info, work, scale, background, extra_index, extra_index + 1)

    # Low-memory mode (hosting): single-threaded decode/filter/encode
    threads = os.environ.get("FFMPEG_THREADS")
    args = ["-threads", threads, "-filter_threads", threads] if threads else []
    args += ["-i", str(source)]
    if clean_wav:
        args += ["-i", str(clean_wav)]
    if mask:
        args += ["-i", str(mask)]
    if replacement:
        args += ["-i", str(replacement)]
    img_offset = extra_index + bool(mask) + bool(replacement)
    for img in images:
        args += ["-i", str(img)]
    audio_in = "[1:a]" if clean_wav else ("[0:a]" if info.has_audio else None)

    out_duration = info.duration
    alabel = None
    if keep:
        cut_parts, vlabel, alabel = build_cuts(vlabel, audio_in, keep)
        parts += cut_parts
        out_duration = sum(b - a for a, b in keep)

    # Crop after all overlays to preserve source-pixel positioning and timings.
    if reframe:
        if reframe.get("sections"):
            reframe_parts, vlabel = build_timed_reframe(
                vlabel, _even(info.width * scale), _even(info.height * scale),
                reframe, info.frame_rate)
            parts += reframe_parts
        else:
            x, y, w, h = reframe_geometry(_even(info.width * scale), _even(info.height * scale), reframe)
            parts.append(f"{vlabel}crop={w}:{h}:{x}:{y}[reframed]")
            vlabel = "[reframed]"
    # Every video preset produces compatible H.264 MP4 with even dimensions.
    parts.append(f"{vlabel}scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[vout]")
    graph = ";".join(parts)
    for idx in range(len(images)):
        graph = graph.replace(f"[IMG{idx}]", f"[{img_offset + idx}:v]")
    args += ["-filter_complex", graph, "-map", "[vout]",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", str(settings["crf"])]
    if threads:
        args += ["-threads", threads, "-rc-lookahead", "5"]
    out = work / "output.mp4"

    if alabel:
        args += ["-map", alabel]
    elif clean_wav:
        args += ["-map", "1:a:0"]
    elif info.has_audio:
        args += ["-map", "0:a:0?"]
    args += ["-c:a", "aac", "-b:a", f"{settings['audio_kbps']}k", "-shortest", "-t", str(out_duration), "-movflags", "+faststart", str(out)]

    try:
        _run_ffmpeg(args, out_duration, "Rendering video", progress)
    finally:
        for temporary in (mask, replacement):
            if temporary:
                temporary.unlink(missing_ok=True)
    return out


def noise_preview(source: Path, work: Path, start: float, length: float,
                  atten_lim: int | None, progress: ProgressFn) -> None:
    """A bounded audio-only sample, independent of cuts and rendered exports."""
    work.mkdir(parents=True, exist_ok=True)
    raw = work / "original.wav"
    _run_ffmpeg(["-ss", str(start), "-i", str(source), "-t", str(length),
                 "-vn", "-ar", "48000", "-ac", "2", str(raw)],
                length, "Preparing audio sample", progress)
    progress("Removing noise from sample", None)
    clean = denoise(raw, work / "denoised", atten_lim, length)
    shutil.move(str(clean), work / "clean.wav")
    shutil.rmtree(work / "denoised")
