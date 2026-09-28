"""FreeEdit API: upload -> edit -> process -> download.

Run from the project root:
    uvicorn backend.app:app --port 8000
"""

from __future__ import annotations

import os
import shutil
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import pipeline

ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = ROOT / "jobs"
FRONTEND_DIR = ROOT / "frontend"

# Generous defaults for local use; tighten via env vars when hosting publicly
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", 1024))
MAX_DURATION_MIN = float(os.environ.get("MAX_DURATION_MIN", 0))  # 0 = no limit
JOB_TTL_HOURS = float(os.environ.get("JOB_TTL_HOURS", 24))
ALLOWED_EXT = {".mov", ".mp4", ".m4v", ".mkv", ".webm", ".avi", ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"}

JOBS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="FreeEdit")
# One job at a time: DeepFilterNet + x264 already saturate the CPU
executor = ThreadPoolExecutor(max_workers=1)
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


def _update(job_id: str, **fields) -> None:
    with jobs_lock:
        jobs[job_id].update(fields)


def _job(job_id: str) -> dict:
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


def _cleanup_old_jobs() -> None:
    cutoff = time.time() - JOB_TTL_HOURS * 3600
    for d in JOBS_DIR.iterdir():
        if d.is_dir() and d.stat().st_mtime < cutoff:
            shutil.rmtree(d, ignore_errors=True)
            with jobs_lock:
                jobs.pop(d.name, None)


@app.post("/api/upload")
async def upload(file: UploadFile):
    _cleanup_old_jobs()
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type '{ext}'.")

    job_id = uuid.uuid4().hex[:12]
    work = JOBS_DIR / job_id
    work.mkdir()
    source = work / f"source{ext}"
    size = 0
    with source.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_MB * 1024 * 1024:
                f.close()
                shutil.rmtree(work, ignore_errors=True)
                raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB.")
            f.write(chunk)

    try:
        info = pipeline.probe(source)
    except pipeline.PipelineError as e:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(400, str(e))
    if MAX_DURATION_MIN and info.duration > MAX_DURATION_MIN * 60:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(413, f"File is longer than {MAX_DURATION_MIN:g} minutes.")

    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "filename": file.filename,
            "status": "uploaded",
            "stage": None,
            "progress": None,
            "error": None,
            "output": None,
        }
    return {"id": job_id, "filename": file.filename, **info.__dict__}


class ProcessRequest(BaseModel):
    denoise: bool = True
    # dB cap on noise reduction; None = full strength
    atten_lim: int | None = Field(default=None, ge=0, le=100)
    edits: list[dict] = []
    # Parts of the video to remove: [{"start": s, "end": s}, ...]
    cuts: list[dict] = []


def _run(job_id: str, req: ProcessRequest) -> None:
    work = JOBS_DIR / job_id
    source = next(work.glob("source.*"))
    for stale in [*work.glob("output.*"), *work.glob("text_*.png"), work / "raw.wav"]:
        stale.unlink(missing_ok=True)
    shutil.rmtree(work / "denoised", ignore_errors=True)

    def progress(stage: str, pct: float | None) -> None:
        _update(job_id, stage=stage, progress=pct)

    _update(job_id, status="processing", stage="Starting", progress=None, error=None, output=None)
    try:
        out = pipeline.process(
            source, work,
            denoise_audio=req.denoise, atten_lim=req.atten_lim,
            edits=req.edits, cuts=req.cuts, progress=progress,
        )
        _update(job_id, status="done", stage="Done", progress=1.0, output=out.name)
    except pipeline.PipelineError as e:
        _update(job_id, status="error", error=str(e))
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        _update(job_id, status="error", error=f"Unexpected error: {e}")


@app.post("/api/jobs/{job_id}/process")
def start_processing(job_id: str, req: ProcessRequest):
    job = _job(job_id)
    if job["status"] in ("queued", "processing"):
        raise HTTPException(409, "This file is already being processed.")
    _update(job_id, status="queued", stage="Waiting in queue", progress=None, error=None)
    executor.submit(_run, job_id, req)
    return {"ok": True}


@app.get("/api/limits")
def limits():
    return {"max_upload_mb": MAX_UPLOAD_MB, "max_duration_min": MAX_DURATION_MIN}


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
    job = _job(job_id)
    if job["status"] in ("queued", "processing"):
        raise HTTPException(409, "Can't delete while processing.")
    shutil.rmtree(JOBS_DIR / job_id, ignore_errors=True)
    with jobs_lock:
        jobs.pop(job_id, None)
    return {"ok": True}


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
