# FreeEdit

A small web app for cleaning up screen recordings and other audio or video files:

- **Remove background noise** with [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet)
- **Remove parts of the video**: mark one or more ranges on the timeline and they're cut out
- **Write text on the video**: click to place it, set the font, size, color and background, and choose when it appears
- **Hide part of the video**: drag a box, then blur it, pixelate it or cover it with black, for a time range you choose
- Compare the original and cleaned versions, then download the result

Live at **https://freeedit.srbmaury.com**, or run it on your own Mac. Files go to `./jobs/` and are deleted automatically (after 24 hours locally, 1 hour when hosted).

```text
Browser (upload, place edits, preview)
   │
   ▼
FastAPI  ──►  ffmpeg: extract audio (48 kHz)
         ──►  DeepFilterNet3: denoise (streamed in short chunks)
         ──►  ffmpeg: blur/pixelate/box + text overlays + cuts + clean audio  ──►  download
```

## Setup (macOS, Apple Silicon)

You need [Homebrew](https://brew.sh/). Then run:

```bash
./setup.sh     # installs python@3.12, rust, ffmpeg, then creates .venv with pinned deps
./run.sh       # opens the server at http://localhost:8000
```

Why it's set up this way (from the DeepFilterNet macOS guide):

- **Python 3.12.** Python 3.14 breaks the dependencies.
- **`torch==2.5.1` and `torchaudio==2.5.1`**, pinned. DeepFilterNet 0.5.6 imports `torchaudio.backend`, which newer torchaudio versions removed.
- **Rust/Cargo**, which is needed to build `deepfilterlib`.
- The pip package is **`deepfilternet`**. The command it installs is **`deepFilter`**.

**Already have DeepFilterNet in another venv** (for example `~/Desktop/.venv312`)? You can skip the large torch download. Install only the web dependencies and point the app at that Python:

```bash
/opt/homebrew/bin/python3.12 -m venv .venv
.venv/bin/python -m pip install fastapi uvicorn
DEEPFILTER_PYTHON=~/Desktop/.venv312/bin/python ./run.sh
```

Denoising runs `backend/df_worker.py` with `DEEPFILTER_PYTHON`, which defaults to the server's own Python. It calls DeepFilterNet's Python API rather than the `deepFilter` CLI, because the CLI can hang on exit when it isn't started from a terminal. ffmpeg and ffprobe are looked up in the venv first, then on `PATH`. You can override them with `FFMPEG_BIN` and `FFPROBE_BIN`.

## Using it

1. Drop in a file (MOV, MP4, WEBM, MKV, WAV, MP3, M4A, …).
2. **Audio:** leave *Remove background noise* on and pick a strength. *Natural* caps the reduction at 18 dB, which sounds less processed. *Maximum* applies no cap.
3. **✂ Remove part** (`X`): marks 3 seconds from the playhead as a red block on the timeline under the scrubber. Drag the block's edges to adjust it, or drag the whole block. Add as many as you need. Playback skips removed parts, and the final length is shown next to the time.
4. **Hide area** (`H`): drag over the part to hide. Choose Blur, Pixelate or Black box in the sidebar.
5. **Add text** (`T`): click on the video, then type in the sidebar.
6. Each edit has a **From/To** time on the original timeline. The **now** buttons set it to the playhead. New text and hide edits start at the current playhead and run to the end of the video.
7. Select an edit to move it. For hide boxes, drag the corner handle to resize. `Delete` removes the selected edit.
8. Click **Process**. You can then switch between **Play original** and the cleaned version, and **Download**.

Keyboard: `Space` plays/pauses, `←`/`→` steps one frame (hold `Shift` for 1 s), `Esc` deselects.

### Output

| Input | Edits | Output |
|---|---|---|
| Audio file | — | Denoised `.wav` |
| Video | Noise removal only | Original video stream copied without re-encoding, new AAC audio (same container) |
| Video | Cuts, text or hide edits | H.264 `.mp4` (re-encoded because the frames change) |

## Notes

- Homebrew's ffmpeg is built without `drawtext`. Text is therefore drawn in the browser, exported as a transparent PNG, and placed with ffmpeg's `overlay` filter. The preview and the final render use the same drawing code, so they match.
- Jobs run one at a time, because DeepFilterNet and x264 both use a lot of CPU.
- Some formats won't preview in some browsers, for example HEVC `.mov` in Chrome, or `.mkv`/`.avi`. Use Safari or convert the file to MP4 first.
- DeepFilterNet's `enhance()` holds the whole clip plus autograd buffers in memory (about 13 MB per second of audio). `df_worker.py` instead runs it under `inference_mode` on short chunks, with 1 s of warm-up audio before each chunk and a 50 ms crossfade between chunks. Memory stays flat for any length, and on speech the output is within 39 dB of whole-file processing.

## Hosting (Render)

`Dockerfile` and `render.yaml` deploy the app as a Docker web service on Render's free plan, with the custom domain `freeedit.srbmaury.com`. The image compiles DeepFilterLib with Rust in a builder stage, installs CPU-only torch, and includes the model so a new instance doesn't have to download it.

These environment variables set limits for the public site. Locally they default to generous values.

| Variable | Hosted | Local default | Purpose |
|---|---|---|---|
| `MAX_UPLOAD_MB` | 100 | 1024 | Upload size limit |
| `MAX_DURATION_MIN` | 10 | none | Length limit |
| `JOB_TTL_HOURS` | 1 | 24 | Files are deleted after this |
| `DF_CHUNK_SECONDS` | 3 | 5 | Denoise chunk size (lower uses less RAM) |
| `FFMPEG_THREADS` / `OMP_NUM_THREADS` | 1 | auto | Single-threaded decode, filter and encode, with a short x264 lookahead. On one CPU, extra threads only add memory and contention |
| `MAX_OUTPUT_SIDE` | 1600 | none | Edited videos are downscaled so the long side fits. Edit positions scale with them |

**Memory on the 512 MB free plan.** Mac screen recordings are Retina-sized (about 3000×1900), and the first hosted version ran out of memory on them. Measured in the container with a hard 512 MB limit, two back-to-back 308 MB 3024×1964 60 fps recordings, each with noise removal, all edit types and two cuts, peaked at **391 MB** of non-reclaimable memory. Three things made that fit:

- Cuts use `select` + `setpts`, which streams frame by frame. The earlier split + trim + concat approach queued every frame of the later segments, about 1 GB at 1080p60.
- Text images are single-frame inputs that `overlay` holds on screen. An endless `-loop 1` input made ffmpeg buffer 1.7 GB once cuts shifted the output timeline.
- The output is capped at 1600 px, and ffmpeg is single-threaded. Decoding the full-resolution source still costs about 300 MB.

Uploads stream straight to disk as the raw request body, and the write cache is flushed as they go, because on small containers the page cache counts toward the memory limit.

The free plan has less CPU than my test machine, so expect jobs to take a few times longer than the file's duration. It also sleeps after 15 minutes idle, so the first request after that takes about a minute.

Before promoting the site widely, check the DeepFilterNet license and consider rate limiting.

## Layout

```text
backend/app.py        FastAPI routes, job queue, limits, file cleanup
backend/pipeline.py   ffprobe/ffmpeg pipeline; filtergraph for overlays and cuts
backend/df_worker.py  DeepFilterNet3 denoiser (chunked, runs as a subprocess)
frontend/             Static UI (no build step): index.html, style.css, app.js
```
