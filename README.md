# FreeEdit

A small web app for cleaning up screen recordings and other audio or video files:

- **Remove background noise** with [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet)
- **Shorten pauses**: detect quiet sections, listen to suggestions, and choose which become cuts
- **Export presets**: Balanced, Small file, High quality, or Audio only
- **Remove parts of the video**: mark one or more ranges on the timeline and they're cut out
- **Write text on the video**: click to place it, set the font, size, color and background, and choose when it appears
- **Hide part of the video**: drag a box, then blur it, pixelate it or cover it with black, for a time range you choose
- Compare the original and cleaned versions, then download the result

Live at **https://freeedit.srbmaury.com**, or run it on your own Mac. Files are processed by the server running FreeEdit and stored in `./jobs/`. A scheduled cleanup expires inactive files after 24 hours locally or 1 hour when hosted; active uploads and queued/processing exports are protected.

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
4. **Hide area** (`H`): drag over the part to hide. Solid redaction is the default. Choose Blur or Pixelate only for non-sensitive details.
5. **Add text** (`T`): click on the video, then type in the sidebar.
6. Each edit has a **From/To** time on the original timeline. The **now** buttons set it to the playhead. New text and hide edits start at the current playhead and run to the end of the video.
7. Select an edit to move it. For hide boxes, drag the corner handle to resize. `Delete` removes the selected edit.
8. Click **Export**. The rendered result opens in the main player. Switch between **Play original** and the cleaned version, return with **Back to editing**, or **Download**. Comparison follows corresponding positions after cuts.

Undo/redo buttons restore edit changes; use `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` outside text fields. If edits change after export, the result is marked as outdated until you export again. Temporary connection interruptions retry status checks automatically.

Keyboard: `Space` plays/pauses, `←`/`→` steps one frame (hold `Shift` for 1 s), `Esc` deselects.

### Timeline

The timeline includes a waveform of the original audio and separate rows for suggested pauses, cuts, masks, and text. Click the waveform to seek; shaded sections show applied cuts. The waveform is normalized for display, not a loudness meter. Overlapping edits stack within their row. Click a time marker to seek, or select an edit block to open its settings. Drag any block to move its time range; drag either edge to change its start or end. **+ / −** zoom between 1× and 16× around the playhead; scroll horizontally to move through the zoomed timeline, and use **Fit** to see the entire recording. All times refer to the original recording. The server builds at most 4096 amplitude peaks using temporary disk storage; the browser draws only the visible portion at any zoom level. Waveform failure does not block editing.

### Silence removal

Open **Shorten pauses → Detect pauses**. Suggestions start unselected and appear above the cut timeline. Use **Listen** to hear each pause with surrounding audio, select the ones to remove, then **Add selected cuts**. Added cuts can be resized, edited, deleted, or undone. Audio-only files support the same cut controls.

Detection defaults to −40 dB, a minimum 0.8-second pause, and 0.2 seconds kept on each side. Raise the threshold to detect more quiet sections, with a greater risk of including quiet speech. Up to 100 suggestions are returned per pass. Detection and export share the bounded processing queue.

### Output

| Preset | Output |
|---|---|
| Balanced | H.264/AAC MP4, CRF 23, source resolution within the server cap |
| Small file | H.264/AAC MP4, CRF 28, at most 1280 pixels on the long side |
| High quality | H.264/AAC MP4, CRF 18, source resolution within the server cap |
| Audio only | 48 kHz, 16-bit PCM WAV with cuts and optional noise reduction |

All video presets re-encode to compatible MP4, preserve the frame without cropping, and use even dimensions. The export panel shows the intended dimensions and warns about significant downscaling. Compressed file size depends on content, so it is not predicted. Audio inputs always export as WAV. Audio-only export excludes text and masks, but retains cuts and noise reduction.

## Notes

