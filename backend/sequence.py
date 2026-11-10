"""Build a normalized working source from ordered compatible clips."""
from __future__ import annotations

import subprocess
import shutil
from pathlib import Path

from . import pipeline


def rebuild(work: Path, clips: list[dict], transitions: list[dict] | None = None, *,
            output: Path | None = None) -> dict:
    if not 1 <= len(clips) <= 8:
        raise pipeline.PipelineError("A sequence must contain between 1 and 8 clips.")
    paths = [work / clip["file"] for clip in clips]
    infos = [pipeline.probe(path) for path in paths]
    first = infos[0]
    if not first.has_video:
        raise pipeline.PipelineError("Main clip sequences require video clips.")
    for info in infos[1:]:
        if (not info.has_video or info.width != first.width or info.height != first.height
                or info.has_audio != first.has_audio or abs(info.frame_rate-first.frame_rate) > .01):
            raise pipeline.PipelineError("Clips must have matching video dimensions, frame rate, and audio tracks.")
    if transitions is None:
        transitions = [{"type": "cut", "duration": 0} for _ in clips[1:]]
    if len(transitions) != len(clips) - 1:
        raise pipeline.PipelineError("Choose a transition for each clip join.")
    for index, transition in enumerate(transitions):
        if not isinstance(transition, dict):
            raise pipeline.PipelineError("Choose a valid transition for each clip join.")
        duration = transition.get("duration", 0)
        kind = transition.get("type")
        if (kind not in ("cut", "crossfade") or type(duration) not in (int, float)
                or not 0 <= duration <= min(infos[index].duration, infos[index + 1].duration, 2)):
            raise pipeline.PipelineError("Choose a valid transition duration (up to 2 seconds and shorter than both clips).")
        transition["duration"] = duration if kind == "crossfade" else 0
    total = sum(info.duration for info in infos) - sum(t["duration"] for t in transitions)
    required = 256 * 1024**2 + int(total * 8 * 1024**2)
    if shutil.disk_usage(work).free < required:
        raise pipeline.PipelineError("Not enough temporary storage to build this sequence. Use shorter clips or free disk space.")
    crossfade = any(t["type"] == "crossfade" and t["duration"] for t in transitions)
    video_format = ",format=yuv444p" if crossfade else ""
    rate = f"fps={first.frame_rate}"
    args = [pipeline.FFMPEG(), "-hide_banner", "-loglevel", "error", "-y", "-filter_complex_threads", "1"]
    for path in paths:
        args += ["-i", str(path)]
    graph = []
    for index, info in enumerate(infos):
        graph.append(f"[{index}:v:0]scale=ceil(iw/2)*2:ceil(ih/2)*2,setsar=1,setpts=PTS-STARTPTS,{rate}{video_format}[v{index}]")
        if first.has_audio:
            graph.append(f"[{index}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a{index}]")
    if not crossfade:
        concat_inputs = "".join(f"[v{i}][a{i}]" for i in range(len(paths))) if first.has_audio else "".join(f"[v{i}]" for i in range(len(paths)))
        graph.append(f"{concat_inputs}concat=n={len(paths)}:v=1:a={1 if first.has_audio else 0}[outv]" + ("[outa]" if first.has_audio else ""))
    else:
        # Chain joins while offsetting each next clip by the accumulated overlap.
        current_v, current_a = "v0", "a0"
        elapsed = infos[0].duration
        for index, transition in enumerate(transitions, 1):
            next_v, next_a = f"joinv{index}", f"joina{index}"
            d = transition["duration"] if transition["type"] == "crossfade" else 0
            offset = elapsed - d
            if d:
                graph.append(f"[{current_v}][v{index}]xfade=transition=fade:duration={d:.6f}:offset={offset:.6f},{rate}[{next_v}]")
                if first.has_audio:
                    graph.append(f"[{current_a}][a{index}]acrossfade=d={d:.6f}:c1=tri:c2=tri[{next_a}]")
            else:
                graph.append(f"[{current_v}][v{index}]concat=n=2:v=1:a=0,{rate}[{next_v}]")
                if first.has_audio:
                    graph.append(f"[{current_a}][a{index}]concat=n=2:v=0:a=1[{next_a}]")
            current_v, current_a = next_v, next_a
            elapsed += infos[index].duration - d
        graph.append(f"[{current_v}]null[outv]")
        if first.has_audio:
            graph.append(f"[{current_a}]anull[outa]")
    target = output or work / "sequence.mp4"
    output = target.with_suffix(".building.mp4")
    args += ["-filter_complex", ";".join(graph), "-map", "[outv]"]
    if first.has_audio:
        args += ["-map", "[outa]"]
    args += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-t", str(total), str(output)]
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=max(120, int(total * 20)))
    except (OSError, subprocess.TimeoutExpired) as exc:
        output.unlink(missing_ok=True)
        raise pipeline.PipelineError("Could not join these clips. Try shorter clips or check temporary storage.") from exc
    if result.returncode:
        output.unlink(missing_ok=True)
        raise pipeline.PipelineError("Could not join these clips. Confirm they use compatible media formats.")
    output.replace(target)
    return {"duration": total, "has_video": True, "has_audio": first.has_audio,
            "width": first.width + first.width % 2, "height": first.height + first.height % 2, "audio_channels": 2 if first.has_audio else 0,
            "frame_rate": first.frame_rate}
