# FreeEdit

A small web app for cleaning up screen recordings and other audio or video files:

- **Remove background noise** with [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet)
- **Shorten pauses**: detect quiet sections, listen to suggestions, and choose which become cuts
- **Reframe** videos: crop to 16:9, 9:16, square or original aspect ratio, with zoom/focus and smoothly animated time-range sections
- **Import editable captions**: load SRT subtitles as timed text overlays you can adjust on the timeline
- **Combine two videos**: add a presenter inset, blur/remove its background, and choose Main, Presenter, Both, or Muted sound ([workflow](docs/COMBINING_VIDEOS.md))
- **Person-aware backgrounds**: blur, solid colors, or built-in/uploaded images, with camera-inset selection and a short processed preview ([optional setup](docs/BACKGROUNDS.md))
- **Export presets**: Balanced, Small file, High quality, or Audio only
- **Remove parts of the video**: mark one or more ranges on the timeline and they're cut out
- **Write text on the video**: click to place it, set the font, size, color and background, and choose when it appears
- **Hide part of the video**: drag a box, then blur it, pixelate it or cover it with black, for a time range you choose
- Preview a 10-second noise-removal sample before exporting; compare original and exported recordings afterward

## A typical editing session

1. **Upload** a screen recording, webcam video, or audio file.
2. Use **Videos**, **Audio**, **Pauses**, **Background**, **Cut**, **Text**, or **Hide area** in the task rail. Add a presenter inset in **Videos** when needed.
3. Use **Edits (V)** in the **preview toolbar** to select, move, and resize existing edits. The inspector shows **Your edits** by default and **Edit properties** when an edit is selected. You can keep the **Videos** inspector open while positioning the presenter.
4. Review the original timeline, listen to processed audio/video samples, and **Export**. Download the output or save a `.freeedit.json` project to continue editing later.

The task rail contains **Videos · Audio · Pauses · Background · Cut · Text · Hide area · Export**. Edits opens a unified inspector for text, captions, masks, cuts, and timed zoom sections. See the [focused workspace implementation notes](docs/FOCUSED_WORKSPACE.md) and [standalone design reference](docs/design/FreeEdit-Design.html); the reference is a mockup, not a running editor.

**Live app:** https://freeedit.srbmaury.com. The live deployment can differ from this `design/focused-workspace` branch; features present here are not necessarily deployed. Run this branch locally to review its current UI and presenter composition. Uploaded files are processed on the FreeEdit server and stored in `./jobs/` until cleanup. Inactive files expire after 24 hours locally or 1 hour when hosted; active uploads and queued/processing exports are protected.

```text
Browser (upload, place edits, preview)
   │
   ▼
FastAPI  ──►  ffmpeg: extract audio (48 kHz)
         ──►  DeepFilterNet3: denoise (streamed in short chunks)
         ──►  MediaPipe: person mask (optional background effects)
         ──►  ffmpeg: optional presenter inset + audio selection/mix
         ──►  ffmpeg: background + privacy masks + text + cuts + clean audio  ──►  download
```

## Setup (macOS, Apple Silicon)

