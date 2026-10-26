"""Opt-in real-media effect measurement; output directory must be new.

Example: python -m scripts.profile_effects movie.mkv /tmp/noise-new --effect noise
Noise measures a full-length audio-only export. Background measures full-length
blur. Presenter measures full-length main video with the selected presenter
range, background blur, mixed sound, a cut and audio finishing. Optional model
runtimes must be configured as for the app. Overlays measures 100 simultaneous
PNG inputs through the text-overlay path without optional models. This can take a long time.
"""
import argparse
import base64
import subprocess
import os
from pathlib import Path

from backend import pipeline, rendering
from scripts.profile_media import MemorySampler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--effect', required=True, choices=('noise', 'background', 'presenter', 'overlays'))
    parser.add_argument('--presenter', type=Path)
    parser.add_argument('--presenter-start', type=float, default=0)
    parser.add_argument('--presenter-end', type=float)
    parser.add_argument('--threads', type=int, default=2, help='FFmpeg encoder threads; at least one')
    args = parser.parse_args()
    if args.threads < 1:
        parser.error('--threads must be at least one')
    source = args.source.expanduser().resolve()
    info = pipeline.probe(source)
    if args.effect == 'noise' and not info.has_audio:
        parser.error('Noise removal needs an audio track')
    if args.effect != 'noise' and not info.has_video:
        parser.error('This effect needs a video track')
    settings = {'denoise': args.effect == 'noise', 'atten_lim': 18, 'edits': [], 'cuts': [],
                'preset': 'audio_only' if args.effect == 'noise' else 'small'}
    presenter = None
    if args.effect == 'overlays':
        # Exercise all 100 PNG inputs without requiring Pillow or optional ML.
        # The identical synthetic pattern is intentional: this measures rendering resources,
        # not caption generation, readability, font coverage or visual quality.
        png = subprocess.check_output([pipeline.FFMPEG(), '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'testsrc=s=240x40:d=1',
            '-frames:v', '1', '-threads', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'])
        image = 'data:image/png;base64,' + base64.b64encode(png).decode()
        settings['edits'] = [{'type': 'text', 'image': image, 'x': 0, 'y': 0,
                              'start': 0, 'end': info.duration} for _ in range(100)]
    if args.effect == 'background':
        settings['background'] = {'mode': 'blur', 'blur': 16}
    if args.effect == 'presenter':
        if not args.presenter:
            parser.error('--presenter is required for presenter measurement')
        presenter = args.presenter.expanduser().resolve()
        other = pipeline.probe(presenter)
        end = args.presenter_end if args.presenter_end is not None else other.duration
        if not other.has_video or not 0 <= args.presenter_start < end <= other.duration:
            parser.error('Choose a valid presenter video and trim range')
        width = max(8, int(info.width * .25) // 2 * 2)
        height = max(8, int(width * other.height / other.width) // 2 * 2)
        if height > info.height:
            parser.error('Presenter aspect ratio does not fit this main video')
        sound = 'both' if info.has_audio and other.has_audio else 'main' if info.has_audio else 'presenter' if other.has_audio else 'muted'
        settings['presenter'] = {'box': {'x': info.width-width, 'y': info.height-height, 'w': width, 'h': height},
            'offset': 0, 'trim_start': args.presenter_start, 'trim_end': end, 'effect': 'blur',
            'sound': sound, 'main_volume': .5, 'presenter_volume': .5}
        settings['audio'] = {'level_speech': True, 'fade_in': 1, 'fade_out': 1}
        if info.duration > 10:
            settings['cuts'] = [{'start': 2, 'end': 4}]
    work = args.output.expanduser().resolve()
    work.mkdir(parents=True, exist_ok=False)
    os.environ['FFMPEG_THREADS'] = str(args.threads)
    sampler = MemorySampler()
    sampler.thread.start()

    def measure():
        output = rendering.render(source, work, settings, lambda *_: None, presenter=presenter)
        media = pipeline.probe(output)
        expected = info.duration - sum(cut['end']-cut['start'] for cut in settings['cuts'])
        if abs(media.duration - expected) > .2:
            raise RuntimeError(f'Expected {expected:.3f}s output; got {media.duration:.3f}s')
        return {'media': media.__dict__, 'output_bytes': output.stat().st_size,
                'files_bytes_after_export': sum(path.stat().st_size for path in work.rglob('*') if path.is_file())}

    try:
        sampler.measure(f'{args.effect}_export', measure, work)
    finally:
        sampler.stop.set()
        sampler.thread.join(timeout=2)


if __name__ == '__main__':
    main()
