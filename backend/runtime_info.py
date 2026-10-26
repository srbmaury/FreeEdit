"""Identify the source loaded by a server without publishing local filesystem paths."""
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import subprocess


def source_info(root: Path) -> dict:
    digest = hashlib.sha256()
    files = [root / 'run.sh']
    for folder in ('backend', 'frontend'):
        files.extend(path for path in (root / folder).rglob('*')
                     if path.is_file() and path.suffix in ('.py', '.js', '.mjs', '.html', '.css'))
    for path in sorted(files):
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode() + b'\0')
            digest.update(path.read_bytes() + b'\0')
    revision = None
    modified = None
    try:
        result = subprocess.run(['git', '-C', str(root), 'rev-parse', '--short=12', 'HEAD'],
                                capture_output=True, text=True, timeout=2)
        if result.returncode == 0:
            revision = result.stdout.strip()
            status = subprocess.run(['git', '-C', str(root), 'status', '--porcelain', '--untracked-files=normal'],
                                    capture_output=True, text=True, timeout=2)
            if status.returncode == 0:
                modified = bool(status.stdout.strip())
    except (OSError, subprocess.TimeoutExpired):
        pass  # Source archives work without Git.
    return {'revision': revision, 'source_id': digest.hexdigest()[:12], 'modified': modified}


def runtime_info(root: Path) -> dict:
    return {**source_info(root), 'started_at': datetime.now(timezone.utc).isoformat()}
