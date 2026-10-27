# FreeEdit

**A free, open-source video editor for tutorials, demos, and social clips.** Shape a video on a visual timeline, add captions and graphics, clean up audio, and export a polished result.

**Try it:** [freeedit.srbmaury.com](https://freeedit.srbmaury.com) · **Source license:** [MIT](LICENSE)

> Hosted processing happens on the server; do not upload confidential media to a deployment you do not trust. The live site may run a different commit from this repository. See [privacy/security](docs/SECURITY.md).

## What it does

- **Reduce background noise** with [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet), with a short audio comparison.
- **Find and shorten pauses**: review quiet portions before making cuts.
- **Edit visually**: cut ranges, timed text, imported SRT captions, privacy masks, Reframe/zoom portions, and illustrated annotations (icons, arrows, shapes, callouts, or uploaded logos). Draw custom pen and highlighter strokes directly on the recording, and group strokes to move, resize and time them together. Add timed cursor spotlights and click highlights, and mute or change volume over selected audio regions.
- **Highlight tutorial actions**: manually place timed cursor spotlights and fading click rings, then move, resize, or restyle them.
- **Explain what matters**: pick a focus point in the video; choose original, wide, vertical or square aspect ratios.
- **Build a main-video sequence**: arrange up to eight clips with matching dimensions, frame rate, and audio-track presence; add a movable presenter inset, choose the presenter/mixed audio, and optionally process the presenter background.
- **Replace backgrounds** (optional): person-aware blur, solid color or an image, optionally restricted to a webcam area.
- **Review accurately**: timeline selection, original/result comparisons, and short processed previews before exporting.
- **Export** balanced, high-quality or smaller H.264 MP4, or audio-only WAV. Optional speech leveling and fades.
- **Resume later** using version-2 `.freeedit.json` project files with a saved edit document and source fingerprints.

For placement, captions, pause controls, background effects, and the scope of each preview, see the [usage guide](docs/USAGE.md).

## Quick start

### macOS (native)

Requires Homebrew and an internet connection for initial dependencies/models.

```sh
git clone https://github.com/srbmaury/FreeEdit.git
cd FreeEdit
./setup.sh
./run.sh
```

Open **http://localhost:8000**. The setup uses Python 3.12, Rust/Cargo, FFmpeg and FFprobe. `./run.sh` shows which checkout and Python environment it launched.

Person-aware background effects use an optional separate environment:

```sh
./setup-background.sh
./run.sh
```

Alternatively, to preload the denoising model during initial setup:

```sh
./setup.sh --warm-model
```

### Docker / other operating systems

The [Dockerfile](Dockerfile) is the supported starting point for Linux/container use; native Windows installation is not validated. Optional background support requires `INSTALL_BACKGROUND=true` at build time. See [development and troubleshooting](docs/DEVELOPMENT.md) and [operational limits](docs/OPERATIONS.md) before hosting it publicly.

## Basic editing workflow

1. **Open a video** (e.g. MP4, MOV, WEBM, MKV). Some supported containers/codecs cannot play in every browser. Audio-only files are supported for cleanup and export.
2. Use the left task rail for **Clips, Trim, Text & masks, Subtitles, Reframe, Graphics, Draw, Audio, Cleanup and Background**.
3. Use **Edits (V)** by the preview to select, move, resize and change edit properties. All timed edits use the original source timeline; cuts alter result timing.
4. Choose a range in the waveform/ruler or mark boundaries with **I** and **O**. Review the range before applying cuts or zoom.
5. Use **Export → Preview result** for a short fully processed sample, then export and download.
6. Save a `.freeedit.json` project to continue later. **Keep the original recording(s)**: they are not included in the project file.

Keyboard essentials: `Space` play/pause, `←/→` step, `V` Select, `H` Hide, `T` Text, `X` Cut, `D` Draw, `Esc` cancel, `Ctrl/Cmd+Z` undo.

## Boundaries worth knowing

FreeEdit is a focused video editor rather than a general-purpose nonlinear editor. The local default upload limit is 1 GiB, with resource-dependent runtime. Main-video sequences support up to eight clips with matching dimensions, frame rate, and audio-track presence. The editor allows up to 100 cuts, up to 100 text/privacy/annotation overlays together, and 20 non-overlapping Reframe portions. Automatic subtitle transcription, speed-ramping, clip transitions and full color grading are not included.

Temporary uploaded files and rendered jobs expire. Signed anonymous sessions protect access to the current browser's jobs, but **are not user accounts**. Public hosting requires sensible request limits, HTTPS, a trusted reverse proxy and sufficient disk. Review [operations](docs/OPERATIONS.md) and [security](docs/SECURITY.md).

## Project structure

```text
backend/                 FastAPI routes, validation, processing, FFmpeg, optional ML workers
frontend/                No-build browser editor (state, canvas, timeline, export, projects)
tests/                   Python/FFmpeg and Node/browser regression tests
scripts/                 Opt-in profiling and license/release inventory helpers
docs/                    Concise guides, technical architecture, security, benchmark evidence
setup.sh / run.sh        Native setup and launch
setup-background.sh      Optional person-segmentation environment
Dockerfile / render.yaml Container and hosted deployment configuration
```

A common edit model keeps cut, mask, caption/text, annotations and Reframe timelines consistent. The frontend is split into focused editor modules; the export adapter converts settings into validated FFmpeg requests. Learn more in [architecture](docs/ARCHITECTURE.md).

## Development and quality checks

After installing the dependencies:

```sh
.venv/bin/python -m backend.preflight --verify-render
.venv/bin/python -m unittest discover -s tests -v
node --test tests/*.cjs tests/test_*.mjs
```

GitHub Actions also runs a Chromium end-to-end upload/edit/export check. Synthetic tests do not replace manual verification with actual recordings and optional segmentation. More details: [development](docs/DEVELOPMENT.md).

## Documentation

| Guide | Purpose |
| --- | --- |
| [Usage](docs/USAGE.md) | Editing workflow, media preview types, shortcuts, presenter and background controls |
| [Development](docs/DEVELOPMENT.md) | Setup, troubleshooting, tests and code navigation |
| [Architecture](docs/ARCHITECTURE.md) | State model, module boundaries and invariants |
| [Code flow](docs/CODE_FLOW.md) | Function index and Mermaid diagrams for startup, editing, export, recovery and cancellation |
| [Operations](docs/OPERATIONS.md) | Runtime limits, performance evidence, hosting and releases |
| [Security](docs/SECURITY.md) | Anonymous sessions, data isolation and deployment caveats |
| [Dependency / model licensing](docs/LICENSE_AUDIT.md) | Open third-party distribution questions |

Historical plans, experiments and UI mockups remain recoverable in Git history instead of being maintained as current documentation.
