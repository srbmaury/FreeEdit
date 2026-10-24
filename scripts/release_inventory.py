"""Print installed Python package metadata and model checksums for a release.

Run with the denoising Python inside the actual release environment:
python -m scripts.release_inventory > release-inventory.json
This inventory does not replace upstream license files or establish model terms.
"""
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


packages = []
for package in importlib.metadata.distributions():
    notices = []
    for file in package.files or []:
        if any(word in str(file).lower() for word in ("license", "copying", "notice")):
            notices.append(str(file))
    packages.append({"name": package.metadata.get("Name"), "version": package.version,
                     "declared_license": package.metadata.get("License-Expression") or package.metadata.get("License"),
                     "notice_files": notices})
models = []
try:
    import appdirs
    root = Path(appdirs.user_cache_dir("DeepFilterNet")) / "DeepFilterNet3"
    for file in root.rglob("*"):
        if file.is_file():
            models.append({"file": str(file.relative_to(root)), "sha256": checksum(file), "bytes": file.stat().st_size})
except ImportError:
    pass
print(json.dumps({"python": platform.python_version(), "platform": platform.platform(),
                  "packages": sorted(packages, key=lambda item: (item["name"] or "").lower()),
                  "noise_model_files": models}, indent=2))
