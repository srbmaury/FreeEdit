"""FreeEdit API: upload -> edit -> process -> download.

Run from the project root:
    uvicorn backend.app:app --port 8000
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import pipeline
from .models import ProcessRequest, SilenceRequest
from .observability import event, install_error_handling, public_processing_error

ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = Path(os.environ.get("FREEEDIT_JOBS_DIR", ROOT / "jobs"))
FRONTEND_DIR = ROOT / "frontend"

# Generous defaults for local use; tighten via env vars when hosting publicly
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", 1024))
MAX_DURATION_MIN = float(os.environ.get("MAX_DURATION_MIN", 0))  # 0 = no limit
JOB_TTL_HOURS = float(os.environ.get("JOB_TTL_HOURS", 24))
ALLOWED_EXT = {".mov", ".mp4", ".m4v", ".mkv", ".webm", ".avi", ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"}

JOBS_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app):
    async def clean_periodically():
        while True:
            try:
                await asyncio.to_thread(_cleanup_old_jobs)
            except OSError as exc:
                event("cleanup_failed", exception=type(exc).__name__)
            await asyncio.sleep(60)

    task = asyncio.create_task(clean_periodically())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="FreeEdit", lifespan=lifespan)
install_error_handling(app)
# One job at a time: DeepFilterNet + x264 already saturate the CPU
executor = ThreadPoolExecutor(max_workers=1)
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
active_uploads: set[str] = set()
MAX_PENDING_JOBS = max(1, int(os.environ.get("MAX_PENDING_JOBS", 4)))


def _update(job_id: str, **fields) -> None:
    with jobs_lock:
        jobs[job_id].update(fields, updated_at=time.time())


def _job(job_id: str) -> dict:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        return dict(job)


def _cleanup_old_jobs() -> None:
    cutoff = time.time() - JOB_TTL_HOURS * 3600
    # Serialize deletion with admission; uploads are protected before mkdir.
    with jobs_lock:
        for d in JOBS_DIR.iterdir():
            if not d.is_dir() or d.name in active_uploads:
                continue
            job = jobs.get(d.name)
            if job and job["status"] in ("queued", "processing"):
                continue
            touched = job.get("updated_at", d.stat().st_mtime) if job else d.stat().st_mtime
            if touched < cutoff:
                shutil.rmtree(d, ignore_errors=True)
                jobs.pop(d.name, None)
                event("job_expired", job_id=d.name)


def _drop_cache(f) -> None:
    """Flush written pages and evict them from the page cache (Linux).

    On small containers the page cache counts toward the memory limit, and a
    fast upload can fill it with dirty pages before they're written back.
    """
    f.flush()
    if hasattr(os, "posix_fadvise"):
        os.fsync(f.fileno())
        os.posix_fadvise(f.fileno(), 0, 0, os.POSIX_FADV_DONTNEED)


@app.post("/api/upload")
async def upload(request: Request, filename: str):
    """Raw request body = the file. Streamed straight to disk (no multipart
    temp file, so large uploads aren't written twice)."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type '{ext}'.")

    job_id = uuid.uuid4().hex[:12]
    work = JOBS_DIR / job_id
    with jobs_lock:
        active_uploads.add(job_id)
        work.mkdir()
    try:
        source = work / f"source{ext}"
        size = since_flush = 0
        limit = MAX_UPLOAD_MB * 1024 * 1024
        try:
            with source.open("wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB.")
                    f.write(chunk)
                    since_flush += len(chunk)
                    if since_flush > 16 * 1024 * 1024:
                        _drop_cache(f)
                        since_flush = 0
                _drop_cache(f)
        except BaseException:
            shutil.rmtree(work, ignore_errors=True)
            raise
        if size == 0:
            shutil.rmtree(work, ignore_errors=True)
            raise HTTPException(400, "The file is empty.")

        try:
            info = await asyncio.to_thread(pipeline.probe, source)
        except pipeline.PipelineError as e:
            shutil.rmtree(work, ignore_errors=True)
            raise HTTPException(400, str(e))
        if MAX_DURATION_MIN and info.duration > MAX_DURATION_MIN * 60:
            shutil.rmtree(work, ignore_errors=True)
            raise HTTPException(413, f"File is longer than {MAX_DURATION_MIN:g} minutes.")

        waveform = None
        if info.has_audio:
            try:
                waveform = await asyncio.to_thread(pipeline.audio_waveform, source, info.duration)
            except pipeline.PipelineError as exc:
                event("waveform_unavailable", job_id=job_id, detail=str(exc))

        with jobs_lock:
            jobs[job_id] = {
                "id": job_id,
                "filename": filename,
                "status": "uploaded",
                "stage": None,
                "progress": None,
                "error": None,
                "output": None,
                "media": info.__dict__,
                "updated_at": time.time(),
            }
        event("upload_ready", job_id=job_id, bytes=size, duration=info.duration,
              width=info.width, height=info.height, has_audio=info.has_audio)
        return {"id": job_id, "filename": filename, "waveform": waveform, **info.__dict__}
    finally:
        with jobs_lock:
            active_uploads.discard(job_id)


def _run(job_id: str, req: ProcessRequest, previous: dict) -> None:
    work = JOBS_DIR / job_id

    def progress(stage: str, pct: float | None) -> None:
        if stage != jobs[job_id].get("stage"):
            event("processing_stage", job_id=job_id, stage=stage)
        _update(job_id, stage=stage, progress=pct)

    started = time.monotonic()
    event("export_started", job_id=job_id, queue_ms=round((time.time() - previous["queued_at"]) * 1000), preset=req.preset)
    _update(job_id, status="processing", stage="Starting", progress=None, error=None, error_code=None, output=None)
    try:
        source = next(work.glob("source.*"))
        for stale in [*work.glob("output.*"), *work.glob("text_*.png"), work / "raw.wav"]:
            stale.unlink(missing_ok=True)
        shutil.rmtree(work / "denoised", ignore_errors=True)

        out = pipeline.process(
            source, work,
            denoise_audio=req.denoise, atten_lim=req.atten_lim, preset=req.preset,
            edits=[e.model_dump() for e in req.edits], cuts=[c.model_dump() for c in req.cuts], progress=progress,
        )
        _update(job_id, status="done", stage="Done", progress=1.0, output=out.name)
        event("export_ready", job_id=job_id, duration_ms=round((time.monotonic() - started) * 1000), bytes=out.stat().st_size)
    except Exception as exc:
        code, message = public_processing_error(exc)
        event("export_failed", job_id=job_id, code=code, exception=type(exc).__name__, detail=str(exc))
        _update(job_id, status="error", error=message, error_code=code)


@app.post("/api/jobs/{job_id}/process")
def start_processing(job_id: str, req: ProcessRequest):
    return _submit(job_id, req, _run)


def _submit(job_id, req, worker):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        if job["status"] in ("queued", "processing"):
            raise HTTPException(409, "This file is already being processed.")
        req.validate_media(job["media"])
        if sum(j["status"] in ("queued", "processing") for j in jobs.values()) >= MAX_PENDING_JOBS:
            raise HTTPException(429, "The processing queue is full. Please try again shortly.", headers={"Retry-After": "5"})
        previous = dict(job)
        previous["queued_at"] = time.time()
        event("job_queued", job_id=job_id, operation="silence" if worker is _analyze_silence else "export")
        job.update(status="queued", stage="Waiting in queue", progress=None, error=None, updated_at=time.time())
        if worker is _analyze_silence:
            job["silence"] = None
        try:
            executor.submit(worker, job_id, req, previous)
        except RuntimeError as exc:
            job.update(previous)
            raise HTTPException(503, "Export is temporarily unavailable. Please retry.") from exc
    return {"ok": True}


def _analyze_silence(job_id: str, req: SilenceRequest, previous: dict) -> None:
    started = time.monotonic()
    event("silence_started", job_id=job_id, queue_ms=round((time.time() - previous["queued_at"]) * 1000))
    _update(job_id, status="processing", stage="Detecting pauses", silence=None)
    try:
        source = next((JOBS_DIR / job_id).glob("source.*"))
        result = pipeline.detect_silence(source, previous["media"]["duration"], **req.model_dump())
        result["error"] = None
        result["settings"] = req.model_dump()
        event("silence_ready", job_id=job_id, segments=len(result["segments"]), duration_ms=round((time.monotonic() - started) * 1000))
    except Exception as exc:
        code, message = public_processing_error(exc)
        event("silence_failed", job_id=job_id, code=code, exception=type(exc).__name__, detail=str(exc))
        result = {"segments": [], "error": message, "error_code": code}
    _update(job_id, status=previous["status"], stage=previous.get("stage"),
            progress=previous.get("progress"), error=previous.get("error"), silence=result)


@app.post("/api/jobs/{job_id}/silence")
def analyze_silence(job_id: str, req: SilenceRequest):
    return _submit(job_id, req, _analyze_silence)


@app.get("/api/limits")
def limits():
    return {
        "presets": pipeline.EXPORT_PRESETS,
        "job_ttl_hours": JOB_TTL_HOURS,
        "max_upload_mb": MAX_UPLOAD_MB,
        "max_duration_min": MAX_DURATION_MIN,
        "max_output_side": int(os.environ.get("MAX_OUTPUT_SIDE", 0)),
    }


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    return _job(job_id)


@app.get("/api/jobs/{job_id}/source")
def job_source(job_id: str):
    _job(job_id)
    return FileResponse(next((JOBS_DIR / job_id).glob("source.*")))


@app.get("/api/jobs/{job_id}/result")
def job_result(job_id: str, request: Request):
    job = _job(job_id)
    if job["status"] != "done" or not job["output"]:
        raise HTTPException(400, "Result not ready.")
    path = JOBS_DIR / job_id / job["output"]
    stem = Path(job["filename"] or "recording").stem
    download_name = f"{stem}_clean{path.suffix}"
    if request.query_params.get("download"):
        return FileResponse(path, filename=download_name)
    return FileResponse(path)


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        if job["status"] in ("queued", "processing"):
            raise HTTPException(409, "Can't delete while processing.")
        shutil.rmtree(JOBS_DIR / job_id, ignore_errors=True)
        jobs.pop(job_id, None)
    return {"ok": True}


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