You need [Homebrew](https://brew.sh/). Then run:

```bash
./setup.sh     # installs python@3.12, rust, ffmpeg, then creates .venv with the app and noise-removal dependencies
./run.sh       # starts the server at http://localhost:8000
```

Startup checks the media tools, noise environment, and temporary disk space. Use `./setup.sh --warm-model` to download and load the noise model during setup instead of first use. See [local setup and troubleshooting](docs/TROUBLESHOOTING.md).

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

### Optional background effects

After the main setup, install the separate person-segmentation environment:

```bash
./setup-background.sh  # creates .venv-background and downloads the verified model
./run.sh
```

This uses MediaPipe without changing DeepFilterNet's environment. You can set `BACKGROUND_PYTHON` to another compatible Python environment and `FREEEDIT_MODEL_DIR` to a different model-cache directory. Ordinary editing and noise removal do not require this optional setup.

## Using it

1. Drop in a file (MOV, MP4, WEBM, MKV, WAV, MP3, M4A, …).
2. **Audio:** use **Preview noise removal** to hear up to 10 seconds from the playhead and switch between Original and Noise removed. The sample ignores cuts and visual edits. Then leave *Remove background noise* on and pick a strength. *Natural sound* caps the reduction at 18 dB, which sounds less processed. *Strongest reduction* applies no cap.
3. **Cut** (`X`): opens **Remove a section** without changing the recording. Set **From** and **To** in seconds, or use the playhead buttons, then choose **Add cut**. Select an existing cut to edit its timing or **Delete cut**. Drag its timeline block or edges to adjust it. Playback skips applied cuts; the draft is not applied until confirmed.
4. **Hide area** (`H`): drag over the part to hide. Solid cover is the default. Choose Blur or Pixelate only for non-sensitive details.
5. **Add text** (`T`): click on the video, then type in the sidebar.
6. Each edit has a **From/To** time on the original timeline. The **Use playhead** buttons set it to the playhead. New text and hide edits start at the current playhead and run to the end of the video.
7. Use **Edits (V)** beside the preview to select and move an edit. For hide boxes, drag the corner handle to resize. `Delete` removes the selected edit. The right inspector shows the selected edit's properties.
8. Click **Export**. The rendered result opens in the main player. Switch between **Original** and the cleaned version, return with **Back to editing**, or **Download**. Comparison follows corresponding positions after cuts.

Undo/redo buttons restore edit changes; use `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` outside text fields. If edits change after export, the result is marked as outdated until you export again. Temporary connection interruptions retry status checks automatically.

Keyboard: `Space` plays/pauses, `←`/`→` steps one frame (hold `Shift` for 1 s), `Esc` deselects.

### Timeline

The timeline includes a waveform of the original audio and separate rows for suggested pauses, cuts, masks, and text. Click the waveform to seek; shaded sections show applied cuts. The waveform is normalized for display, not a loudness meter. Overlapping edits stack within their row. Click a time marker to seek, or select an edit block to open its settings. Drag any block to move its time range; drag either edge to change its start or end. **+ / −** zoom between 1× and 16× around the playhead; scroll horizontally to move through the zoomed timeline, and use **Show entire recording** to see the entire recording. All times refer to the original recording. The server builds at most 4096 amplitude peaks using temporary disk storage; the browser draws only the visible portion at any zoom level. Waveform failure does not block editing.

### Silence removal

Open **Pauses → Detect pauses**. Suggestions start unselected and appear above the cut timeline. Use **Listen** to hear each pause with surrounding audio, select the ones to remove, then **Remove selected pauses**. Added cuts can be resized, edited, deleted, or undone. Audio-only files support the same cut controls.

Detection defaults to −40 dB, a minimum 0.8-second pause, and 0.2 seconds kept on each side. Raise the threshold to detect more quiet sections, with a greater risk of including quiet speech. Up to 100 suggestions are returned per pass. Detection and export share the bounded processing queue.

### Combine videos

Upload the main recording, then open **Videos → Add presenter video…**. Choose an inset corner/size, adjust its timing, and choose **Sound from** Main video, Presenter video, Both videos, or Muted. Both provides separate volume controls. Preview a short combined clip before exporting. Background blur/removal uses the optional background engine.

Saved projects retain the second recording’s identity and settings; keep both originals and reconnect the presenter when reopening. See [two-video composition and limitations](docs/COMBINING_VIDEOS.md).

### Person-aware backgrounds

Open **Background** in the sidebar and choose:

| Effect | Controls |
|---|---|
| Original | Keep the original background |
| Blur | Adjust blur strength while retaining the person |
| Solid color | Choose a background color |
| Background image | Soft studio, Twilight, Forest, or an uploaded PNG/JPEG/WebP |

Use **Preview background** to render a silent sample of up to three seconds from the playhead. The main editor continues to show the source; the sample shows the processed background without cuts, text, or privacy masks. Full export applies the background effect before the other visual edits and cuts.

For a webcam inset within a screen recording, choose **Camera area only**, then **Draw camera area** around the inset. Numeric position and size fields provide keyboard access. The rectangle stays fixed throughout the recording; it does not track a moving camera window. **Whole video** applies the effect across the frame.

Uploaded images are resized and embedded in saved projects. Background settings participate in undo/redo and mark existing exports as outdated when changed. The feature is opt-in: uploads are not automatically scanned for people.

This first version works best with a clearly visible person. Hair, fast movement, low light, and small subjects can cause halos or flicker. Use a solid **Hide area** mask for sensitive details; person segmentation is not a privacy guarantee. Background effects add processing time and temporary disk use. Real moving-person footage and long background-effect exports need broader validation; current checks used short person-image clips, including simulated camera motion.

See [background setup, model information, and limitations](docs/BACKGROUNDS.md).

### Output

| Preset | Output |
|---|---|
| Balanced | H.264/AAC MP4, CRF 23, source resolution within the server cap |
| Small file | H.264/AAC MP4, CRF 28, at most 1280 pixels on the long side |
| High quality | H.264/AAC MP4, CRF 18, source resolution within the server cap |
| Audio only | 48 kHz, 16-bit PCM WAV with cuts and optional noise reduction |

All video presets re-encode to compatible MP4, preserve the frame without cropping, and use even dimensions. The export panel shows the intended dimensions and warns about significant downscaling. Compressed file size depends on content, so it is not predicted. Audio inputs always export as WAV. Audio-only export excludes background effects, text, and masks, but retains cuts and noise reduction.

## Notes

- Homebrew's ffmpeg is built without `drawtext`. Text is therefore drawn in the browser, exported as a transparent PNG, and placed with ffmpeg's `overlay` filter. The preview and the final render use the same drawing code, so they match.
- Jobs run one at a time, because DeepFilterNet and x264 both use a lot of CPU. At most four jobs may be queued or processing; further submissions receive a retry message. Run one API process per jobs directory; admission and status are held in memory.
- Some formats won't preview in some browsers, for example HEVC `.mov` in Chrome, or `.mkv`/`.avi`. Use Safari or convert the file to MP4 first.
- DeepFilterNet's `enhance()` holds the whole clip plus autograd buffers in memory (about 13 MB per second of audio). `df_worker.py` instead runs it under `inference_mode` on short chunks, with 1 s of warm-up audio before each chunk and a 50 ms crossfade between chunks. This bounds the audio-processing buffer as duration increases; on speech the output is within 39 dB of whole-file processing.

## Hosting (Render)

`Dockerfile` and `render.yaml` deploy the app as a Docker web service on Render's free plan, with the custom domain `freeedit.srbmaury.com`. The image compiles DeepFilterLib with Rust in a builder stage, installs CPU-only torch, and includes the model so a new instance doesn't have to download it.

Background effects are excluded from the default Docker image. To include the optional engine:

```bash
docker build --build-arg INSTALL_BACKGROUND=true -t freeedit .
```

The background model downloads on first use; it is not baked into this image. Background effects have not been validated within the 512 MB hosted memory limit described below. Local availability does not imply that the live site has the optional engine installed.

These environment variables set limits for the public site. Locally they default to generous values.

| Variable | Hosted | Local default | Purpose |
|---|---|---|---|
| `MAX_UPLOAD_MB` | 100 | 1024 | Upload size limit |
| `MAX_DURATION_MIN` | 10 | none | Length limit |
| `JOB_TTL_HOURS` | 1 | 24 | Files are deleted after this |
| `MAX_PENDING_JOBS` | 4 | 4 | Maximum queued/running operations, including previews and pause detection |
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

## Processing and review

**Cancel** appears while export, pause detection, or a processed audio/background sample is running. Queued work is removed from the queue; active processing subprocesses are stopped and incomplete export files are removed. The original recording and edits remain. Elapsed time includes waiting in the queue; the stage label distinguishes waiting from processing. Percentages apply to the current rendering stage, not a promised overall ETA.

Pause detection offers **Conservative**, **Balanced**, and **More pauses** presets, with numeric settings under Advanced. These change threshold, minimum length, and speech padding; every suggestion still needs review. Select an edit and choose **Review selection** to loop a short original-timeline section (up to about nine seconds) with its live overlays. Cuts are shown rather than skipped during this review. Use **Preview noise removal** to hear a short processed audio sample before exporting.

Audio-only export with visual edits asks for confirmation that background effects, masks, and text will be excluded. Small-file exports with text show a readability reminder. Other exports proceed directly.

**⋯ → Check setup** checks FFmpeg/FFprobe, denoising dependencies, background-engine imports, cached models, and available disk. It does not download models or initialize segmentation/denoising models. Background-engine imports run in a separate subprocess. A disk-space preflight protects exports; the estimate is a conservative allowance rather than a guarantee of maximum disk use. Model-cache detection reports only the default DeepFilterNet3 location; it does not prove the weights can load.

## Errors and server logs

API failures return a stable error code and request ID alongside the message. Processing failures show recovery guidance; raw FFmpeg diagnostics stay in server logs. Interrupted uploads offer **Retry upload**, and expired files offer **Upload a replacement file**. Status checks resume when the browser comes back online.

Server application events are JSON lines: request failures, uploads, queue admission and wait time, processing stages, export duration/size, silence detection, and cleanup. Application request events use route templates and omit query strings, original filenames, and client IP addresses. The provided launch script and Docker command disable Uvicorn's separate access log, which would otherwise include upload filenames in query strings. No external analytics service is configured.

## Save and resume a project

Use **⋯ → Save project…** to download a `.freeedit.json` file containing cuts, masks, text, noise-reduction settings, background effects and camera area, and the export preset. Background images are embedded in the project; the source recording and rendered export are not. This is an editable project, separate from an exported video/audio file. **The recording is not included:** keep the original with your project file.

Use **⋯ → Open project…**, then select the original recording. FreeEdit compares its size and a fingerprint of every byte before restoring edits. Renaming the recording is fine; changing or re-encoding its contents is not. Project format version 1 uses `sha256-chunks-4m-v1`: SHA-256 of the concatenated SHA-256 digests of consecutive 4 MiB chunks. Hashing uses bounded memory. Project files are validated and limited to 2 MB.

FreeEdit also saves one recovery copy automatically in browser storage. On return, choose **Resume editing**. If the server still holds the temporary recording, it can be reused. After expiry or a server restart, choose the original recording again. Recovery keeps edits/settings, not the video/audio itself; closing the browser does not keep the server's temporary media forever.

Browser recovery belongs to the same browser profile and exact site address (including port). Private browsing, clearing site data, storage restrictions, or using another browser/computer can remove or hide it. Text overlays and edit settings are stored locally, so use **Discard recovery** when sharing the computer. Downloaded project files are the reliable way to transfer or retain work. Only one session is retained per browser/site; starting another recording replaces it after confirmation. Browser recovery uses a short-lived tab ownership lease. A second active tab does not overwrite the first tab’s recovery; it offers an explicit takeover action. Download project files to retain work from multiple tabs. Recovery also restores the playhead and timeline zoom.

Leaving a project with changes not yet downloaded prompts the browser's standard unsaved-work warning. Starting another file has a separate confirmation with **Save project**. Browser recovery is a convenience, not a backup. Portable bundles that include the original recording are not implemented.

## Editor layout

The workspace uses a left task rail (Videos, Audio, Pauses, Background, Cut, Text, Hide area, Export), a central preview, and one settings inspector on the right. **Edits (V)** is in the preview toolbar rather than the rail; it lets you move existing edits without adding new ones. Selecting an edit reveals **Edit properties** in the inspector; otherwise it shows **Your edits**. Keeping **Videos** open while using Select allows presenter-inset repositioning. Undo/Redo and Export are in the header; the original-timing timeline spans the workspace below the preview, and the footer provides Save project and retention information. After export, the **Original / Exported** switch compares corresponding positions above the preview. **Back to editing** returns to the timeline. The **⋯** menu contains Appearance (System, Light, or Dark), keyboard shortcuts, storage information, About, and repository links. Appearance defaults to System and is remembered in this browser. Narrow screens stack the workspace and settings vertically.

## Keyboard and small-screen editing

Activate **Hide area** or **Add text**, then **Place in center** to create an overlay without drawing. Select an edit's title to open its settings. **Position and size** fields let you place/resize masks numerically; text overlays have position fields. Timeline controls and the edit inspector remain usable with a keyboard. On narrow screens, settings use larger controls, edit lists expand without nested scrolling, and the export panel stays in document flow.

## Layout

```text
backend/app.py        FastAPI routes, job queue, limits, file cleanup
backend/observability.py API errors, request IDs, structured events
backend/models.py     Typed edit validation and media bounds
backend/pipeline.py   ffprobe/ffmpeg pipeline; filtergraph for overlays and cuts
backend/composition.py Two-video presenter inset and audio mixing
backend/df_worker.py  DeepFilterNet3 denoiser (chunked, runs as a subprocess)
backend/background.py Person-mask preparation and background composition filters
backend/background_worker.py Streaming MediaPipe segmentation worker
backend/preflight.py  Startup checks and optional noise-model preparation
frontend/             Static UI (no build step), including workspace and presenter controls
tests/test_composition.py Synthetic FFmpeg integration tests for two-video composition
setup-background.sh   Optional isolated background-engine setup
scripts/              Manual performance measurement and release inventory
```


## Checks before release

From the repository root, after installing the dependencies, run the synthetic two-video tests (FFmpeg and FFprobe must be available):

```bash
.venv/bin/python -m unittest discover -s tests -v
```

These tests exercise presenter timing, seeked previews, mixed/presenter-only audio, no-overlap handling and muted exports. They use generated video/audio clips, not personal recordings. They **do not** replace browser QA, segmentation tests on varied real people, or long-video memory and performance tests. The focused workspace and presenter compositor on this branch remain **unmerged / not automatically deployed**. Verify the UI at desktop, 768px and phone widths in both themes, plus a real preview and export, before shipping. There is no established GitHub Actions CI for this feature branch.

## Local operation and releases

- **Storage:** **⋯ → Storage and cleanup** shows temporary-file usage and free disk space. Cleanup preserves the open recording and active processing, and removes other inactive sessions and exports on that server.
- **Continue later:** save a project and retain the original media. Downloaded projects do not contain media or rendered exports; temporary files expire.
- **Long recordings:** no local duration cap is configured by default; the upload limit is 1,024 MB. See [performance measurements and limits](docs/PERFORMANCE.md) before planning long exports.
- **Accessibility:** native dialogs, keyboard editing controls, a skip link, visible focus, readable seek values, and reduced-motion support. This is not a claim of full accessibility conformance.
- **License:** FreeEdit source is [MIT licensed](LICENSE). See [release preparation](docs/RELEASING.md) and the [dependency/model audit](docs/LICENSE_AUDIT.md) for separately distributed components.
