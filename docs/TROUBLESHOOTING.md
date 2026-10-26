# Running FreeEdit locally

## Setup and startup

On macOS, install Homebrew from https://brew.sh, then run `./setup.sh` and `./run.sh` from the repository. Setup uses Python 3.12 and installs FFmpeg and Rust when needed. It does not replace an existing incompatible virtual environment: rename that environment and rerun setup.

To download and load the noise model during setup, use `./setup.sh --warm-model`. This needs internet on first use. Without this flag the first noise-removal operation may download the model. Basic editing does not need the model.

Startup checks FFmpeg, FFprobe, required rendering encoders/filters, writable temporary storage, disk space, and the noise environment. Missing media tools or critically low disk space stop startup; missing noise dependencies are reported but other editing remains available. Open **⋯ → Check setup** to check again without restarting. Setup also renders a one-second generated sample to verify video/audio encoding and the main editing filters. Repeat it with `--verify-render`; it uses no personal media and downloads no models. Module availability checks are lightweight; `--warm-model` additionally imports and initializes the actual noise engine.

If DeepFilterNet is in another environment:

```sh
DEEPFILTER_PYTHON=/absolute/path/to/venv/bin/python ./run.sh
```

Recheck independently with:

```sh
.venv/bin/python -m backend.preflight
.venv/bin/python -m backend.preflight --verify-render
.venv/bin/python -m backend.preflight --warm-model
```

The installation script targets macOS. Linux users can use the repository Dockerfile; the container downloads and includes the noise model during build. Windows users can run that Docker image with Docker Desktop. Native Windows installation is not validated. See the license audit before distributing built images.

Background effects use an optional separate environment: run `./setup-background.sh`. See [background setup and controls](BACKGROUNDS.md).

## Common problems

| Symptom | Action |
|---|---|
| `brew` missing | Install Homebrew, reopen the terminal, and rerun setup. |
| `ffmpeg` / `ffprobe` missing | Install FFmpeg or set `FFMPEG_BIN` / `FFPROBE_BIN` to absolute executable paths. |
| Rendering support missing | Install a full FFmpeg build with libx264, AAC, PCM, FFV1 and the editing filters. Check configured FFMPEG_BIN; startup now reports missing components. |
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

## Verify which checkout is running

Run `./run.sh` from the checkout you intend to use. The script resolves its own directory, prints the checkout and Python paths, and reports the Git revision and a source fingerprint. It checks the selected port before expensive setup probes. If the port is occupied, it prints an inspection command and an alternative `PORT=8001 ./run.sh` invocation; it never stops another process automatically.

In the app, open **⋯ → About FreeEdit** to see the server's revision, source fingerprint, local-change status, and start time. Source archives also have a fingerprint even without Git. These describe files at server startup, not a published release or a guarantee that the working tree is committed. The API deliberately omits local paths.

After changing code, stop the server you launched with Ctrl+C and start it again, then reload the browser. Python modules remain loaded until restart; static frontend files are read from disk. Reloading the page alone can therefore mix new frontend files with old backend code. An older running checkout cannot display these version details until it is updated and restarted. Do not assume that a page on port 8000 belongs to your current checkout.

Changing ports creates a different browser recovery origin. Save a project file and keep its original recording before switching. Cookies are shared across ports on the same hostname, so FreeEdit now namespaces its session cookie by signing key: independently configured instances no longer replace one another's session. Older servers must be restarted from the updated source to benefit. A restart without a persistent signing key still expires that server's session, and jobs remain in-memory; save your project before restarting.
