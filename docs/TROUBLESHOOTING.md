# Running FreeEdit locally

## Setup and startup

On macOS, install Homebrew from https://brew.sh, then run `./setup.sh` and `./run.sh` from the repository. Setup uses Python 3.12 and installs FFmpeg and Rust when needed. It does not replace an existing incompatible virtual environment: rename that environment and rerun setup.

To download and load the noise model during setup, use `./setup.sh --warm-model`. This needs internet on first use. Without this flag the first noise-removal operation may download the model. Basic editing does not need the model.

Startup checks FFmpeg, FFprobe, temporary disk space, and the noise environment. Missing media tools or critically low disk space stop startup; missing noise dependencies are reported but other editing remains available. Open **⋯ → Check setup** to check again without restarting. Module availability checks are lightweight; `--warm-model` additionally imports and initializes the actual noise engine.

If DeepFilterNet is in another environment:

```sh
DEEPFILTER_PYTHON=/absolute/path/to/venv/bin/python ./run.sh
```

Recheck independently with:

```sh
.venv/bin/python -m backend.preflight
.venv/bin/python -m backend.preflight --warm-model
```

The installation script targets macOS. Linux users can use the repository Dockerfile; the container downloads and includes the noise model during build. Windows users can run that Docker image with Docker Desktop. Native Windows installation is not validated. See the license audit before distributing built images.

Background effects use an optional separate environment: run `./setup-background.sh`. See [background setup and controls](BACKGROUNDS.md).

## Common problems

| Symptom | Action |
|---|---|
| `brew` missing | Install Homebrew, reopen the terminal, and rerun setup. |
| `ffmpeg` / `ffprobe` missing | Install FFmpeg or set `FFMPEG_BIN` / `FFPROBE_BIN` to absolute executable paths. |
| Noise dependencies missing | Run setup with Python 3.12, or configure `DEEPFILTER_PYTHON`. Keep torch and torchaudio at the versions in requirements.txt. |
| Model initialization fails | Check internet availability and rerun preflight with `--warm-model`; inspect terminal output. |
| Storage is full | Open **⋯ → Storage and cleanup**. It shows server disk usage and can remove other inactive recordings/exports. Download needed files first. |
| Browser cannot play a source | Use a browser-supported MP4. Upload acceptance does not guarantee that the browser supports that media codec. |
| Processing takes a long time | Check the current stage and elapsed time. Cancel to stop processing while retaining edits. Use Small file, or turn off noise reduction if unnecessary. |
| Session missing after restart | Open a saved `.freeedit.json` project and select the unchanged original recording. Temporary server jobs are not durable projects. |

## Storage and projects

The default temporary folder is `jobs/`. Set `FREEEDIT_JOBS_DIR` to a writable folder on a disk with enough free space. Inactive files expire after the configured `JOB_TTL_HOURS`; active uploads and queued/running jobs are protected.

**Save project** stores editing instructions, not the media or export. Keep your original recording and project file together. Download exports separately. Cleanup removes other inactive sessions on that server, including other browser tabs; it preserves the open recording and active processing. It cannot be undone.

Local recovery is browser-specific and may be unavailable if browser storage is blocked or cleared. Saving a project is the reliable way to continue on another day or device.

## Long recordings

There is no default duration cap locally, but uploads are limited to 1,024 MB. Raise `MAX_UPLOAD_MB` or set `MAX_DURATION_MIN` before launching if needed. These settings are admission limits, not guarantees of performance.

Waveform generation streams decoded samples to a temporary file and returns at most 4,096 peaks. Noise reduction processes short overlapping chunks rather than loading the whole recording. Disk use still increases with duration, audio channels, and export size. Export checks free disk space and uploads reserve a small free-space margin; concurrent external disk usage can still exhaust a disk.

For measurements and their limitations, see [PERFORMANCE.md](PERFORMANCE.md).
