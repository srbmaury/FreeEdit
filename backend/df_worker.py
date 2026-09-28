"""Denoise one WAV with DeepFilterNet3, streaming in chunks.

Usage: python df_worker.py <input.wav> <output.wav> [atten_lim_db]

Notes:
- We call the Python API instead of the `deepFilter` CLI because the CLI can
  hang on interpreter shutdown (multiprocessing resource_tracker) when it isn't
  attached to a terminal, as happens when a server launches it. We exit with
  os._exit once the file is written so shutdown can't block.
- `enhance()` holds the whole clip plus autograd buffers in memory (~13 MB per
  second of audio). We run it under inference_mode on short chunks so memory
  stays flat (~300 MB) regardless of length, which fits small hosts. Each chunk
  gets PREROLL seconds of preceding audio so the model has settled by the time
  its output is kept, and neighbouring chunks are crossfaded over FADE seconds.
"""

import os
import sys

CHUNK_S = float(os.environ.get("DF_CHUNK_SECONDS", 5))
PREROLL_S = 1.0
FADE_S = 0.05


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    atten = float(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None

    import numpy as np
    import soundfile as sf
    import torch
    from df.enhance import enhance, init_df

    # Defaults to torch's own choice, which honours OMP_NUM_THREADS. On a 1-CPU
    # container extra threads only contend: 1 thread was ~30x faster than 8.
    if os.environ.get("DF_THREADS"):
        torch.set_num_threads(int(os.environ["DF_THREADS"]))
    model, df_state, _ = init_df(log_level="ERROR")
    sr = df_state.sr()

    with sf.SoundFile(src) as fin:
        if fin.samplerate != sr:
            raise ValueError(f"Expected {sr} Hz input, got {fin.samplerate} Hz")
        total, channels = fin.frames, fin.channels
        chunk, pre, fade = int(CHUNK_S * sr), int(PREROLL_S * sr), int(FADE_S * sr)
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)[:, None]
        tail = None  # previous chunk's overlap region, to crossfade into this one

        with sf.SoundFile(dst, "w", samplerate=sr, channels=channels, subtype="PCM_16") as fout:
            for start in range(0, total, chunk):
                end = min(total, start + chunk)
                win_start = max(0, start - pre)
                win_end = min(total, end + fade)
                fin.seek(win_start)
                data = fin.read(win_end - win_start, dtype="float32", always_2d=True)
                with torch.inference_mode():
                    out = enhance(model, df_state, torch.from_numpy(data.T.copy()), atten_lim_db=atten)
                out = out.numpy().T[start - win_start:]  # drop the pre-roll

                if tail is not None:
                    n = min(len(tail), len(out))
                    out[:n] = tail[:n] * (1 - ramp[:n]) + out[:n] * ramp[:n]
                keep = end - start
                fout.write(out[:keep])
                tail = out[keep:]
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except Exception as e:  # noqa: BLE001
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        code = 1
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
