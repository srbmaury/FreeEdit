"""FFmpeg + DeepFilterNet processing pipeline.

Flow for a video:
    source.* --ffmpeg--> raw.wav --DeepFilterNet3--> denoised/raw_DeepFilterNet3.wav
    source.* + denoised wav + overlays --ffmpeg--> output.*
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

ProgressFn = Callable[[str, float | None], None]

HIDE_STYLES = {"blur", "pixelate", "black"}


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


def probe(path: Path) -> MediaInfo:
    out = subprocess.run(
        [FFPROBE(), "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True,
    )
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
    return MediaInfo(
        duration=float(data.get("format", {}).get("duration") or 0),
        has_video=video is not None,
        has_audio=audio is not None,
        width=width,
        height=height,
    )


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
    cmd = [FFMPEG(), "-hide_banner", "-y", "-nostats", "-progress", "pipe:1", *args]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert proc.stdout is not None
    for line in proc.stdout:
        if line.startswith("out_time_us=") and duration > 0:
            try:
                secs = int(line.split("=", 1)[1]) / 1_000_000
                progress(label, max(0.0, min(1.0, secs / duration)))
            except ValueError:
                pass
    stderr = proc.stderr.read() if proc.stderr else ""
    if proc.wait() != 0:
        tail = "\n".join(stderr.strip().splitlines()[-8:])
        raise PipelineError(f"ffmpeg failed during '{label}':\n{tail}")


WORKER = Path(__file__).with_name("df_worker.py")


def denoise(wav_in: Path, out_dir: Path, atten_lim: int | None, duration: float) -> Path:
    """Run DeepFilterNet3 in a separate Python process (see df_worker.py)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{wav_in.stem}_DeepFilterNet3.wav"
    python = os.environ.get("DEEPFILTER_PYTHON", sys.executable)
    cmd = [python, str(WORKER), str(wav_in), str(out), str(atten_lim or "")]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL,
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


def output_scale(info: MediaInfo) -> float:
    """Downscale factor so the long side fits MAX_OUTPUT_SIDE (unset = full size).

    Small hosts can't decode + filter + encode Retina-size frames in 512 MB.
    """
    limit = int(os.environ.get("MAX_OUTPUT_SIDE", 0))
    longest = max(info.width, info.height)
    return limit / longest if limit and longest > limit else 1.0


def build_video_edits(
    edits: list[dict], info: MediaInfo, work: Path, scale: float = 1.0
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
    cur = "[0:v]"
    n = 0
    if scale < 1:
        W, H = _even(W * scale), _even(H * scale)
        parts.append(f"[0:v]scale={W}:{H}[v0]")
        cur = "[v0]"

    def next_label() -> str:
        nonlocal n
        n += 1
        return f"[v{n}]"

    for i, e in enumerate(edits):
        kind = e.get("type")
        en = _enable(e, info.duration)
        if kind == "hide":
            x, y = _even(e["x"] * scale), _even(e["y"] * scale)
            w = _even(min(e["w"] * scale, W - x))
            h = _even(min(e["h"] * scale, H - y))
            if w < 4 or h < 4:
                continue
            style = e.get("style", "blur")
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
    k = len(keep)
    asrc = [f"[as{i}]" for i in range(k)] if k > 1 else [alabel]
    if k > 1:
        parts.append(f"{alabel}asplit={k}{''.join(asrc)}")
    for i, (a, b) in enumerate(keep):
        parts.append(f"{asrc[i]}atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[at{i}]")
    parts.append(f"{''.join(f'[at{i}]' for i in range(k))}concat=n={k}:v=0:a=1[aout]")
    return parts, "[vcut]", "[aout]"


def process(
    source: Path,
    work: Path,
    *,
    denoise_audio: bool,
    atten_lim: int | None,
    edits: list[dict],
    cuts: list[dict],
    progress: ProgressFn,
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

    # Audio-only input: the denoised audio is the result
    if not info.has_video:
        if not clean_wav:
            raise PipelineError("Nothing to do: audio file with noise removal turned off.")
        out = work / "output.wav"
        shutil.move(str(clean_wav), out)
        return out

    keep = kept_ranges(cuts, info.duration) if info.duration else None
    # Only downscale when we re-encode anyway; a denoise-only job copies the video
    scale = output_scale(info) if (edits or keep) else 1.0
    parts, images, vlabel = build_video_edits(edits, info, work, scale)
    if not parts and not keep and not do_denoise:
        raise PipelineError("Nothing to do: turn on noise removal, remove a part, or add an edit.")

    # Low-memory mode (hosting): single-threaded decode/filter/encode
    threads = os.environ.get("FFMPEG_THREADS")
    args = ["-threads", threads, "-filter_threads", threads] if threads else []
    args += ["-i", str(source)]
    if clean_wav:
        args += ["-i", str(clean_wav)]
    img_offset = 2 if clean_wav else 1
    for img in images:
        args += ["-i", str(img)]
    audio_in = "[1:a]" if clean_wav else ("[0:a]" if info.has_audio else None)

    out_duration = info.duration
    alabel = None
    if keep:
        cut_parts, vlabel, alabel = build_cuts(vlabel, audio_in, keep)
        parts += cut_parts
        out_duration = sum(b - a for a, b in keep)

    if parts:
        # Normalise output: even dimensions + yuv420p for broad player support
        parts.append(f"{vlabel}scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[vout]")
        graph = ";".join(parts)
        for idx in range(len(images)):
            graph = graph.replace(f"[IMG{idx}]", f"[{img_offset + idx}:v]")
        args += ["-filter_complex", graph, "-map", "[vout]"]
        args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]
        # Fewer encoder threads and a short lookahead keep x264's frame buffers small
        # (1080p: fits in ~370 MB total; defaults can exceed 512 MB)
        if threads:
            args += ["-threads", threads, "-rc-lookahead", "5"]
        out = work / "output.mp4"
    else:
        # Audio-only change: keep the original video stream bit-for-bit
        args += ["-map", "0:v:0", "-c:v", "copy"]
        ext = source.suffix.lower()
        out = work / f"output{ext if ext in ('.mp4', '.mov', '.m4v') else '.mkv'}"

    if alabel:
        args += ["-map", alabel]
    elif clean_wav:
        args += ["-map", "1:a:0"]
    elif info.has_audio:
        args += ["-map", "0:a:0?"]
    args += ["-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out)]

    _run_ffmpeg(args, out_duration, "Rendering video" if parts else "Rebuilding video", progress)
    return out
