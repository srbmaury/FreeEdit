"""Bound control-request bytes, lifetime and concurrency before JSON parsing."""
import threading

import anyio
from starlette.requests import Request
from starlette.responses import JSONResponse


class ControlBodyLimit:
    def __init__(self, app, max_bytes: int, max_active: int = 2, timeout: float = 30):
        self.app = app
        self.max_bytes = max_bytes
        self.max_active = max_active
        self.timeout = timeout
        self._active = 0
        self._lock = threading.Lock()

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        upload = path == "/api/upload" or (
            path.startswith("/api/jobs/") and path.endswith(("/presenter", "/clips"))
        )
        if (scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}
                or not path.startswith("/api/") or upload):
            return await self.app(scope, receive, send)

        async def reject(status=413):
            request_id = scope.get("state", {}).get("request_id")
            code, message = {
                413: ("request_body_too_large", f"Edit request exceeds the {self.max_bytes // 1024**2} MiB limit. Reduce image sizes or the number of overlays."),
                429: ("request_capacity_full", "Too many edit requests are in progress. Retry shortly."),
                408: ("request_body_timeout", "Receiving the edit request took too long. Please retry."),
            }[status]
            response = JSONResponse(status_code=status, content={
                "detail": message, "error": {"code": code, "message": message, "request_id": request_id},
            }, headers={"Retry-After": "1"} if status == 429 else None)
            await response(scope, receive, send)

        declared = Request(scope).headers.get("content-length")
        if declared is not None:
            try:
                if int(declared) > self.max_bytes:
                    return await reject()
            except ValueError:
                pass

        with self._lock:
            admitted = self._active < self.max_active
            if admitted:
                self._active += 1
        if not admitted:
            return await reject(429)
        try:
            body = bytearray()
            try:
                with anyio.fail_after(self.timeout):
                    while True:
                        message = await receive()
                        if message["type"] == "http.disconnect":
                            return
                        chunk = message.get("body", b"")
                        if len(body) + len(chunk) > self.max_bytes:
                            return await reject()
                        body.extend(chunk)
                        if not message.get("more_body", False):
                            break
            except TimeoutError:
                return await reject(408)

            delivered = False

            async def replay():
                nonlocal delivered
                if delivered:
                    return await receive()
                delivered = True
                payload = bytes(body)
                body.clear()  # Release the staging buffer before JSON parsing.
                return {"type": "http.request", "body": payload, "more_body": False}

            # Hold admission through parsing/validation, not just receipt.
            await self.app(scope, replay, send)
        finally:
            with self._lock:
                self._active -= 1
