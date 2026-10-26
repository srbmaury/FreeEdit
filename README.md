# FreeEdit

**A free, open-source editor for screen recordings.** Clean up noise and pauses, add clear visual explanations, and export polished demos without learning a full video editor.

**Try it:** [freeedit.srbmaury.com](https://freeedit.srbmaury.com) · **Source license:** [MIT](LICENSE)

> Hosted processing happens on the server; do not upload confidential media to a deployment you do not trust. The live site may run a different commit from this repository. See [privacy/security](docs/SECURITY.md).

## What it does

- **Reduce background noise** with [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet), with a short audio comparison.
- **Find and shorten pauses**: review quiet portions before making cuts.
- **Edit visually**: cut ranges, timed text, imported SRT captions, privacy masks, and Reframe/zoom portions.
- **Explain what matters**: pick a focus point in the video; choose original, wide, vertical or square aspect ratios.
- **Combine two videos**: add a movable presenter inset, choose the main/presenter/mixed audio, and optionally process the presenter background.
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

1. **Upload** a supported video or audio file (e.g. MP4, MOV, WEBM, MKV, WAV or MP3). Some supported containers/codecs cannot play in every browser.
2. Use the left task rail for **Videos, Audio, Pauses, Background, Reframe, Captions, Cut, Text and Hide area**.
3. Use **Edits (V)** by the preview to select, move, resize and change edit properties. All timed edits use the original source timeline; cuts alter result timing.
4. Choose a range in the waveform/ruler or mark boundaries with **I** and **O**. Review the range before applying cuts or zoom.
5. Use **Export → Preview result** for a short fully processed sample, then export and download.
6. Save a `.freeedit.json` project to continue later. **Keep the original recording(s)**: they are not included in the project file.

Keyboard essentials: `Space` play/pause, `←/→` step, `V` Select, `H` Hide, `T` Text, `X` Cut, `Esc` cancel, `Ctrl/Cmd+Z` undo.

## Boundaries worth knowing

FreeEdit focuses on screen-recording cleanup, **not unrestricted full-length film editing**. The local default upload limit is 1 GiB, with resource-dependent runtime. The editor allows up to 100 cuts, up to 100 text/privacy overlays together, and 20 non-overlapping Reframe portions. No automatic subtitle transcription, speed-ramping or arbitrary multi-clip sequencing is included.

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

A common edit model keeps cut, mask, caption/text and Reframe timelines consistent. The frontend is split into focused editor modules; the export adapter converts settings into validated FFmpeg requests. Learn more in [architecture](docs/ARCHITECTURE.md).

## Development and quality checks

After installing the dependencies:

```sh
.venv/bin/python -m backend.preflight --verify-render
.venv/bin/python -m unittest discover -s tests -v
node --test tests/*.cjs tests/*.mjs
```

GitHub Actions also runs a Chromium end-to-end upload/edit/export check. Synthetic tests do not replace manual verification with actual recordings and optional segmentation. More details: [development](docs/DEVELOPMENT.md).

## Documentation

| Guide | Purpose |
| --- | --- |
| [Usage](docs/USAGE.md) | Editing workflow, media preview types, shortcuts, presenter and background controls |
| [Development](docs/DEVELOPMENT.md) | Setup, troubleshooting, tests and code navigation |
| [Architecture](docs/ARCHITECTURE.md) | State model, module boundaries and invariants |
| [Operations](docs/OPERATIONS.md) | Runtime limits, performance evidence, hosting and releases |
| [Security](docs/SECURITY.md) | Anonymous sessions, data isolation and deployment caveats |
| [Dependency / model licensing](docs/LICENSE_AUDIT.md) | Open third-party distribution questions |

Historical plans, experiments and UI mockups remain recoverable in Git history instead of being maintained as current documentation.
