"""Opt-in media profiling with sampled process-tree RSS on macOS/Linux.

Run from the repository root with SOURCE and a NEW_OUTPUT_DIR. Generated
samples and JSON measurements stay in that directory. Full export is opt-in.
Noise reduction, person segmentation, browser/GPU memory and visual A/V sync
are outside this profile. The source is read without modification.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import threading
import time

from backend import pipeline, rendering
from backend.execution import Cancelled, JobControl, cancellation_scope


class MemorySampler:
    """Sample this process and descendants; RSS is a sampled upper observation."""

    def __init__(self):
        self.peak_kib = 0
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._sample, daemon=True)

    def _sample(self):
        while not self.stop.wait(.5):
            rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid=,rss='], text=True)
            processes = [tuple(map(int, row.split())) for row in rows.splitlines()]
            included = {os.getpid()}
            while True:
                descendants = {pid for pid, parent, _ in processes if parent in included}
                if descendants <= included:
                    break
                included.update(descendants)
            self.peak_kib = max(self.peak_kib, sum(rss for pid, _, rss in processes if pid in included))

    def measure(self, operation, action, work):
        self.peak_kib = 0
        started = time.monotonic()
        result = action()
        record = {'operation': operation, 'seconds': round(time.monotonic() - started, 3),
                  'process_tree_peak_rss_mib': round(self.peak_kib / 1024, 1) if self.peak_kib else None,
                  'result': result}
        with (work / 'results.jsonl').open('a') as output:
            output.write(json.dumps(record) + '\n')
        print(json.dumps(record), flush=True)


def check_cancellation(source, work, settings):
    control = JobControl()
    timer = threading.Timer(5, control.cancel)
    timer.start()
    try:
        with cancellation_scope(control):
            rendering.render(source, work, settings, lambda *_: None)
        return {'completed_before_cancellation': True}
    except Cancelled:
        return {'cancelled': True, 'children_stopped': all(p.poll() is not None for p in control.processes)}
    finally:
        timer.cancel()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path, help='New directory; existing folders are rejected')
    parser.add_argument('--full-export', action='store_true', help='Encode the entire source; may take a long time')
    args = parser.parse_args()
    source = args.source.expanduser().resolve()
    info = pipeline.probe(source)
    work = args.output.expanduser().resolve()
    work.mkdir(parents=True, exist_ok=False)
    sampler = MemorySampler()
    sampler.thread.start()
    progress = lambda *_: None
    try:
        sampler.measure('waveform', lambda: {'bins': len(pipeline.audio_waveform(source, info.duration))}, work)
        sampler.measure('pauses', lambda: pipeline.detect_silence(source, info.duration, -40, .8, .2,
            results_path=work / 'pauses.jsonl') | {'segments': 'see pauses.jsonl'}, work)
        start = max(0, info.duration - 30)
        end = min(info.duration, start + 15)
        settings = {'denoise': False, 'atten_lim': None, 'preset': 'small', 'edits': [],
                    'cuts': [{'start': start + 2, 'end': start + 3}] if end - start > 3 else [],
                    'audio': {'level_speech': True, 'fade_in': .5, 'fade_out': .5}}
        preview_work = work / 'late-preview'
        preview_work.mkdir()
        sampler.measure('late_preview', lambda: {'media': pipeline.probe(rendering.preview(
            source, None, preview_work, settings, start, end, info.duration, progress)[0]).__dict__}, work)
        cancel_work = work / 'cancel'
        cancel_work.mkdir()
        sampler.measure('cancel_export', lambda: check_cancellation(source, cancel_work, settings), work)
        if args.full_export:
            os.environ['FFMPEG_THREADS'] = '2'
            settings['cuts'] = [{'start': info.duration * fraction, 'end': info.duration * fraction + 2}
                                for fraction in (.01, .5, .99)] if info.duration > 200 else []
            full_work = work / 'full-export'
            full_work.mkdir()
            sampler.measure('full_export', lambda: {'media': pipeline.probe(rendering.render(
                source, full_work, settings, progress)).__dict__,
                'output_bytes': (full_work / 'output.mp4').stat().st_size}, work)
    finally:
        sampler.stop.set()
        sampler.thread.join(timeout=2)


if __name__ == '__main__':
    main()
