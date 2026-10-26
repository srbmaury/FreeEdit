"""Launch the checkout containing this module, with actionable port-conflict feedback."""
import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys

from .runtime_info import source_info

ROOT = Path(__file__).resolve().parent.parent


def available_port(value):
    try:
        port = int(value)
        if not 1 <= port <= 65535:
            raise ValueError
    except (ValueError, TypeError):
        raise argparse.ArgumentTypeError('Port must be a number between 1 and 65535.') from None
    return port


def check_port(port):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', port))
    except OSError as error:
        raise RuntimeError(
            f'Cannot use port {port}: {error.strerror}.\n'
            f'Another app may already be listening. Inspect it with:\n'
            f'  lsof -nP -iTCP:{port} -sTCP:LISTEN\n'
            'Keep that process running and choose another port, for example:\n'
            f'  PORT={port + 1 if port < 65535 else 8000} ./run.sh'
        ) from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=available_port, default=os.environ.get('PORT', '8000'))
    args = parser.parse_args()
    try:
        check_port(args.port)
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1
    info = source_info(ROOT)
    print(f'Checkout: {ROOT}\nPython: {sys.executable}\n'
          f'Revision: {info["revision"] or "source archive"} · source {info["source_id"]}'
          f'{" · local changes" if info["modified"] else ""}', flush=True)
    result = subprocess.run([sys.executable, '-m', 'backend.preflight'], cwd=ROOT)
    if result.returncode:
        return result.returncode
    print(f'Starting FreeEdit at http://127.0.0.1:{args.port}', flush=True)
    import uvicorn
    uvicorn.run('backend.app:app', host='127.0.0.1', port=args.port, access_log=False)
    return 0


if __name__ == '__main__':
    sys.exit(main())
