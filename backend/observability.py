"""Consistent API errors and JSON events without media contents or filenames."""

import json
import logging
import time
import uuid
from datetime import datetime, timezone

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

logger = logging.getLogger("freeedit")
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())
logger.setLevel(logging.INFO)
logger.propagate = False


def event(name, **fields):
    logger.info(json.dumps({"time": datetime.now(timezone.utc).isoformat(), "event": name, **fields}))


def public_processing_error(exc):
    if "No module named" in str(exc):
        return "processor_unavailable", "Noise reduction is not configured on this server. Turn it off to export other edits, or configure the denoising environment."
    if "timed out" in str(exc).lower():
        return "processing_timeout", "Processing took too long. Try a shorter recording or the Small file preset."
    return "processing_failed", "Processing could not finish. Try again, or use a shorter recording with fewer edits."


def install_error_handling(app):
    def response(request, status, message, code, headers=None):
        request_id = getattr(request.state, "request_id", uuid.uuid4().hex[:12])
        return JSONResponse(status_code=status, headers=headers, content={
            "detail": message,
            "error": {"code": code, "message": message, "request_id": request_id},
        })

    @app.middleware("http")
    async def log_request(request, call_next):
        request.state.request_id = uuid.uuid4().hex[:12]
        start = time.monotonic()
        try:
            result = await call_next(request)
        except Exception as exc:
            event("request_failed", request_id=request.state.request_id, exception=type(exc).__name__)
            result = response(request, 500, "The server could not finish this request. Please retry.", "internal_error")
        result.headers["X-Request-ID"] = request.state.request_id
        route = request.scope.get("route")
        # Static requests and successful polling add little diagnostic value.
        if result.status_code >= 400 or (request.method != "GET" and route):
            event("request", request_id=request.state.request_id, method=request.method,
                  route=getattr(route, "path", "unknown"), status=result.status_code,
                  duration_ms=round((time.monotonic() - start) * 1000))
        return result

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        codes = {400: "invalid_request", 404: "file_unavailable", 409: "job_busy",
                 413: "media_limit_exceeded", 422: "invalid_edits", 429: "queue_full", 503: "service_unavailable"}
        return response(request, exc.status_code, exc.detail, codes.get(exc.status_code, "request_failed"), exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        messages = [f"{'.'.join(str(v) for v in error['loc'][1:])}: {error['msg']}" for error in exc.errors()]
        return response(request, 422, "; ".join(messages), "invalid_request")
