"""Exercise body admission at the ASGI boundary, before JSON parsing."""
import unittest
import asyncio
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.body_limit import ControlBodyLimit
from backend import app as api
from backend.sessions import COOKIE, create_session


class BodyLimitTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, chunks, *, declared=None, path="/api/jobs/job/process"):
        messages = [{"type": "http.request", "body": chunk,
                     "more_body": i < len(chunks) - 1} for i, chunk in enumerate(chunks)]
        output, bodies = [], []

        async def receive():
            return messages.pop(0) if messages else {"type": "http.disconnect"}

        async def send(message):
            output.append(message)

        async def downstream(scope, receive, send):
            body = bytearray()
            while True:
                message = await receive()
                body.extend(message.get("body", b""))
                if not message.get("more_body", False):
                    break
            bodies.append(bytes(body))
            await send({"type": "http.response.start", "status": 200, "headers": []})

        scope = {"type": "http", "method": "POST", "path": path,
                 "headers": [] if declared is None else [(b"content-length", declared)]}
        await ControlBodyLimit(downstream, max_bytes=8)(scope, receive, send)
        return output[0]["status"], bodies, messages

    async def test_declared_oversize_rejected_without_consuming_body(self):
        status, bodies, pending = await self.request([b"large"], declared=b"9")
        self.assertEqual(status, 413)
        self.assertFalse(bodies)
        self.assertEqual(len(pending), 1)

    async def test_chunked_and_understated_lengths_cannot_bypass_limit(self):
        for declared in (None, b"1", b"invalid"):
            status, bodies, _ = await self.request([b"1234", b"56789"], declared=declared)
            self.assertEqual(status, 413)
            self.assertFalse(bodies)

    async def test_exact_limit_replayed_without_changing_bytes(self):
        status, bodies, _ = await self.request([b"1234", b"5678"])
        self.assertEqual(status, 200)
        self.assertEqual(bodies, [b"12345678"])

    async def test_media_uploads_keep_separate_streaming_admission(self):
        for path in ("/api/upload", "/api/jobs/job/presenter"):
            status, bodies, _ = await self.request([b"123456789"], declared=b"9", path=path)
            self.assertEqual(status, 200)
            self.assertEqual(bodies, [b"123456789"])


class BodyLimitIntegrationTests(unittest.TestCase):
    def test_rejection_preserves_session_privacy_and_request_reference(self):
        owner, token = create_session()
        job_id = "123456abcdef"
        with patch.dict(api.jobs, {job_id: {"owner": owner}}, clear=True), \
             patch.object(api, "_submit") as submit:
            with TestClient(api.app, cookies={COOKIE: token}) as client:
                response = client.post(f"/api/jobs/{job_id}/process", content=b"{}",
                                       headers={"content-length": str(1024**3)})
            self.assertEqual(response.status_code, 413)
            self.assertEqual(response.json()["error"]["code"], "request_body_too_large")
            self.assertEqual(response.json()["error"]["request_id"], response.headers["X-Request-ID"])
            self.assertEqual(response.headers["Cache-Control"], "private, no-store")
            submit.assert_not_called()


class BodyCapacityTests(unittest.IsolatedAsyncioTestCase):
    async def test_capacity_is_held_during_parsing_and_released_after_completion(self):
        entered, release = asyncio.Event(), asyncio.Event()
        responses = []

        async def downstream(scope, receive, send):
            await receive()
            entered.set()
            await release.wait()
            await send({"type": "http.response.start", "status": 200})

        async def receive():
            return {"type": "http.request", "body": b"{}"}

        async def send(message):
            if message["type"] == "http.response.start":
                responses.append(message["status"])

        scope = {"type": "http", "method": "POST", "path": "/api/control", "headers": []}
        limiter = ControlBodyLimit(downstream, max_bytes=8, max_active=1)
        first = asyncio.create_task(limiter(scope, receive, send))
        try:
            await asyncio.wait_for(entered.wait(), 1)
            await limiter(scope, receive, send)
            self.assertEqual(responses, [429])
        finally:
            release.set()
            await first
        await limiter(scope, receive, send)
        self.assertEqual(responses, [429, 200, 200])

    async def test_slow_body_timeout_releases_capacity(self):
        async def downstream(*args):
            self.fail("Timed-out request must not reach JSON parsing")

        async def receive():
            await asyncio.Event().wait()

        output = []

        async def send(message):
            output.append(message)

        scope = {"type": "http", "method": "POST", "path": "/api/control", "headers": []}
        limiter = ControlBodyLimit(downstream, max_bytes=8, max_active=1, timeout=.01)
        for _ in range(2):
            await limiter(scope, receive, send)
        self.assertEqual([m["status"] for m in output if m["type"] == "http.response.start"], [408, 408])

    async def test_downstream_failure_releases_capacity(self):
        async def downstream(*args):
            raise RuntimeError("validation failed")

        async def receive():
            return {"type": "http.request", "body": b"{}"}

        async def send(message):
            self.fail("Capacity must not be leaked after failure")

        scope = {"type": "http", "method": "POST", "path": "/api/control", "headers": []}
        limiter = ControlBodyLimit(downstream, max_bytes=8, max_active=1)
        for _ in range(2):
            with self.assertRaisesRegex(RuntimeError, "validation failed"):
                await limiter(scope, receive, send)
