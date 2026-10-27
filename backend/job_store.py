"""Atomic metadata for one API process, colocated with its temporary media."""
import json
import os
from pathlib import Path
import re
import tempfile
import time

from .observability import event

JOB_ID = re.compile(r"^[a-f0-9]{12}$")
OWNER = re.compile(r"^[a-f0-9]{48}$")
ACTIVE = {"queued", "processing", "cancelling"}
OUTPUTS = {"output.mp4", "output.wav"}


class JobStore:
    def __init__(self, root: Path):
        self.root = root

    def save(self, job):
        if not JOB_ID.fullmatch(job["id"]):
            raise ValueError("Invalid job identity")
        work = self.root / job["id"]
        data = json.dumps({"version": 1, "job": job}, allow_nan=False).encode()
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=work, prefix=".metadata-", delete=False) as file:
                temporary = Path(file.name)
                file.write(data)
                file.flush()
                os.fsync(file.fileno())
            temporary.replace(work / "job.json")
            # Persist the rename as well as the contents on supported systems.
            if os.name == "posix":
                fd = os.open(work, os.O_RDONLY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def restore(self, *, ttl_hours):
        restored = {}
        cutoff = time.time() - ttl_hours * 3600
        for work in self.root.iterdir():
            if not JOB_ID.fullmatch(work.name) or not work.is_dir() or work.is_symlink():
                continue
            manifest = work / "job.json"
            if not manifest.is_file():
                continue  # Never infer ownership of uploads from older releases.
            try:
                if manifest.is_symlink() or manifest.stat().st_size > 2 * 1024**2:
                    raise ValueError("Invalid metadata file")
                saved = json.loads(manifest.read_text())
                job = saved["job"]
                if (saved["version"] != 1 or job["id"] != work.name
                        or not OWNER.fullmatch(job["owner"])
                        or not isinstance(job["media"], dict)
                        or not isinstance(job["updated_at"], (int, float))
                        or not 0 < job["updated_at"] <= time.time() + 60
                        or job["status"] not in ACTIVE | {"uploaded", "done", "cancelled", "error"}):
                    raise ValueError("Invalid job metadata")
                if job["updated_at"] < cutoff:
                    continue
                if not any(p.is_file() and not p.is_symlink() for p in work.glob("source.*")):
                    continue
                if job.get("presenter") and not any(
                        p.is_file() and not p.is_symlink() for p in work.glob("presenter.*")):
                    job["presenter"] = None
                    job["composition_preview"] = None
                output = job.get("output")
                if output is not None and output not in OUTPUTS:
                    raise ValueError("Invalid output path")
                if output and (not (work / output).is_file() or (work / output).is_symlink()):
                    job["output"] = None
                    if job["status"] == "done":
                        job.update(status="uploaded", stage=None, progress=None)
                if job["status"] in ACTIVE:
                    # Partial exports are never advertised as completed media.
                    if job.get("operation") == "export":
                        job["output"] = None
                        for name in OUTPUTS:
                            (work / name).unlink(missing_ok=True)
                    field = {"result-preview": "result_preview", "preview": "preview",
                             "background": "background_preview", "composition": "composition_preview",
                             "silence": "silence"}.get(job.get("operation"))
                    if field:
                        job[field] = None
                    job.update(status="error", stage="Interrupted by server restart", progress=None,
                               error="The server restarted during processing. Your source is available; retry the operation.",
                               error_code="server_restarted", cancel_requested=False)
                    self.save(job)
                restored[job["id"]] = job
            except (OSError, ValueError, KeyError, TypeError):
                event("job_restore_skipped", job_id=work.name)
        return restored


class InstanceLease:
    """Reject two API processes sharing ownership and temporary media."""
    def __init__(self, root):
        self.path = root / ".instance.lock"
        self.file = None

    def acquire(self):
        if os.name != "posix":
            raise RuntimeError("Job-store locking requires the supported macOS/Linux runtime.")
        import fcntl
        self.file = self.path.open("a+b")
        try:
            fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self.file.close()
            self.file = None
            raise RuntimeError("Another FreeEdit process is using this jobs directory. Use one API worker or a different FREEEDIT_JOBS_DIR.") from exc

    def release(self):
        if self.file is not None:
            self.file.close()
            self.file = None
