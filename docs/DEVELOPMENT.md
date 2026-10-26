# Development and troubleshooting

This document replaces scattered setup-validation, troubleshooting and historical workspace notes. Keep executable commands and runtime facts here; Git history preserves old one-off validation logs.

## Supported installation paths

### macOS (primary native setup)

Install [Homebrew](https://brew.sh/), then from the repository root:

```sh
./setup.sh
./run.sh
```

The setup uses Python 3.12, Rust/Cargo, FFmpeg and FFprobe, and creates `.venv`. The noise-removal stack pairs `torch==2.5.1` with `torchaudio==2.5.1` and DeepFilterNet 0.5.6. Do not independently upgrade this pair. The web dependency set is constrained by `requirements-web.lock`.

The app is available at **http://localhost:8000** (or the `PORT` specified at launch). Start the server from the checkout whose code you wish to test. Run `./run.sh` again after backend edits; a browser reload alone does not reload Python modules.

To load the optional noise model during setup instead of on first use:

```sh
./setup.sh --warm-model
```

To use a separately installed compatible denoiser:

```sh
DEEPFILTER_PYTHON=/absolute/path/to/venv/bin/python ./run.sh
```

### Optional person-aware backgrounds

```sh
./setup-background.sh
./run.sh
```

This creates the isolated background environment (`.venv-background`), including MediaPipe segmentation, without modifying the denoiser's torch environment. `BACKGROUND_PYTHON` chooses another compatible interpreter; `FREEEDIT_MODEL_DIR` moves the background-model cache. Background features are not automatically available in the default Docker image.

### Linux and Windows

The documented distribution path is the Dockerfile, not an independently validated native setup. You can request background support with:

```sh
docker build --build-arg INSTALL_BACKGROUND=true -t freeedit .
```

Check [deployment and releases](OPERATIONS.md) and [license terms](LICENSE_AUDIT.md) before distributing an image.

## Health checks and test commands

Startup checks essential FFmpeg codecs/filters, disk space, writable temporary storage, and optional model availability. **⋯ → Check setup** can rerun these checks.

```sh
.venv/bin/python -m backend.preflight
.venv/bin/python -m backend.preflight --verify-render
.venv/bin/python -m backend.preflight --warm-model
.venv/bin/python -m unittest discover -s tests -v
node --test tests/*.cjs tests/test_*.mjs
```

`--verify-render` creates a synthetic one-second sample and does not use private recordings. `--warm-model` imports/initializes DeepFilterNet; it may download files if not cached.

GitHub Actions (`.github/workflows/checks.yml`) covers Python/FFmpeg, Node and a Chromium smoke test for upload, editing, project round-trip and export. A green run is not a substitute for real-person segmentation, many-browser testing, or profiling long recordings.

## Common problems

| Symptom | What to check |
| --- | --- |
| `brew` missing | Install Homebrew and restart your terminal |
| FFmpeg/FFprobe unavailable | Install FFmpeg or set `FFMPEG_BIN` / `FFPROBE_BIN` |
| Missing codec/filter | Use a build with H.264/x264, AAC, PCM, FFV1 and required overlay filters; run preflight |
| DeepFilterNet missing or fails to initialize | Python 3.12 + pinned torch pair; set `DEEPFILTER_PYTHON` or run `--warm-model` |
| Background controls unavailable | Run `./setup-background.sh` and check the separate model environment |
| Upload/review fails from lack of storage | Inspect **⋯ → Storage and cleanup**, `FREEEDIT_JOBS_DIR` and server free disk space |
| Video uploaded but won't play in browser | Convert to a browser-supported MP4; ffprobe acceptance does not imply browser codec support |
| Port 8000 already occupied | Inspect listener or use `PORT=8001 ./run.sh`; do not kill an unrelated server |
| Edits lost after restart or browser reset | Reopen your saved project with the unchanged original media |
| Large export slow | Reduce the range/resolution, use Small file, or disable optional noise/background effects |

Use **⋯ → About FreeEdit** to compare the server revision, start time and source fingerprint with the working checkout. It represents the code at server startup, not necessarily the latest repository head. Logs include request IDs and bounded diagnostics; detailed processing errors remain server-side.

## Working with the codebase

- `backend/app.py`: API, anonymous job lifecycle and processing admission.
- `backend/models.py`: validated edit/export request schemas.
- `backend/pipeline.py` and `backend/rendering.py`: FFmpeg processing.
- `backend/composition.py`: presenter video and audio mixing.
- `backend/df_worker.py` and `backend/background_worker.py`: optional ML subprocesses.
- `frontend/editor-model.js`: typed timeline edits and pure selectors.
- `frontend/editor-edits.js`, `editor-render.js`, `editor-history.js`, `editor-export.js`: editing/UI/export responsibilities.
- `frontend/projects.js`: project persistence and source reconciliation.
- `tests/`: self-contained regression checks; prefer realistic synthetic FFmpeg fixtures over static source assertions.

The frontend serves static JavaScript with a known script load order, without a bundler. All timed edit types share source-timeline start/end and a common selected ID. Whole-video settings, background and presenter data remain scene-level settings. See [architecture and invariants](ARCHITECTURE.md) before adding another edit type or changing project persistence.

## Profiling (opt-in)

```sh
OMP_NUM_THREADS=1 DF_THREADS=1 FFMPEG_THREADS=1 \
  .venv/bin/python -m scripts.benchmark --seconds 600 --denoise
.venv/bin/python -m scripts.profile_media /path/to/recording.mkv /tmp/freeedit-profile --full-export
```

These can consume substantial CPU and disk. Keep test recordings and output directories **outside** the repository. See [operations and performance](OPERATIONS.md) for interpretation and [benchmark data](benchmarks.json) for historical measurements.
