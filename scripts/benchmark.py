"""Opt-in synthetic media measurement, not a regression suite.

Run: .venv/bin/python -m scripts.benchmark --seconds 600 --denoise
Writes its generated media and measurement.json to a fresh directory.
"""
import argparse
import json
import platform
import resource
import tempfile
import time
from pathlib import Path

from backend import pipeline


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=int, default=600)
    parser.add_argument("--denoise", action="store_true")
    args = parser.parse_args()
    if not 10 <= args.seconds <= 14400:
        parser.error("Choose 10–14400 seconds.")
    work = Path(tempfile.mkdtemp(prefix="freeedit-measurement-"))
    source = work / "source.mp4"
    generated = pipeline.run_process([pipeline.FFMPEG(), "-v", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=10",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", str(args.seconds), "-c:v", "libx264", "-preset", "ultrafast",
        "-crf", "35", "-c:a", "aac", str(source)], timeout=args.seconds * 2 + 60)
    if generated.returncode or not source.is_file():
        raise RuntimeError("Could not generate measurement source.")
    stages = []
    started = time.monotonic()
    def progress(stage, pct):
        if not stages or stages[-1]["stage"] != stage:
            stages.append({"stage": stage, "elapsed_seconds": round(time.monotonic() - started, 2)})
            print(stage, flush=True)
    waveform_start = time.monotonic()
    peaks = pipeline.audio_waveform(source, args.seconds)
    waveform_seconds = time.monotonic() - waveform_start
    started = time.monotonic()
    out = pipeline.process(source, work, denoise_audio=args.denoise, atten_lim=18,
        preset="small", cuts=[{"start": 2, "end": 4}],
        edits=[{"type": "hide", "x": 20, "y": 20, "w": 160, "h": 80,
                "style": "black", "start": 0, "end": args.seconds}], progress=progress)
    elapsed = time.monotonic() - started
    output = pipeline.probe(out)
    if abs(output.duration - (args.seconds - 2)) > 0.25:
        raise RuntimeError("Output duration did not match the requested cut.")
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    report = {"platform": platform.platform(), "machine": platform.machine(),
        "seconds": args.seconds, "synthetic": True, "resolution": "1280x720", "fps": 10,
        "denoise": args.denoise, "preset": "small", "export_seconds": round(elapsed, 2),
        "waveform_seconds": round(waveform_seconds, 2), "waveform_bins": len(peaks),
        "output_duration": output.duration, "source_bytes": source.stat().st_size,
        "output_bytes": out.stat().st_size,
        "largest_child_peak_rss_mb": round(rss / (1024**2 if platform.system() == "Darwin" else 1024), 1),
        "temporary_bytes_after_export": sum(p.stat().st_size for p in work.rglob("*") if p.is_file()),
        "stages": stages,
        "limits": "Largest child RSS is not total simultaneous app/browser memory. Synthetic footage does not establish real-world duration limits."}
    (work / "measurement.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    print(f"Artifacts: {work}")


if __name__ == "__main__":
    main()
