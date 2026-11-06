"""Two-video composition on the main recording's original timeline."""
from pathlib import Path

from . import pipeline
from .background import create_mask


def audio_filters(info, other, settings, length, span, delay):
    """Shared main/presenter sound policy for video and audio-only outputs."""
    parts = []
    audio = []
    sound = settings['sound']
    if sound in ('main', 'both') and info.has_audio:
        parts.append(f'[0:a]asetpts=PTS-STARTPTS,volume={settings["main_volume"]},apad,atrim=duration={length}[mainaudio]')
        audio.append('[mainaudio]')
    if sound in ('presenter', 'both') and other.has_audio and span > 0:
        parts.append(f'[1:a]asetpts=PTS-STARTPTS,volume={settings["presenter_volume"]},adelay={round(delay * 1000)}:all=1,apad,atrim=duration={length}[presenteraudio]')
        audio.append('[presenteraudio]')
    if len(audio) == 2:
        parts.append(''.join(audio) + 'amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:latency=1[audio]')
    elif audio:
        parts.append(audio[0] + 'anull[audio]')
    elif sound != 'muted':
        # Silence preserves main duration before/after a trimmed presenter track.
        parts.append(f'anullsrc=r=48000:cl=stereo,atrim=duration={length}[audio]')
    return parts, bool(audio or sound != 'muted')


def compose(main: Path, presenter: Path, work: Path, settings: dict, progress,
            start: float = 0, length: float | None = None) -> Path:
    info = pipeline.probe(main)
    other = pipeline.probe(presenter)
    length = min(length or info.duration, info.duration - start)
    offset, trim_start, trim_end = settings['offset'], settings['trim_start'], settings['trim_end']
    visible_start = max(start, offset)
    visible_end = min(start + length, offset + trim_end - trim_start)
    span = max(0, visible_end - visible_start)
    source_start = trim_start + max(0, start - offset)
    delay = max(0, offset - start)
    output = work / 'combined.mp4'
    args = ['-ss', str(start), '-i', str(main)]
    # Decode only the presenter section used by this render.
    args += ['-ss', str(min(source_start, other.duration - .001)), '-t', str(max(.001, span)), '-i', str(presenter)]
    parts = [f'[0:v]tpad=stop_mode=clone:stop_duration={length},trim=duration={length},setpts=PTS-STARTPTS[main]']
    region = settings['box']
    w, h = region['w'], region['h']
    effect = settings['effect']
    mask = None
    if span > 0:
        parts.append(f'[1:v]setpts=PTS-STARTPTS,scale={w}:{h},setsar=1,format=rgba[presenter]')
        current = '[presenter]'
        if effect in ('remove', 'blur'):
            mask = create_mask(presenter, work, other, {}, progress, start=source_start, length=span)
            args += ['-i', str(mask)]
            parts.append(f'[2:v]scale={w}:{h},format=gray[mask]')
            if effect == 'remove':
                parts.append('[presenter][mask]alphamerge[person]')
            else:
                parts += ['[presenter]split=2[sharp][soft]', '[soft]gblur=sigma=16[blurred]',
                          '[blurred][sharp][mask]maskedmerge[person]']
            current = '[person]'
        outline_color = settings.get('outline_color')
        motion = settings.get('motion')
        x, y = str(region['x']), str(region['y'])
        if motion:
            if outline_color:
                thickness = max(2, min(8, min(w, h) // 30))
                parts.append(f'{current}format=rgba,crop={w-2*thickness}:{h-2*thickness}:{thickness}:{thickness},'
                             f'pad={w}:{h}:{thickness}:{thickness}:color=0x{outline_color[1:]}[outlined]')
                current = '[outlined]'
                outline_color = None
            if motion['zoom_from'] != 1 or motion['zoom_to'] != 1:
                zoom = pipeline.motion_zoom(motion, pipeline.motion_progress(trim_start-source_start, trim_end-trim_start))
                parts.append(f"{current}scale=w='round(iw*{zoom})':h='round(ih*{zoom})':eval=frame[zoomed]")
                current = '[zoomed]'
            progress_at = pipeline.motion_progress(offset-start, trim_end-trim_start)
            x = f"{x}+({w}-overlay_w)/2+({motion['dx']})*{progress_at}"
            y = f"{y}+({h}-overlay_h)/2+({motion['dy']})*{progress_at}"
        overlay_output = '[inset]' if outline_color else '[video]'
        parts += [f'{current}setpts=PTS+{delay}/TB[placed]',
                  f"[main][placed]overlay=x='{x}':y='{y}':eof_action=pass:repeatlast=0:"
                  f"enable='between(t,{delay},{delay + span})'{overlay_output}"]
        if outline_color:
            thickness = max(2, min(8, min(w, h) // 30))
            parts.append(f'[inset]drawbox=x={region["x"]}:y={region["y"]}:w={w}:h={h}:'
                         f'color=0x{outline_color[1:]}:t={thickness}:'
                         f'enable=\'gte(t,{delay})*lt(t,{delay + span})\'[video]')
    else:
        parts.append('[main]null[video]')
    audio_parts, has_audio = audio_filters(info, other, settings, length, span, delay)
    parts += audio_parts
    args += ['-filter_complex', ';'.join(parts), '-map', '[video]']
    if has_audio:
        args += ['-map', '[audio]', '-c:a', 'aac', '-b:a', '192k']
    args += ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-t', str(length), '-movflags', '+faststart', str(output)]
    try:
        pipeline._run_ffmpeg(args, length, 'Combining videos', progress)
    finally:
        if mask:
            mask.unlink(missing_ok=True)
    return output


def compose_audio(main: Path, presenter: Path, work: Path, settings: dict, progress) -> Path:
    """Mix sound without decoding video, rendering an inset or segmenting people."""
    info, other = pipeline.probe(main), pipeline.probe(presenter)
    length = info.duration
    span = max(0, min(length - settings['offset'], settings['trim_end'] - settings['trim_start']))
    parts, has_audio = audio_filters(info, other, settings, length, span, settings['offset'])
    if not has_audio:
        raise pipeline.PipelineError("Choose an audio source for an audio-only export.")
    output = work / 'combined.wav'
    args = ['-i', str(main), '-ss', str(min(settings['trim_start'], other.duration - .001)),
            '-t', str(max(.001, span)), '-i', str(presenter), '-vn',
            '-filter_complex', ';'.join(parts), '-map', '[audio]',
            '-ar', '48000', '-c:a', 'pcm_s16le', '-t', str(length), str(output)]
    pipeline._run_ffmpeg(args, length, 'Combining audio', progress)
    return output
