"""FreeEdit API: upload -> edit -> process -> download.

Run from the project root:
    uvicorn backend.app:app --port 8000
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import os
from urllib.parse import urlsplit
from contextlib import asynccontextmanager
import shutil
import threading
import time
import uuid
import anyio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import pipeline
from . import sequence as clip_sequence
from .runtime_info import runtime_info
from .diagnostics import inspect_setup, require_export_space, require_preview_space
from .execution import Cancelled, JobControl, cancellation_scope
from .models import ProcessRequest, SilenceRequest, PreviewRequest, BackgroundPreviewRequest, CompositionPreviewRequest, ResultPreviewRequest
from .observability import event, install_error_handling, public_processing_error
from .sessions import COOKIE, create_session, verify_session
from .body_limit import ControlBodyLimit
from .job_store import JobStore, InstanceLease
from .rate_limit import RequestLimiter, category_for, limits as admission_limits, env_int

ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = Path(os.environ.get("FREEEDIT_JOBS_DIR", ROOT / "jobs"))
FRONTEND_DIR = ROOT / "frontend"
RUNTIME_INFO = runtime_info(ROOT)

# Generous defaults for local use; tighten via env vars when hosting publicly
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", 1024))
MAX_DURATION_MIN = float(os.environ.get("MAX_DURATION_MIN", 0))  # 0 = no limit
JOB_TTL_HOURS = float(os.environ.get("JOB_TTL_HOURS", 24))
ALLOWED_EXT = {".mov", ".mp4", ".m4v", ".mkv", ".webm", ".avi", ".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"}

JOBS_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app):
    lease = InstanceLease(JOBS_DIR)
    await anyio.to_thread.run_sync(lease.acquire)
    try:
        recovered = await anyio.to_thread.run_sync(lambda: JobStore(JOBS_DIR).restore(ttl_hours=JOB_TTL_HOURS))
        with jobs_lock:
            for job_id, job in recovered.items():
                jobs.setdefault(job_id, job)
        event("jobs_restored", count=len(recovered))
    except BaseException:
        lease.release()
        raise
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
        # Stop child processes before releasing the directory to a new server.
        with jobs_lock:
            pending = list(job_futures.values())
            for control in job_controls.values():
                control.cancel()
        if pending:
            from concurrent.futures import wait
            await anyio.to_thread.run_sync(lambda: wait(pending))
        lease.release()


app = FastAPI(title="FreeEdit", lifespan=lifespan)
app.add_middleware(ControlBodyLimit,
                   max_bytes=env_int("FREEEDIT_MAX_EDIT_REQUEST_MB", 16) * 1024**2,
                   max_active=env_int("FREEEDIT_MAX_ACTIVE_EDIT_REQUESTS", 2),
                   timeout=env_int("FREEEDIT_EDIT_REQUEST_TIMEOUT_SECONDS", 30))
install_error_handling(app)
# One job at a time: DeepFilterNet + x264 already saturate the CPU
executor = ThreadPoolExecutor(max_workers=1)
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
persistence_lock = threading.Lock()
job_controls = {}
job_futures = {}
active_uploads: set[str] = set()
MAX_PENDING_JOBS = max(1, int(os.environ.get("MAX_PENDING_JOBS", 4)))
MAX_ACTIVE_UPLOADS = env_int("FREEEDIT_MAX_ACTIVE_UPLOADS", 2)
request_limiter = RequestLimiter()

# Job tokens are not authentication: every job additionally belongs to a
# signed browser session. Check this before all job routes (including GET media).
@app.middleware("http")
async def protect_session_jobs(request: Request, call_next):
    token = request.cookies.get(COOKIE)
    owner = verify_session(token)
    new_cookie = owner is None
    if new_cookie:
        owner, token = create_session()
    request.state.owner = owner

    def finish(response):
        # Session data and media must never be reused by browser/shared caches.
        if request.url.path.startswith("/api/") or new_cookie:
            response.headers["Cache-Control"] = "private, no-store"
            response.headers.add_vary_header("Cookie")
        if new_cookie:
            response.set_cookie(
                COOKIE, token, httponly=True, samesite="strict",
                secure=(request.url.scheme == "https" or
                        os.environ.get("FREEEDIT_SECURE_COOKIES", "").lower() in ("1", "true", "yes")), path="/",
                max_age=7 * 24 * 3600,
            )
        return response

    # Browsers send Origin on cross-origin unsafe requests; block those
    # requests before creating uploads or processing jobs.
    origin = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origin:
        try:
            parsed = urlsplit(origin)
            same_origin = parsed.scheme in ("http", "https") and parsed.netloc.lower() == request.headers.get("host", "").lower()
        except ValueError:
            same_origin = False
        if not same_origin:
            return finish(JSONResponse(status_code=403, content={"detail": "Cross-origin modification denied."}))

    match = re.match(r"^/api/jobs/([^/]+)(?:/|$)", request.url.path)
    if match:
        with jobs_lock:
            job = jobs.get(match.group(1))
            permitted = bool(job and job.get("owner") == owner)
        if not permitted:
            # Do not expose whether someone else's job exists.
            return finish(JSONResponse(status_code=404, content={"detail": "Job not found."}))

    category = category_for(request.method, request.url.path)
    if category:
        # No trust in request-supplied X-Forwarded-For. Use an edge limiter
        # for per-public-IP enforcement behind a reverse proxy.
        peer = request.client.host if request.client else "unknown"
        session_limit, peer_limit = admission_limits(category)
        retry = request_limiter.check(category, owner, peer,
                                      session_limit=session_limit, peer_limit=peer_limit)
        if retry:
            return finish(JSONResponse(status_code=429,
                content={"detail": "Too many requests. Try again shortly."},
                headers={"Retry-After": str(retry)}))


    response = await call_next(request)
    return finish(response)


def _update(job_id: str, **fields) -> None:
    with jobs_lock:
        previous_stage = jobs[job_id].get("stage")
        previous_touch = jobs[job_id].get("updated_at", 0)
        now = time.time()
        jobs[job_id].update(fields, updated_at=now)
        job = jobs[job_id]
        persist = (bool(set(fields) - {"stage", "progress"})
                   or fields.get("stage", previous_stage) != previous_stage
                   or int(previous_touch // 30) != int(now // 30))
    if persist:
        _persist_job(job)


def _persist_job(job):
    # Serialize writers, then capture the latest state briefly under the registry
    # lock. No filesystem operation may hold jobs_lock or run on the event loop.
    with persistence_lock:
        with jobs_lock:
            current = jobs.get(job["id"])
            if current is not job:
                return  # Deleted/replaced while this writer waited.
            snapshot = copy.deepcopy(current)
        if (JOBS_DIR / snapshot["id"]).is_dir():
            try:
                JobStore(JOBS_DIR).save(snapshot)
            except FileNotFoundError:
                with jobs_lock:
                    if jobs.get(job["id"]) is job:
                        raise


def _job(job_id: str) -> dict:
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        now = time.time()
        persist = now - job.get("updated_at", 0) >= 30
        if persist:
            job["updated_at"] = now
        snapshot = dict(job)
    if persist:
        _persist_job(job)
    return snapshot


def _working_source(job_id: str) -> Path:
    work = JOBS_DIR / job_id
    sequence = work / "sequence.mp4"
    return sequence if sequence.is_file() else next(work.glob("source.*"))


def _cleanup_old_jobs() -> None:
    cutoff = time.time() - JOB_TTL_HOURS * 3600
    # Serialize deletion with admission; uploads are protected before mkdir.
    with jobs_lock:
        for d in JOBS_DIR.iterdir():
            if not d.is_dir() or d.name in active_uploads:
                continue
            job = jobs.get(d.name)
            if d.name in job_controls or (job and job["status"] in ("queued", "processing", "cancelling")):
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


def _write_upload_chunk(file, chunk: bytes, work: Path, flush: bool):
    """Disk checks, writes and fsync run together outside the event loop."""
    if shutil.disk_usage(work).free < len(chunk) + 64 * 1024**2:
        raise HTTPException(507, "Temporary storage is full. Use Storage and cleanup or free disk space.")
    file.write(chunk)
    if flush:
        _drop_cache(file)


@app.post("/api/upload")
async def upload(request: Request, filename: str):
    return await _receive_upload(request, filename)


@app.post("/api/jobs/{job_id}/clips")
async def add_sequence_clip(job_id: str, request: Request, filename: str):
    """Upload one compatible main clip, append it, and rebuild the sequence."""
    job = _job(job_id)
    if not job["media"].get("has_video"):
        raise HTTPException(422, "Main clip sequences require a video project.")
    with jobs_lock:
        if job_id in active_uploads or job_id in job_controls:
            raise HTTPException(409, "Wait for the current operation before changing clips.")
        active_uploads.add(job_id)
    temporary_id = None
    destination = None
    try:
        uploaded = await _receive_upload(request, filename, protected_job=job_id)
        temporary_id = uploaded["id"]
        if not uploaded["has_video"]:
            raise HTTPException(422, "Choose a video clip.")
        base = job["media"]
        if (uploaded["width"] != base["width"] or uploaded["height"] != base["height"]
                or uploaded["has_audio"] != base["has_audio"]
                or abs(uploaded["frame_rate"] - base.get("frame_rate", 30)) > .01):
            raise HTTPException(422, "Clips must match the sequence dimensions, frame rate, and audio tracks.")
        clips = copy.deepcopy(job.get("sequence_clips") or [{
            "id": uuid.uuid4().hex[:8], "name": job["filename"],
            "file": next((JOBS_DIR / job_id).glob("source.*")).name,
            "duration": base["duration"],
        }])
        if len(clips) >= 8:
            raise HTTPException(422, "A sequence can contain up to 8 clips.")
        if MAX_DURATION_MIN and sum(c["duration"] for c in clips) + uploaded["duration"] > MAX_DURATION_MIN * 60:
            raise HTTPException(413, f"The sequence exceeds {MAX_DURATION_MIN:g} minutes.")
        source = next((JOBS_DIR / temporary_id).glob("source.*"))
        clip_id = uuid.uuid4().hex[:8]
        destination = JOBS_DIR / job_id / f"clip-{clip_id}{source.suffix.lower()}"
        source.replace(destination)
        clips.append({"id": clip_id, "name": filename[:255], "file": destination.name, "duration": uploaded["duration"]})
        try:
            transitions = copy.deepcopy(job.get("sequence_transitions") or [{"type":"cut","duration":0} for _ in clips[1:-1]])
            transitions.append({"type":"cut","duration":0})
            media = await anyio.to_thread.run_sync(clip_sequence.rebuild, JOBS_DIR / job_id, clips, transitions)
        except pipeline.PipelineError as exc:
            raise HTTPException(422, str(exc)) from exc
        waveform = None
        if media["has_audio"]:
            try:
                waveform = await anyio.to_thread.run_sync(pipeline.audio_waveform, JOBS_DIR / job_id / "sequence.mp4", media["duration"])
            except pipeline.PipelineError as exc:
                event("waveform_unavailable", job_id=job_id, detail=str(exc))
        with jobs_lock:
            current = jobs[job_id]
            current.update(sequence_clips=clips, sequence_transitions=transitions, media=media, waveform=waveform,
                           result_preview=None, updated_at=time.time())
        _persist_job(jobs[job_id])
        return {"clips": [{k: c[k] for k in ("id", "name", "duration")} for c in clips], **media, "waveform": waveform}
    except BaseException:
        if destination:
            destination.unlink(missing_ok=True)
        raise
    finally:
        if temporary_id:
            shutil.rmtree(JOBS_DIR / temporary_id, ignore_errors=True)
            with jobs_lock:
                jobs.pop(temporary_id, None)
        with jobs_lock:
            active_uploads.discard(job_id)


@app.put("/api/jobs/{job_id}/clips/order")
async def order_sequence_clips(job_id: str, request: Request):
    job = _job(job_id)
    clips = copy.deepcopy(job.get("sequence_clips") or [{
        "id": uuid.uuid4().hex[:8], "name": job["filename"],
        "file": next((JOBS_DIR / job_id).glob("source.*")).name,
        "duration": job["media"]["duration"],
    }])
    try:
        body = await request.json()
        order = body.get("order")
    except (ValueError, AttributeError):
        raise HTTPException(400, "Choose a valid clip order.")
    by_id = {clip["id"]: clip for clip in clips}
    if not isinstance(order, list) or not 1 <= len(order) <= len(clips) or len(set(order)) != len(order) or any(item not in by_id for item in order):
        raise HTTPException(422, "Keep at least one clip and choose a valid order.")
    with jobs_lock:
        if job_id in active_uploads or job_id in job_controls:
            raise HTTPException(409, "Wait for the current operation before changing clips.")
        active_uploads.add(job_id)
    try:
        selected = [by_id[item] for item in order]
        transitions = copy.deepcopy(body.get("transitions", job.get("sequence_transitions") or [{"type":"cut","duration":0} for _ in clips[1:]]))
        if not isinstance(transitions, list) or len(transitions) != len(selected) - 1:
            raise HTTPException(422, "Choose one transition for each clip join.")
        media = await anyio.to_thread.run_sync(clip_sequence.rebuild, JOBS_DIR / job_id, selected, transitions)
        waveform = None
        if media["has_audio"]:
            try:
                waveform = await anyio.to_thread.run_sync(pipeline.audio_waveform, JOBS_DIR / job_id / "sequence.mp4", media["duration"])
            except pipeline.PipelineError as exc:
                event("waveform_unavailable", job_id=job_id, detail=str(exc))
        removed = [clip for clip in clips if clip["id"] not in order]
        with jobs_lock:
            jobs[job_id].update(sequence_clips=selected, sequence_transitions=transitions, media=media, waveform=waveform,
                                result_preview=None, updated_at=time.time())
        _persist_job(jobs[job_id])
        for clip in removed:
            path = JOBS_DIR / job_id / clip["file"]
            if not clip["file"].startswith("source."):
                path.unlink(missing_ok=True)
        return {"clips": [{k: c[k] for k in ("id", "name", "duration")} for c in selected], **media, "waveform": waveform}
    except pipeline.PipelineError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        with jobs_lock:
            active_uploads.discard(job_id)


async def _receive_upload(request: Request, filename: str, protected_job: str | None = None):
    """Raw request body = the file. Streamed straight to disk (no multipart
    temp file, so large uploads aren't written twice)."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type '{ext}'.")

    job_id = uuid.uuid4().hex[:12]
    work = JOBS_DIR / job_id
    with jobs_lock:
        if len(active_uploads - ({protected_job} if protected_job else set())) >= MAX_ACTIVE_UPLOADS:
            raise HTTPException(429, "Too many uploads are in progress. Try again shortly.",
                                headers={"Retry-After": "10"})
        active_uploads.add(job_id)
    work_created = False
    try:
        await anyio.to_thread.run_sync(work.mkdir)
        work_created = True
        source = work / f"source{ext}"
        size = since_flush = 0
        limit = MAX_UPLOAD_MB * 1024 * 1024
        async with await anyio.open_file(source, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File is larger than {MAX_UPLOAD_MB} MB.")
                since_flush += len(chunk)
                flush = since_flush > 16 * 1024 * 1024
                await anyio.to_thread.run_sync(_write_upload_chunk, f.wrapped, chunk, work, flush)
                if flush:
                    since_flush = 0
            await anyio.to_thread.run_sync(_drop_cache, f.wrapped)
        if size == 0:
            raise HTTPException(400, "The file is empty.")

        try:
            info = await anyio.to_thread.run_sync(pipeline.probe, source)
        except pipeline.PipelineError as e:
            raise HTTPException(400, str(e)) from e
        if MAX_DURATION_MIN and info.duration > MAX_DURATION_MIN * 60:
            raise HTTPException(413, f"File is longer than {MAX_DURATION_MIN:g} minutes.")

        waveform = None
        if info.has_audio:
            try:
                waveform = await anyio.to_thread.run_sync(pipeline.audio_waveform, source, info.duration)
            except pipeline.PipelineError as exc:
                event("waveform_unavailable", job_id=job_id, detail=str(exc))

        with jobs_lock:
            jobs[job_id] = {
                "id": job_id,
                "filename": filename,
                "owner": request.state.owner,
                "status": "uploaded",
                "stage": None,
                "progress": None,
                "error": None,
                "output": None,
                "media": info.__dict__,
                "updated_at": time.time(),
            }
        try:
            await anyio.to_thread.run_sync(_persist_job, jobs[job_id])
        except BaseException:
            with jobs_lock:
                jobs.pop(job_id, None)
            raise
        event("upload_ready", job_id=job_id, bytes=size, duration=info.duration,
              width=info.width, height=info.height, has_audio=info.has_audio)
        return {"id": job_id, "filename": filename, "waveform": waveform, **info.__dict__}
    except BaseException:
        # Includes disconnect/cancellation and failures during probe/waveform.
        # Unregistered uploads must not strand media until the TTL sweep.
        if work_created:
            with anyio.CancelScope(shield=True):
                await anyio.to_thread.run_sync(lambda: shutil.rmtree(work, ignore_errors=True))
        raise
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
    _update(job_id, started_at=time.time())
    event("export_started", job_id=job_id, queue_ms=round((time.time() - previous["queued_at"]) * 1000), preset=req.preset)
    _update(job_id, status="processing", stage="Starting", progress=None, error=None, error_code=None, output=None)
    try:
        source = _working_source(job_id)
        source_duration = previous["media"]["duration"]
        keep = pipeline.kept_ranges([c.model_dump() for c in req.cuts], source_duration) or [(0, source_duration)]
        segments = pipeline.speed_segments(keep, [r.model_dump() for r in req.speed_regions])
        output_duration = sum((b-a)/rate for a,b,rate in segments)
        require_export_space(work, max(source_duration, output_duration), previous["media"]["audio_channels"], background=bool(req.background))
        for stale in [*work.glob("output.*"), *work.glob("text_*.png"), work / "raw.wav"]:
            stale.unlink(missing_ok=True)
        shutil.rmtree(work / "denoised", ignore_errors=True)

        from .rendering import render
        out = render(source, work, req.model_dump(), progress,
                     next(work.glob("presenter.*")) if req.presenter else None)
        _update(job_id, status="done", stage="Done", progress=1.0, output=out.name)
        event("export_ready", job_id=job_id, duration_ms=round((time.monotonic() - started) * 1000), bytes=out.stat().st_size)
    except Cancelled:
        raise
    except Exception as exc:
        code, message = public_processing_error(exc)
        event("export_failed", job_id=job_id, code=code, exception=type(exc).__name__, detail=str(exc))
        _update(job_id, status="error", error=message, error_code=code)


def _execute(worker, job_id, req, previous, control):
    try:
        with cancellation_scope(control):
            worker(job_id, req, previous)
    except Cancelled:
        work = JOBS_DIR / job_id
        if worker is _preview_result:
            shutil.rmtree(work / "result-preview", ignore_errors=True)
        if worker is _preview_noise:
            shutil.rmtree(work / "preview", ignore_errors=True)
        if worker is _preview_background:
            shutil.rmtree(work / "background-preview", ignore_errors=True)
        if worker is _preview_composition:
            shutil.rmtree(work / "composition-preview", ignore_errors=True)
        if worker is _run:
            for path in [*work.glob("output.*"), *work.glob("text_*.png"), work / "raw.wav"]:
                path.unlink(missing_ok=True)
            shutil.rmtree(work / "denoised", ignore_errors=True)
        try:
            _update(job_id, status="cancelled", stage="Stopped", progress=None, error=None, output=None if worker is _run else previous.get("output"))
        except OSError:
            event("job_persist_failed", job_id=job_id)
        event("job_cancelled", job_id=job_id)
    except Exception as exc:
        code, message = public_processing_error(exc)
        event("job_failed", job_id=job_id, code=code, exception=type(exc).__name__)
        with jobs_lock:
            job = jobs[job_id]
            job.update(status="error", stage=None, progress=None, error=message,
                       error_code=code, updated_at=time.time(), cancel_requested=False)
            if worker is _run:
                job["output"] = None
        try:
            _persist_job(job)
        except OSError:
            event("job_persist_failed", job_id=job_id)
    finally:
        shutil.rmtree(JOBS_DIR / job_id / "composition", ignore_errors=True)
        for temporary in (JOBS_DIR / job_id / "person-mask.mkv", JOBS_DIR / job_id / "background-worker.json", JOBS_DIR / job_id / "background.png"):
            temporary.unlink(missing_ok=True)
        with jobs_lock:
            job_controls.pop(job_id, None)
            job_futures.pop(job_id, None)


@app.post("/api/jobs/{job_id}/cancel")
def cancel_processing(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        control = job_controls.get(job_id)
        if not control or job["status"] not in ("queued", "processing", "cancelling"):
            raise HTTPException(409, "Processing has already finished.")
        control.cancel()
        future = job_futures.get(job_id)
        job.update(cancel_requested=True, stage="Stopping…", updated_at=time.time())
        if future and future.cancel():
            job.update(status="cancelled", stage="Stopped", progress=None, error=None)
            job_controls.pop(job_id, None)
            job_futures.pop(job_id, None)
        else:
            job["status"] = "cancelling"
    _persist_job(job)
    return {"ok": True}


@app.post("/api/jobs/{job_id}/process")
def start_processing(job_id: str, req: ProcessRequest):
    return _submit(job_id, req, _run)


def _submit(job_id, req, worker):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        if job_id in active_uploads or job_id in job_controls or job["status"] in ("queued", "processing", "cancelling"):
            raise HTTPException(409, "This file is already being processed.")
        req.validate_media(job["media"])
        presenter = getattr(req, "presenter", None)
        if presenter:
            if not job.get("presenter"):
                raise HTTPException(422, "Add the presenter video again before processing.")
            presenter.validate_media(job["media"], job["presenter"]["media"])
            if getattr(req, "preset", None) == "audio_only" and presenter.sound == "muted":
                raise HTTPException(422, "Choose an audio source for an audio-only export.")
        if sum(j["status"] in ("queued", "processing", "cancelling") for j in jobs.values()) >= MAX_PENDING_JOBS:
            raise HTTPException(429, "The processing queue is full. Please try again shortly.", headers={"Retry-After": "5"})
        previous = dict(job)
        previous["queued_at"] = time.time()
        control = JobControl()
        job_controls[job_id] = control
        operation = { _analyze_silence: "silence", _preview_noise: "preview", _preview_background: "background", _preview_composition: "composition", _preview_result: "result-preview" }.get(worker, "export")
        event("job_queued", job_id=job_id, operation=operation)
        job.update(status="queued", stage="Waiting in queue", progress=None, error=None, updated_at=time.time(),
                   operation=operation,
                   queued_at=time.time(), started_at=None, cancel_requested=False)
        if worker is _run:
            job["export_submission_id"] = uuid.uuid4().hex
        if worker is _preview_result:
            job["result_preview_submission_id"] = uuid.uuid4().hex
            job["result_preview"] = None
        if worker is _analyze_silence:
            job["silence"] = None
        if worker is _preview_noise:
            job["preview"] = None
        if worker is _preview_background:
            job["background_preview"] = None
        if worker is _preview_composition:
            job["composition_preview"] = None
        submission_id = (job.get("export_submission_id") if worker is _run else
                         job.get("result_preview_submission_id") if worker is _preview_result else None)
    try:
        _persist_job(job)
        with jobs_lock:
            job_futures[job_id] = executor.submit(_execute, worker, job_id, req, previous, control)
    except (RuntimeError, OSError) as exc:
        with jobs_lock:
            job.clear()
            job.update(previous)
            job_controls.pop(job_id, None)
        try:
            _persist_job(job)
        except OSError:
            event("job_persist_failed", job_id=job_id)
        raise HTTPException(503, "Export is temporarily unavailable. Please retry.") from exc
    return {"ok": True, "submission_id": submission_id}


def _analyze_silence(job_id: str, req: SilenceRequest, previous: dict) -> None:
    started = time.monotonic()
    _update(job_id, started_at=time.time())
    event("silence_started", job_id=job_id, queue_ms=round((time.time() - previous["queued_at"]) * 1000))
    _update(job_id, status="processing", stage="Detecting pauses", silence=None)
    work = JOBS_DIR / job_id
    analysis_id = uuid.uuid4().hex
    results_path = work / f"silence-{analysis_id}.jsonl"
    try:
        source = _working_source(job_id)
        result = pipeline.detect_silence(source, previous["media"]["duration"], results_path=results_path, **req.model_dump())
        result.update(analysis_id=analysis_id, offset=0, limit=25)
        for stale in work.glob("silence-*.jsonl"):
            if stale != results_path:
                stale.unlink(missing_ok=True)
        result["error"] = None
        result["settings"] = req.model_dump()
        event("silence_ready", job_id=job_id, segments=len(result["segments"]), duration_ms=round((time.monotonic() - started) * 1000))
    except Cancelled:
        results_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        results_path.unlink(missing_ok=True)
        code, message = public_processing_error(exc)
        event("silence_failed", job_id=job_id, code=code, exception=type(exc).__name__, detail=str(exc))
        result = {"segments": [], "error": message, "error_code": code}
    _update(job_id, status=previous["status"] if previous["status"] != "cancelled" else "uploaded", stage=previous.get("stage"),
            progress=previous.get("progress"), error=previous.get("error"), silence=result)


@app.post("/api/jobs/{job_id}/silence")
def analyze_silence(job_id: str, req: SilenceRequest):
    return _submit(job_id, req, _analyze_silence)


@app.get("/api/jobs/{job_id}/silence-results")
def silence_results(job_id: str,
                    analysis_id: str = Query(pattern=r"^[a-f0-9]{32}$"),
                    offset: int = Query(default=0, ge=0),
                    limit: int = Query(default=25, ge=1, le=100)):
    result = _job(job_id).get("silence") or {}
    if result.get("analysis_id") != analysis_id or result.get("error"):
        raise HTTPException(409, "Pause analysis changed. Run detection again before reviewing more results.")
    if result["total"] and offset >= result["total"]:
        raise HTTPException(422, "Pause page is outside the analysis results.")
    path = JOBS_DIR / job_id / f"silence-{analysis_id}.jsonl"
    segments = []
    try:
        with path.open() as file:
            for index, line in enumerate(file):
                if index >= offset + limit:
                    break
                if index >= offset:
                    segments.append(json.loads(line))
    except FileNotFoundError:
        raise HTTPException(409, "Pause results expired. Run detection again.")
    return {"segments": segments, "total": result["total"], "offset": offset, "limit": limit,
            "analysis_id": analysis_id}


def _preview_noise(job_id: str, req: PreviewRequest, previous: dict) -> None:
    work = JOBS_DIR / job_id
    preview = work / "preview"
    _update(job_id, status="processing", started_at=time.time(), stage="Preparing audio sample")
    try:
        shutil.rmtree(preview, ignore_errors=True)
        if shutil.disk_usage(work).free < 32 * 1024**2:
            raise pipeline.PipelineError("Not enough disk space for an audio sample.")
        length = min(10, previous["media"]["duration"] - req.start)
        pipeline.noise_preview(_working_source(job_id), preview, req.start, length,
                               req.atten_lim, lambda stage, pct: _update(job_id, stage=stage, progress=pct))
        result = {"start": req.start, "duration": length, "atten_lim": req.atten_lim, "error": None}
    except Cancelled:
        raise
    except Exception as exc:
        shutil.rmtree(preview, ignore_errors=True)
        code, message = public_processing_error(exc)
        event("preview_failed", job_id=job_id, code=code, detail=str(exc))
        result = {"error": message}
    _update(job_id, status="done" if previous.get("output") else "uploaded",
            stage=None, progress=None, preview=result)


@app.post("/api/jobs/{job_id}/preview")
def preview_noise(job_id: str, req: PreviewRequest):
    return _submit(job_id, req, _preview_noise)


@app.api_route("/api/jobs/{job_id}/preview/{variant}", methods=["GET", "HEAD"])
def preview_audio(job_id: str, variant: str):
    job = _job(job_id)
    if variant not in ("original", "clean") or not job.get("preview") or job["preview"].get("error"):
        raise HTTPException(404, "Audio sample is not ready.")
    path = JOBS_DIR / job_id / "preview" / f"{variant}.wav"
    if not path.is_file():
        raise HTTPException(404, "Audio sample expired. Create another sample.")
    return FileResponse(path)


def _preview_background(job_id: str, req: BackgroundPreviewRequest, previous: dict):
    work = JOBS_DIR / job_id
    preview = work / "background-preview"
    _update(job_id, status="processing", started_at=time.time(), stage="Preparing background preview")
    try:
        shutil.rmtree(preview, ignore_errors=True)
        preview.mkdir()
        length = min(3, previous["media"]["duration"] - req.start)
        require_export_space(work, length, 0, background=True)
        source = _working_source(job_id)
        sample = preview / "source.mp4"
        pipeline._run_ffmpeg(["-ss", str(req.start), "-i", str(source), "-t", str(length),
            "-an", "-vf", f"tpad=stop_mode=clone:stop_duration={length}", "-c:v", "libx264",
            "-preset", "ultrafast", "-crf", "18", "-pix_fmt", "yuv420p", str(sample)],
            length, "Preparing background preview", lambda stage, pct: _update(job_id, stage=stage, progress=pct))
        pipeline.process(sample, preview, denoise_audio=False, atten_lim=None, edits=[], cuts=[], preset="small",
            background=req.background.model_dump(), progress=lambda stage, pct: _update(job_id, stage=stage, progress=pct))
        sample.unlink(missing_ok=True)
        result = {"start": req.start, "duration": length, "error": None}
    except Cancelled:
        raise
    except Exception as exc:
        shutil.rmtree(preview, ignore_errors=True)
        code, message = public_processing_error(exc)
        event("background_preview_failed", job_id=job_id, code=code, detail=str(exc))
        result = {"error": message}
    _update(job_id, status="done" if previous.get("output") else "uploaded", stage=None, progress=None, background_preview=result)


@app.post("/api/jobs/{job_id}/background-preview")
def preview_background(job_id: str, req: BackgroundPreviewRequest):
    return _submit(job_id, req, _preview_background)


@app.api_route("/api/jobs/{job_id}/background-preview", methods=["GET", "HEAD"])
def background_preview_result(job_id: str):
    job = _job(job_id)
    path = JOBS_DIR / job_id / "background-preview" / "output.mp4"
    if not job.get("background_preview") or job["background_preview"].get("error") or not path.is_file():
        raise HTTPException(404, "Background preview is not ready.")
    return FileResponse(path)


@app.post("/api/jobs/{job_id}/presenter")
async def upload_presenter(job_id: str, request: Request, filename: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Main recording not found.")
        if job_id in active_uploads or job_id in job_controls:
            raise HTTPException(409, "Wait for the current operation to finish.")
        if not job["media"]["has_video"]:
            raise HTTPException(422, "The main recording must contain video.")
        active_uploads.add(job_id)
    temporary_id = None
    try:
        uploaded = await _receive_upload(request, filename, protected_job=job_id)
        temporary_id = uploaded["id"]
        if not uploaded["has_video"]:
            raise HTTPException(422, "Choose a presenter recording with video.")
        with jobs_lock:
            work = JOBS_DIR / job_id
            for old in work.glob("presenter.*"):
                old.unlink()
            source = next((JOBS_DIR / temporary_id).glob("source.*"))
            source.replace(work / ("presenter" + source.suffix))
            metadata = {"filename": filename, "media": jobs[temporary_id]["media"]}
            jobs[job_id].update(presenter=metadata, updated_at=time.time(), composition_preview=None, result_preview=None)
        await anyio.to_thread.run_sync(_persist_job, jobs[job_id])
        return metadata
    finally:
        with jobs_lock:
            active_uploads.discard(job_id)
            if temporary_id:
                jobs.pop(temporary_id, None)
                shutil.rmtree(JOBS_DIR / temporary_id, ignore_errors=True)


@app.api_route("/api/jobs/{job_id}/presenter", methods=["GET", "HEAD"])
def presenter_source(job_id: str):
    job = _job(job_id)
    path = next((JOBS_DIR / job_id).glob("presenter.*"), None)
    if not job.get("presenter") or path is None:
        raise HTTPException(404, "Presenter recording unavailable. Select it again.")
    return FileResponse(path)


def _preview_composition(job_id, req, previous):
    from .composition import compose
    work = JOBS_DIR / job_id
    target = work / "composition-preview"
    _update(job_id, status="processing", started_at=time.time(), stage="Preparing combined preview")
    try:
        shutil.rmtree(target, ignore_errors=True)
        target.mkdir()
        length = min(3, previous["media"]["duration"] - req.start)
        require_export_space(work, length, 2, background=req.presenter.effect != "original")
        compose(_working_source(job_id), next(work.glob("presenter.*")), target,
                req.presenter.model_dump(), lambda stage, pct: _update(job_id, stage=stage, progress=pct),
                start=req.start, length=length)
        result = {"start": req.start, "duration": length, "error": None}
    except Cancelled:
        raise
    except Exception as exc:
        code, message = public_processing_error(exc)
        event("composition_preview_failed", job_id=job_id, code=code, detail=str(exc))
        shutil.rmtree(target, ignore_errors=True)
        result = {"error": message}
    _update(job_id, status="done" if previous.get("output") else "uploaded", stage=None, progress=None, composition_preview=result)


@app.post("/api/jobs/{job_id}/composition-preview")
def preview_composition(job_id: str, req: CompositionPreviewRequest):
    return _submit(job_id, req, _preview_composition)


@app.api_route("/api/jobs/{job_id}/composition-preview", methods=["GET", "HEAD"])
def composition_preview_result(job_id: str):
    job = _job(job_id)
    path = JOBS_DIR / job_id / "composition-preview" / "combined.mp4"
    if not job.get("composition_preview") or job["composition_preview"].get("error") or not path.is_file():
        raise HTTPException(404, "Combined preview is not ready.")
    return FileResponse(path)


def _storage_inventory(owner: str):
    entries = []
    for directory in JOBS_DIR.iterdir():
        # Never disclose or delete another session's recordings.
        if directory.name not in jobs or jobs[directory.name].get("owner") != owner:
            continue
        if directory.is_dir() and len(directory.name) == 12 and all(c in "0123456789abcdef" for c in directory.name):
            size = sum(p.stat().st_size for p in directory.rglob("*") if p.is_file())
            entries.append((directory, size))
    return entries


@app.get("/api/storage")
def storage(request: Request, keep: str = ""):
    with jobs_lock:
        entries = _storage_inventory(request.state.owner)
        protected = active_uploads | set(job_controls) | {keep}
        return {"used_bytes": sum(size for _, size in entries),
                "reclaimable_bytes": sum(size for path, size in entries if path.name not in protected),
                "files": len(entries), "free_bytes": shutil.disk_usage(JOBS_DIR).free}


@app.post("/api/storage/cleanup")
def cleanup_storage(request: Request, keep: str):
    # The open recording is explicitly preserved alongside every active operation.
    with jobs_lock:
        protected = active_uploads | set(job_controls) | {keep}
        removed = 0
        for path, size in _storage_inventory(request.state.owner):
            if path.name in protected:
                continue
            shutil.rmtree(path)
            jobs.pop(path.name, None)
            removed += size
    return {"removed_bytes": removed}


@app.get("/api/limits")
def limits():
    return {
        "presets": pipeline.EXPORT_PRESETS,
        "job_ttl_hours": JOB_TTL_HOURS,
        "max_upload_mb": MAX_UPLOAD_MB,
        "max_duration_min": MAX_DURATION_MIN,
        "max_output_side": int(os.environ.get("MAX_OUTPUT_SIDE", 0)),
    }


@app.get("/api/diagnostics")
def diagnostics():
    return inspect_setup(JOBS_DIR)


@app.get("/api/version")
def version():
    return RUNTIME_INFO


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    # Session identity is internal metadata, not part of the public job API.
    return {key: value for key, value in _job(job_id).items() if key != "owner"}


@app.api_route("/api/jobs/{job_id}/source", methods=["GET", "HEAD"])
def job_source(job_id: str):
    _job(job_id)
    return FileResponse(_working_source(job_id))


@app.api_route("/api/jobs/{job_id}/result", methods=["GET", "HEAD"])
def job_result(job_id: str, request: Request):
    job = _job(job_id)
    replacing_export = job.get("operation") == "export" and job["status"] in ("queued", "processing", "cancelling")
    if replacing_export or not job.get("output"):
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
        if job_id in active_uploads or job_id in job_controls or job["status"] in ("queued", "processing", "cancelling"):
            raise HTTPException(409, "Can't delete while processing.")
        try:
            shutil.rmtree(JOBS_DIR / job_id)
        except FileNotFoundError:
            pass
        jobs.pop(job_id, None)
    return {"ok": True}


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
@app.get("/index.html", response_class=HTMLResponse, include_in_schema=False)
def index():
    # Content hashes keep a new page from mixing cached scripts/styles with new UI.
    html = (FRONTEND_DIR / "index.html").read_text()
    def version_asset(match):
        attribute, filename = match.groups()
        digest = hashlib.sha256((FRONTEND_DIR / filename).read_bytes()).hexdigest()[:12]
        return f'{attribute}="{filename}?v={digest}"'
    html = re.sub(r'(src|href)="([\w-]+\.(?:js|css))"', version_asset, html)
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if Path(path).suffix in {".js", ".mjs", ".css", ".html"}:
            response.headers["Cache-Control"] = "no-cache"
        return response


def _preview_result(job_id, req, previous):
    from .rendering import preview
    work = JOBS_DIR / job_id
    target = work / "result-preview"
    _update(job_id, status="processing", started_at=time.time(), stage="Preparing result preview")
    try:
        settings = req.model_dump(exclude={"start", "end"})
        fingerprint = hashlib.sha256(req.model_dump_json().encode()).hexdigest()
        cached = previous.get("result_preview") or {}
        if cached.get("signature") == fingerprint and (target / cached.get("file", "missing")).is_file():
            result = cached
        else:
            shutil.rmtree(target, ignore_errors=True)
            target.mkdir()
            require_preview_space(work, req.end - req.start, previous["media"])
            out, ranges = preview(_working_source(job_id), next(work.glob("presenter.*")) if req.presenter else None,
                target, settings, req.start, req.end, previous["media"]["duration"],
                lambda stage, pct: _update(job_id, stage=stage, progress=pct))
            result = {"start": req.start, "end": req.end, "ranges": ranges,
                      "file": out.name, "signature": fingerprint, "error": None}
    except Cancelled:
        raise
    except Exception as exc:
        code, message = public_processing_error(exc)
        event("result_preview_failed", job_id=job_id, code=code, detail=str(exc))
        shutil.rmtree(target, ignore_errors=True)
        result = {"error": message}
    _update(job_id, status="done" if previous.get("output") else "uploaded", stage=None, progress=None, result_preview=result)


@app.post("/api/jobs/{job_id}/result-preview")
def preview_result(job_id: str, req: ResultPreviewRequest):
    return _submit(job_id, req, _preview_result)


@app.api_route("/api/jobs/{job_id}/result-preview", methods=["GET", "HEAD"])
def result_preview_media(job_id: str):
    result = _job(job_id).get("result_preview") or {}
    if result.get("error") or result.get("file") not in ("output.mp4", "output.wav"):
        raise HTTPException(404, "Result preview is not ready.")
    path = JOBS_DIR / job_id / "result-preview" / result["file"]
    if not path.is_file():
        raise HTTPException(404, "Result preview is not ready.")
    return FileResponse(path, media_type="audio/wav" if path.suffix == ".wav" else "video/mp4")


app.mount("/", FrontendFiles(directory=FRONTEND_DIR, html=True), name="frontend")