- Homebrew's ffmpeg is built without `drawtext`. Text is therefore drawn in the browser, exported as a transparent PNG, and placed with ffmpeg's `overlay` filter. The preview and the final render use the same drawing code, so they match.
- Jobs run one at a time, because DeepFilterNet and x264 both use a lot of CPU. At most four jobs may be queued or processing; further submissions receive a retry message. Run one API process per jobs directory; admission and status are held in memory.
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
| `MAX_PENDING_JOBS` | 4 | 4 | Maximum queued and processing exports combined |
| `FFMPEG_TIMEOUT_SECONDS` | auto | auto | Per FFmpeg stage timeout; defaults to 300 seconds plus 10 times media duration |
| `FREEEDIT_JOBS_DIR` | `./jobs` | `./jobs` | Optional dedicated media directory |
| `DF_CHUNK_SECONDS` | 3 | 5 | Denoise chunk size (lower uses less RAM) |
| `FFMPEG_THREADS` / `OMP_NUM_THREADS` | 1 | auto | Single-threaded decode, filter and encode, with a short x264 lookahead. On one CPU, extra threads only add memory and contention |
| `MAX_OUTPUT_SIDE` | 1600 | none | Edited videos are downscaled so the long side fits. Edit positions scale with them |

**Memory on the 512 MB free plan.** Mac screen recordings are Retina-sized (about 3000×1900), and the first hosted version ran out of memory on them. Measured in the container with a hard 512 MB limit, two back-to-back 308 MB 3024×1964 60 fps recordings, each with noise removal, all edit types and two cuts, peaked at **391 MB** of non-reclaimable memory. Three things made that fit:

- Cuts use `select` + `setpts`, which streams frame by frame. The earlier split + trim + concat approach queued every frame of the later segments, about 1 GB at 1080p60.
- Text images are single-frame inputs that `overlay` holds on screen. An endless `-loop 1` input made ffmpeg buffer 1.7 GB once cuts shifted the output timeline.
- The output is capped at 1600 px, and ffmpeg is single-threaded. Decoding the full-resolution source still costs about 300 MB.

Uploads stream straight to disk as the raw request body, and the write cache is flushed as they go, because on small containers the page cache counts toward the memory limit.

The free plan has less CPU than my test machine, so expect jobs to take a few times longer than the file's duration. It also sleeps after 15 minutes idle, so the first request after that takes about a minute.

The dependency/license findings and outstanding release decisions are documented in [docs/LICENSE_AUDIT.md](docs/LICENSE_AUDIT.md). DeepFilterNet code licensing and pretrained-model licensing are tracked separately.

## Errors and server logs

API failures return a stable error code and request ID alongside the message. Processing failures show recovery guidance; raw FFmpeg diagnostics stay in server logs. Interrupted uploads offer **Retry upload**, and expired files offer **Upload a replacement file**. Status checks resume when the browser comes back online.

Server application events are JSON lines: request failures, uploads, queue admission and wait time, processing stages, export duration/size, silence detection, and cleanup. Application request events use route templates and omit query strings, original filenames, and client IP addresses. The provided launch script and Docker command disable Uvicorn's separate access log, which would otherwise include upload filenames in query strings. No external analytics service is configured.

## Keyboard and small-screen editing

Activate **Hide area** or **Add text**, then **Place in center** to create an overlay without drawing. Select an edit's title to open its settings. **Position and size** fields let you place/resize masks numerically; text overlays have position fields. Timeline controls and the edit inspector remain usable with a keyboard. On narrow screens, settings use larger controls, edit lists expand without nested scrolling, and the export panel stays in document flow.

## Layout

```text
backend/app.py        FastAPI routes, job queue, limits, file cleanup
backend/observability.py API errors, request IDs, structured events
backend/models.py     Typed edit validation and media bounds
backend/pipeline.py   ffprobe/ffmpeg pipeline; filtergraph for overlays and cuts
backend/df_worker.py  DeepFilterNet3 denoiser (chunked, runs as a subprocess)
frontend/             Static UI (no build step): index.html, style.css, app.js, silence.js, timeline.js
```
