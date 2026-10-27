"""Repeatable local/CI checks: python -m scripts.check [--suite python|frontend] [--models]."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("all", "python", "frontend"), default="all")
    parser.add_argument("--models", action="store_true", help="Also exercise the real denoiser; segmentation needs FREEEDIT_PERSON_FIXTURE.")
    args = parser.parse_args()
    commands = []
    if args.suite in ("all", "python"):
        if sys.version_info[:2] != (3, 12):
            print("Use Python 3.12, for example .venv/bin/python -m scripts.check", file=sys.stderr)
            return 1
        commands.extend([
            [sys.executable, "-m", "pip", "check"],
            [sys.executable, "-m", "compileall", "-q", "backend", "tests", "scripts"],
            [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
            [sys.executable, "-m", "backend.preflight", "--verify-render"],
        ])
    if args.suite in ("all", "frontend"):
        node = shutil.which("node")
        if node is None:
            print("Install Node.js 22+ for frontend checks.", file=sys.stderr)
            return 1
        files = sorted([*ROOT.glob("frontend/*.js"), *ROOT.glob("frontend/*.mjs")])
        commands.extend([[node, "--check", str(path)] for path in files])
        tests = sorted([*ROOT.glob("tests/*.cjs"), *ROOT.glob("tests/test_*.mjs")])
        commands.append([node, "--test", *(str(path) for path in tests)])
    if args.models:
        commands.append([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "model_smoke.py", "-v"])
    for command in commands:
        print("Checking:", " ".join(command), flush=True)
        result = subprocess.run(command, cwd=ROOT)
        if result.returncode:
            return result.returncode
    print("All requested checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
