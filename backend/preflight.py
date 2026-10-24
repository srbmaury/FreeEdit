"""Run from the project root: python -m backend.preflight [--warm-model]."""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from .diagnostics import inspect_setup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--warm-model", action="store_true", help="Download/load the noise model now (requires internet on first use).")
    args = parser.parse_args()
    work = Path(os.environ.get("FREEEDIT_JOBS_DIR", "jobs"))
    try:
        work.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=work) as file:
            file.write(b"ok")
    except OSError as error:
        print(f"Temporary storage is not writable: {error}", file=sys.stderr)
        return 1
    checks = inspect_setup(work)["checks"]
    for check in checks:
        print(f"{'OK' if check['ready'] else 'CHECK'} {check['name']}: {check['message']}")
    if args.warm_model:
        if not next(c["ready"] for c in checks if c["name"] == "Noise reduction"):
            print("Install noise dependencies with ./setup.sh before downloading the model.")
            return 1
        python = os.environ.get("DEEPFILTER_PYTHON", sys.executable)
        try:
            result = subprocess.run([python, "-c", "from df.enhance import init_df; init_df(log_level='ERROR')"], timeout=300)
            if result.returncode:
                return 1
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f"Model initialization failed: {error}", file=sys.stderr)
            return 1
        print("Noise model loaded successfully.")
    return 0 if all(c["ready"] for c in checks if c["name"] in ("ffmpeg", "ffprobe", "Temporary disk")) else 1


if __name__ == "__main__":
    raise SystemExit(main())
