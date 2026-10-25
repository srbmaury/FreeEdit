# Fresh-environment installation check — 25 October 2026

## Scope

A separate source copy was installed in a new Python 3.12 virtual environment, with `include-system-site-packages = false`. A second new environment was created for optional background processing. No existing application virtual environment was used for the measured model workloads. This is a fresh Python installation on an existing Apple M5 Mac, **not** a clean OS, empty package-cache, Linux or Windows certification. Homebrew Python, Rust and FFmpeg were already installed; cached package wheels and the existing DeepFilterNet model cache were reused.

## Results

- `./setup.sh --warm-model`: dependency installation, generated-media render and noise-model initialization passed.
- Main environment `pip check`: passed. The fetched web lock installed successfully with HTTP test dependencies.
- `./setup-background.sh`: installed the isolated model runtime and downloaded/verified the segmentation model into an empty model directory.
- First cold MediaPipe import took longer than the diagnostic probe's 15-second budget. A later probe passed. Setup now imports the runtime and constructs the actual segmenter before declaring success; timeout feedback distinguishes initialization from missing dependencies.
- After initialization, `backend.preflight --verify-render` reported all tools, model runtimes and storage checks ready, and the generated export passed.
- MediaPipe 0.10.21's installed wheel metadata labels it x86_64 while the installed native bindings are a universal binary containing arm64. Consequently `pip check` reports `mediapipe 0.10.21 is not supported on this platform` on this Mac. Import, segmenter construction, full-movie segmentation and composition work. This packaging warning remains unresolved; it is not reported as a completely clean dependency audit.
- The noise worker processed the complete supplied movie using the new main environment. Segmentation and composition used the new optional environment. See [workload measurements](LARGE_FILE_VALIDATION.md).

The setup script now constrains web dependencies using the same `requirements-web.lock` as CI and Docker. ML dependencies remain platform-specific. The lock preserves the currently tested HTTP stack; its TestClient emits an upstream httpx deprecation warning, without failing the focused tests.

An initial command accidentally started dependency resolution in the existing checkout and was stopped before proceeding with the isolated setup. An optional-runtime verification was also run against the existing checkout before it was rerun in the fresh copy. Neither run is counted as clean-install evidence.

## Still needed

- An OS image/container without existing tools or package/model caches, including first-time Homebrew/Rust installation.
- Linux container execution under a hard memory limit and the current lock; Windows setup is not claimed.
- A broader cross-browser and clean-OS validation matrix. The combined candidate subsequently passed the browser checks recorded below.

## Combined candidate browser validation

After browser access was restored, the current combined source ran on a fresh validation server using the isolated model runtimes. All setup checks displayed ready. The supplied screen recording uploaded, accepted a cut and timed Reframe, rendered a playable combined preview and full export, saved/reopened a project with source relinking, and recovered both edits after reload. Undo marked existing preview/export results stale; redo restored the matching ready state. Presenter upload and a playable mixed-audio preview passed. An isolated server configured for one upload per session displayed the expected rate-limit error and retry control on the second upload. No application console errors were captured in the primary validation tab. The dense timeline was also imported and exported from the browser (100 cuts, 80 masks, 20 Reframe portions). These checks validate the combined squash candidate, including the fetched branch's playback invalidation change; they do not certify every browser/device.
