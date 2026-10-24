# Performance and supported media

Local defaults allow uploads up to 1,024 MB with no fixed duration or resolution cap. This does not mean every file below that size can be processed on every machine. Codec, frame rate, resolution, audio channels, available disk, and noise settings all matter.

## Measured on 24 October 2026

An opt-in pipeline measurement on macOS 26.5.2 / Apple Silicon (arm64):

| Setting / measurement | Result |
|---|---|
| Source | Synthetic test pattern with sine audio, 10 minutes, 1280×720, 10 fps |
| Source size | 123,197,105 bytes |
| Operations | Natural noise reduction (18 dB), one 2-second cut, solid-cover overlay throughout, Small file preset |
| Waveform | 0.35 seconds; 4,096 peaks |
| Export pipeline | 39.85 seconds, excluding source generation and waveform |
| Largest child process peak resident memory | 422.8 MiB |
| Output | 598.0 seconds, 71,356,588 bytes |
| Temporary files remaining after export | 309,753,815 bytes, including source and intermediate audio |

FFmpeg, OMP, and noise-engine threads were each set to 1. The model was already cached. Child peak RSS includes source-generation, waveform, and export subprocesses. It is the largest child measurement reported by the OS, not the sum of simultaneous server, browser, and child memory. Temporary bytes are a final snapshot, not peak disk use. The measurement exercises the pipeline, not browser upload/recovery or all editor combinations.

This demonstrates that this specific 10-minute synthetic input completes; it does not establish a recommended maximum or predict real speech quality. The supplied short MOV recording was also used to verify the audio sample workflow. Hour-long real recordings, 4K/high-frame-rate videos, multiple audio channels, Windows, and Linux performance remain unmeasured here.

The raw measurements are saved in [performance-measurement.json](performance-measurement.json). Generated media from this recorded run were removed after inspection.

## Repeat on your hardware

From the repository root, with the dependencies installed:

```sh
OMP_NUM_THREADS=1 DF_THREADS=1 FFMPEG_THREADS=1 \
  .venv/bin/python -m scripts.benchmark --seconds 600 --denoise
```

Set `DEEPFILTER_PYTHON` if noise reduction uses another environment. Use `--seconds 3600` for a one-hour synthetic measurement, or omit `--denoise` to measure ordinary export. The script prints the fresh temporary artifact directory and saves `measurement.json`; it does not delete these files automatically. Remove its generated directory when finished. This is a manual measurement utility, not a regression test suite.

## Long-recording behavior

- Uploads stream to disk and check free space while receiving data.
- Audio waveform generation uses a temporary decoded mono file with a bounded in-memory read buffer and at most 4,096 output peaks.
- Noise reduction reads overlapping short chunks; its audio tensors do not grow with the entire recording's duration.
- Export estimates disk headroom using source size, duration, and audio channel count. This is a conservative heuristic, not a prediction of compressed output size or a reservation against other applications using the disk.
- FFmpeg stage timeouts scale with media duration by default. `FFMPEG_TIMEOUT_SECONDS` overrides them; a low fixed value can terminate long exports.
- Pause detection returns at most 100 suggestions. The editor accepts at most 100 cuts and 100 visual edits per export.
- Use the short noise sample to choose a strength before starting a lengthy full export. Cancellation stops the active subprocess and retains editing instructions.
