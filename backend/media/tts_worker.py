"""Single-use narration worker. Script arrives via stdin, WAV leaves via stdout."""
import sys
from pathlib import Path
from contextlib import redirect_stdout

def main():
    # Prefer killing this disposable worker, not the web service, on Linux.
    try:
        Path("/proc/self/oom_score_adj").write_text("500")
    except OSError:
        pass
    payload = sys.stdin.buffer.read(8193)
    if len(payload) > 8192:
        return 2
    output = sys.stdout.buffer
    try:
        # Libraries can emit informational messages; keep the WAV stream clean.
        with redirect_stdout(sys.stderr):
            from backend.media.tts import NarrationRequest, synthesize
            settings = NarrationRequest.model_validate_json(payload)
            audio = synthesize(settings)
        output.write(audio)
        output.flush()
    except Exception as exc:
        print("Narration worker failed: " + type(exc).__name__, file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
