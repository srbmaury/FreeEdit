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

Run the shared local/CI checks with one command:

```sh
.venv/bin/python -m scripts.check
# Also run the actual denoiser (and segmentation with a supplied person fixture):
.venv/bin/python -m scripts.check --models
```

The checker validates dependency compatibility, Python/JavaScript syntax,
regressions and a generated-media render. `--suite python` and `--suite frontend`
run the same subsets used by CI. Restart tests launch separate processes and
verify restored session ownership, source downloads and completed results.

For backend/frontend development without installing the optional ML stack, use
Python **3.12** and install the complete web lockfile (not just its constraints):

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-web.lock
.venv/bin/python -m pip check
```

This also installs the HTTP client needed by API tests. If an existing
environment reports missing `httpx`/`httpx2` or incompatible Starlette packages,
rerun the lockfile install before testing. `./setup.sh` installs this same web
set alongside the denoising dependencies. Use a fresh environment when checking
reproducibility; merely applying constraints does not install missing packages.

CI builds the production Docker image, checks its installed dependencies, and
runs the actual denoiser against deterministic noise across chunk boundaries.
The same editing/recovery/export smoke test runs in Chrome, Firefox and WebKit.
These are engine checks; WebKit does not replace testing Safari on target devices.

Optional real-person segmentation verification accepts an explicit centered
portrait fixture (not committed to the repository):

```sh
FREEEDIT_PERSON_FIXTURE=/absolute/path/portrait.jpg .venv/bin/python -m unittest discover -s tests -p model_smoke.py -k segmentation -v
```

This checks foreground/background confidence and actual replacement pixels.
The denoiser smoke checks suppression, duration and sample count, not perceptual
speech quality; segmentation still needs moving-person and varied-lighting review.

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

The browser smoke test uses Chrome because the pinned Playwright Chromium
build does not decode the application's H.264/AAC export. Install it with
`npx playwright install --with-deps chrome`; codec support and source decoding
are checked before editing. Browser smoke waits default to 15 seconds (30 for navigation), with explicit
longer export waits and a five-minute overall deadline. Failures save a screenshot
and Playwright trace under `/tmp/freeedit-browser-artifacts/`; CI uploads these
with seven-day retention. Stage logs identify the last completed workflow phase.
Set `FREEEDIT_TEST_CHANNEL` to another installed compatible Playwright channel,
`FREEEDIT_TEST_BROWSER` to a compatible local Chromium executable, or
`FREEEDIT_TEST_ARTIFACTS` to choose another diagnostics directory. Pixel regression
tests compare range-preview and full-export annotation frames through entrances,
steady display and exits, including cut timing.

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
| Recovery unavailable after restart or browser reset | Keep the same persistent jobs volume and signing key; browser recovery holds edits. After disk replacement, reopen the saved project with the original media |
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
- `frontend/annotation-model.js` and `annotations.js`: validated annotation styles, visual picker, canvas placement and rasterized export.
- `frontend/projects.js`: project persistence and source reconciliation.
- `tests/`: self-contained regression checks; prefer realistic synthetic FFmpeg fixtures over static source assertions.

The frontend serves static JavaScript with a known script load order, without a bundler. All timed edit types share source-timeline start/end and a common selected ID. Whole-video settings, background and presenter data remain scene-level settings. See [architecture and invariants](ARCHITECTURE.md) before adding another edit type or changing project persistence.

## Documentation hygiene

- Keep the root `README.md` short: product promise, quick start, and links to canonical guides.
- Update `USAGE.md` for end-user workflows; `DEVELOPMENT.md` for setup/tests; `ARCHITECTURE.md` for enduring invariants; `OPERATIONS.md` for deployment/performance; `SECURITY.md` and `LICENSE_AUDIT.md` for their specialized topics.
- **Do not add a new Markdown file for every sprint, feature branch or one-time test.** Put durable findings in the appropriate existing guide and link to raw measurement data only when it adds reproducible evidence.
- Keep scratch plans, local screenshots, generated reports, benchmarking recordings and private logs outside the repository. Git history and pull requests already preserve historical implementation notes.

## Profiling (opt-in)

```sh
OMP_NUM_THREADS=1 DF_THREADS=1 FFMPEG_THREADS=1 \
  .venv/bin/python -m scripts.benchmark --seconds 600 --denoise
.venv/bin/python -m scripts.profile_media /path/to/recording.mkv /tmp/freeedit-profile --full-export
```

These can consume substantial CPU and disk. Keep test recordings and output directories **outside** the repository. See [operations and performance](OPERATIONS.md) for interpretation and [benchmark data](benchmarks.json) for historical measurements.
