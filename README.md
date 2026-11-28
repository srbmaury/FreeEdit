# FreeEdit

**FreeEdit is a free, open-source online video editor for tutorials, demos, and social clips.** Trim and join clips on a timeline, import SRT subtitles, add annotations, remove background noise, and export MP4 video or WAV audio. Use the hosted editor in your browser or run it on your own machine.

**Try it:** [Open the FreeEdit video editor](https://freeedit.srbmaury.com/) · **Source license:** [MIT](LICENSE)

> Hosted processing happens on the server; do not upload confidential media to a deployment you do not trust. The live site may run a different commit from this repository.

## What it does

- **Reduce background noise** with [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet), with a short audio comparison.
- **Find and shorten pauses**: review quiet portions before making cuts.
- **Edit visually**: cut ranges, timed text, imported SRT captions, privacy masks, Reframe/zoom portions, and illustrated annotations (icons, arrows, shapes, callouts, or uploaded logos). Draw custom pen and highlighter strokes directly on the recording, and group strokes to move, resize and time them together. Mute or change volume over selected audio regions.
- **Highlight tutorial actions**: manually place timed cursor spotlights and fading click rings, then move, resize, or restyle them.
- **Adjust range speed**: open Speed, set From/To times, and apply 0.25×–4× speed, with preserved audio pitch, editable Speed blocks, and matching result previews and exports.
- **Explain what matters**: pick a focus point in the video; choose original, wide, vertical or square aspect ratios.
- **Build a main-video sequence**: arrange up to eight clips with matching dimensions, frame rate, and audio-track presence; join them with cuts or crossfades, add a movable presenter inset, choose the presenter/mixed audio, and optionally process the presenter background.
- **Generate narration** with local Kokoro text-to-speech, nine English voices, playback, and WAV download.
- **Replace backgrounds** (optional): person-aware blur, solid color or an image, optionally restricted to a webcam area.
- **Review accurately**: timeline selection, original/result comparisons, and short processed previews before exporting.
- **Export** balanced, high-quality or smaller H.264 MP4, or audio-only WAV. Optional speech leveling and fades.
- **Resume later** using version-2 `.freeedit.json` project files with a saved edit document and source fingerprints.

## Quick start

The commands below apply to a checkout containing the `scripts/` directory. Run them from the repository root.

### macOS (native)

Requires Homebrew and an internet connection for initial dependencies/models.

```sh
git clone https://github.com/srbmaury/FreeEdit.git
cd FreeEdit
./scripts/setup.sh
./scripts/run.sh
```

Open **http://localhost:8000**. The setup uses Python 3.12, Rust/Cargo, FFmpeg and FFprobe. `./scripts/run.sh` shows which checkout and Python environment it launched.

#### Python virtual environment

`./scripts/setup.sh` creates `.venv` with Python 3.12 and installs FreeEdit’s dependencies. `./scripts/run.sh` uses `.venv` automatically. To use the same environment for Python commands in your terminal, activate it after setup:

```sh
source .venv/bin/activate
python tests/check.py
```

If you want to create the environment before running setup, use `python3.12 -m venv .venv` from the repository root with Python 3.12 already installed. Setup will reuse it and install the dependencies.

On a fresh install, the base setup skips the optional background and narration engines. Enable the features you need before starting or restarting FreeEdit.

| Feature | macOS command | Docker build argument |
| --- | --- | --- |
| Person-aware background blur and replacement | `./scripts/setup.sh --background` | `--build-arg INSTALL_BACKGROUND=true` |
| Local text-to-speech | `./scripts/setup-tts.sh` after base setup | `--build-arg INSTALL_TTS=true` |

To enable both optional features on a fresh macOS checkout, replace the setup and launch lines above with:

```sh
./scripts/setup.sh --background
./scripts/setup-tts.sh
./scripts/run.sh
```

Background setup installs MediaPipe in `.venv-background` and verifies the segmentation model. Add `--warm-model` to `./scripts/setup.sh` to preload DeepFilterNet3 for noise reduction, for example `./scripts/setup.sh --background --warm-model`.

### Docker

```sh
docker build -t freeedit .
docker run --rm -p 10000:10000 freeedit
```

Open **http://localhost:10000**. Add either or both optional build arguments from the table before the final `.` in the build command.

## Basic editing workflow

1. **Open a video** (e.g. MP4, MOV, WEBM, MKV). Some supported containers/codecs cannot play in every browser. Audio-only files are supported for cleanup and export.
2. Use the left task rail for **Clips, Trim, Text & masks, Subtitles, Reframe, Graphics, Draw, Audio, Cleanup and Background**.
3. Use **Edits (V)** by the preview to select, move, resize and change edit properties. All timed edits use the original source timeline; cuts alter result timing.
4. Choose a range in the waveform/ruler or mark boundaries with **I** and **O**. Review the range before applying cuts or zoom.
5. Use **Export → Preview result** for a short fully processed sample, then export and download.
6. Save a `.freeedit.json` project to continue later. **Keep the original recording(s)**: they are not included in the project file.

Keyboard essentials: `Space` play/pause, `←/→` step, `V` Select, `H` Hide, `T` Text, `X` Cut, `D` Draw, `Esc` cancel, `Ctrl/Cmd+Z` undo.

## Boundaries worth knowing

FreeEdit is a focused video editor rather than a general-purpose nonlinear editor. The local default upload limit is 1 GiB, with resource-dependent runtime. Main-video sequences support up to eight clips with matching dimensions, frame rate, and audio-track presence. The editor allows up to 100 cuts, up to 100 text/privacy/annotation overlays together, and 20 non-overlapping Reframe portions. Automatic subtitle transcription, speed-ramping and full color grading are not included.

Temporary uploaded files and rendered jobs expire. Signed anonymous sessions protect access to the current browser's jobs, but **are not user accounts**. Public hosting requires sensible request limits, HTTPS, a trusted reverse proxy and sufficient disk.

## Project structure

```text
backend/                 FastAPI app, launcher, and preflight entry points
  media/                 FFmpeg, composition, sequencing, and local ML workers
  jobs/                  Job persistence and subprocess lifecycle
  http/                  Request models, session cookies, and request limits
  support/               Diagnostics, logging, and runtime metadata
frontend/                No-build browser editor
  editor/                Editor state, history, timeline, and workspace
  visuals/               Canvas, drawing, annotations, and reframe
  media/                 Clip sequencing, audio tools, and narration
  projects/              Project files, recovery, and source identity
  export/                Export payload, processing, and preview
  shared/                Common UI, API client, and theme
  styles/                Editor stylesheets
pyproject.toml           Pinned web and separate noise, background, and narration dependency groups
tests/                   Python/FFmpeg and Node/browser regression tests
scripts/                 Native setup, narration setup, and launch
Dockerfile / render.yaml Container and hosted deployment configuration
```

A common edit model keeps cut, mask, caption/text, annotations and Reframe timelines consistent. The frontend is split into focused editor modules; the export adapter converts settings into validated FFmpeg requests.

## Development and quality checks

Dependency groups live in `pyproject.toml` and require pip 25.1 or later. CI installs the pinned `web` group by itself for Python and browser checks. Native setup installs `web` and `noise`, with `background` and `narration` installed by their respective setup commands.

Run the local checks after setup:

```sh
.venv/bin/python tests/check.py
```

GitHub Actions also runs browser smoke tests in Chrome, Firefox, and WebKit, plus a Docker build and denoising smoke test.

## Distribution notes

FreeEdit source is available under the [MIT license](LICENSE). Distributions should retain the applicable third-party notices for the packages and native libraries they include. FFmpeg terms depend on its build configuration, including whether it bundles libx264.

The source license and model terms are separate. The production image preloads DeepFilterNet3 weights. Record the exact checkpoint and applicable terms before redistributing an image containing those weights. The optional MediaPipe model downloads separately and requires its own distribution review.

## Local text-to-speech

Run `./scripts/setup-tts.sh` after setting up FreeEdit, then restart the app. The setup
installs Kokoro ONNX in the FreeEdit Python environment and downloads the voice
model once. For a different Python environment, set `PYTHON_BIN` to the same
interpreter that runs FreeEdit. For a shared installation, set
`FREEEDIT_TTS_MODEL_DIR` to the same model directory at setup and runtime.

`FREEEDIT_TTS_CHUNK_CHARS` defaults to 45 characters per inference on memory-constrained
servers. Set a higher value on servers with more headroom to preserve longer phrases
in a single synthesis call. Validate memory use with long scripts before deploying a higher limit.

Open **Generate narration** on the start screen or from the FreeEdit menu.
Enter up to 1,000 characters of English text, choose a voice and speed, then preview or download the WAV. Inference runs on the FreeEdit server's CPU with
no API key, external speech service, or per-generation fee. The server handles
one narration request at a time. Run FreeEdit locally if you want the script
and audio to stay on your own machine.

## ChatGPT plugin

The plugin exposes FreeEdit's narration engine as an MCP tool. It accepts up to
1,000 characters of English text, a preset voice and a playback speed. Generated
WAV downloads use a private link that expires after ten minutes. Link holders can
download the WAV until expiry or a service restart. The video timeline remains
available in the browser editor.

Install the optional dependency with
`python -m pip install --group web --group chatgpt` in the FreeEdit environment
and enable the Kokoro engine using the instructions above. Start FreeEdit with
`FREEEDIT_ENABLE_CHATGPT_PLUGIN=true`. For Docker, also build with
`--build-arg INSTALL_CHATGPT_PLUGIN=true` and `--build-arg INSTALL_TTS=true`.
Set `FREEEDIT_PUBLIC_URL` to the externally reachable origin if it differs from
`https://freeedit.srbmaury.com`.

Add the deployed HTTPS endpoint ending in `/api/mcp/` as a custom MCP server in
ChatGPT to test the connection. For directory submission, update the endpoint in
`integrations/chatgpt/mcp.json` if needed, add the verified publisher's listing
assets and policy links, and ZIP the contents of that directory at the ZIP root.
