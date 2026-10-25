# Preparing a release

FreeEdit source uses the root MIT LICENSE. Retain it in source packages and images. Dependency and model terms are tracked separately in [LICENSE_AUDIT.md](LICENSE_AUDIT.md).

Before publishing a binary or container:

1. Build in the actual target environment and record its OS/architecture and exact package versions. The Python 3.12 web dependency tree is pinned in `requirements-web.lock`, but audio/background and base OS components remain incompletely locked. Create a full hash-locked platform-specific release manifest.
2. Run `python -m scripts.release_inventory > release-inventory.json` with the denoising Python in that environment. It records installed Python package metadata, notice filenames, and SHA-256 checksums of standard-cache noise-model files. Separate denoising and background environments each require their own inventory. The background model URL/checksum is recorded in BACKGROUNDS.md; the inventory script includes it when present. The script does not download anything.
3. Retain the actual dependency LICENSE/COPYING/NOTICE files. Metadata alone is not a substitute. Inventory system packages and native libraries separately; the script covers Python distributions and model files only.
4. Save the shipped FFmpeg build's `ffmpeg -version` and `ffmpeg -L`, plus its distribution's copyright/source information.
5. Record the applicable terms for the exact DeepFilterNet3 checkpoint. This remains unresolved in the existing audit; FreeEdit's MIT license does not establish those terms.
6. Validate startup and a real recording on each supported platform. Publish hardware, duration, resolution, and settings with performance claims.

Do not include users' recordings, temporary jobs, or private logs in release artifacts. The repository's Dockerfile excludes jobs and includes the project MIT license.
