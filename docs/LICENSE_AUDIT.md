# Dependency and license audit

Reviewed 23 October 2026; project license and upstream model-license issue rechecked 24 October 2026 against this checkout's requirements, Dockerfile, local package metadata, and the linked upstream sources. This is an inventory and a list of unresolved release decisions, not a declaration that every binary/model is cleared for redistribution.

## Findings

| Component | Evidence | Result |
|---|---|---|
| FreeEdit source | Root LICENSE | MIT, selected by the project owner on 24 October 2026. Copyright Saurabh Maurya. |
| DeepFilterNet / deepfilterlib 0.5.6 code | [Release license](https://github.com/Rikorose/DeepFilterNet/blob/v0.5.6/LICENSE), [Python package metadata](https://pypi.org/pypi/deepfilternet/0.5.6/json), [Rust extension package metadata](https://pypi.org/pypi/deepfilterlib/0.5.6/json) | Repository code offers MIT or Apache-2.0; the Python package metadata identifies MIT. Preserve the relevant upstream license notices when distributing these packages. |
| DeepFilterNet3 model weights | Docker downloads/bakes the model using `init_df`; upstream [issue 697](https://github.com/Rikorose/DeepFilterNet/issues/697) asks whether released weights share the code license | The upstream clarification issue remains open with no maintainer clarification visible on 24 October 2026. Model terms were not independently established by this review. Do not describe commercial use or model redistribution as cleared based solely on the code license. Record the actual checkpoint, hash, and applicable terms before distributing a release image. |
| torch 2.5.1 | [Versioned upstream license](https://github.com/pytorch/pytorch/blob/v2.5.1/LICENSE) | BSD-style license with additional bundled third-party notices. Keep the complete installed license files. |
| torchaudio 2.5.1 | [Versioned upstream license](https://github.com/pytorch/audio/blob/v2.5.1/LICENSE) | BSD-style license. Preserve installed copyright and license notices. |
| SoundFile / libsndfile | [Upstream documentation](https://python-soundfile.readthedocs.io/en/latest/index.html) | SoundFile uses BSD-3-Clause; its native libsndfile dependency uses LGPL. Review the actual wheel/native-library notices, not just the Python package. |
| FastAPI, Pydantic, Uvicorn | Local installed metadata: FastAPI 0.141.1 (MIT), Pydantic 2.13.5 (MIT), Uvicorn 0.54.0 (BSD-3-Clause) | These local versions are an observation, not a production lockfile. Preserve each package's installed license files. Pydantic 2 is now explicitly required because the API uses its model validators. |
| FFmpeg / libx264 | Docker installs Debian FFmpeg and the pipeline uses libx264; [FFmpeg's licensing explanation](https://www.ffmpeg.org/legal.html) | The resulting FFmpeg binary's terms depend on build configuration. Enabling GPL components such as libx264 changes FFmpeg's licensing. Inspect `ffmpeg -version`, `ffmpeg -L`, and Debian copyright/source records in the actual built image. Do not label the shipped FFmpeg binary simply LGPL without checking. |

## Release decisions still open

1. FreeEdit source license: MIT; retain the root LICENSE in source distributions.
2. Establish terms for the exact bundled DeepFilterNet3 checkpoint and record its checksum.
3. Inventory the actual production image, including native/system packages and transitive dependencies, and retain corresponding notices/source information. The local web-only venv does not contain the noise-model dependencies.
4. Freeze a known-working deployment environment before calling builds reproducible. The current manifest intentionally retains several version ranges; this audit did not upgrade the pinned torch/torchaudio/DeepFilterNet combination.

Runtime rendering invokes FFmpeg as a separate executable. This document does not infer that FreeEdit's source automatically inherits FFmpeg's license; the bundled binary still has its own distribution obligations. No changes to model selection or noise reduction were made as part of this audit.
