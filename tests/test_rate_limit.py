"""Admission tests avoid downloading or processing real media."""
import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend import app as api
from backend.rate_limit import RequestLimiter, category_for, limits, env_int
from backend.sessions import COOKIE, create_session


class Clock:
    def __init__(self):
        self.now = 0
    def __call__(self):
        return self.now


class RateLimitTests(unittest.TestCase):
    def test_category_classification(self):
        self.assertEqual(category_for("POST", "/api/upload"), "upload")
        self.assertEqual(category_for("POST", "/api/jobs/abcdef123456/presenter"), "upload")
        self.assertEqual(category_for("POST", "/api/jobs/abcdef123456/process"), "processing")
        self.assertEqual(category_for("POST", "/api/jobs/abcdef123456/result-preview"), "processing")
        self.assertEqual(category_for("GET", "/api/diagnostics"), "diagnostics")
        self.assertIsNone(category_for("GET", "/api/jobs/abcdef123456"))
        self.assertIsNone(category_for("GET", "/healthz"))

    def test_session_and_peer_limits_are_separate(self):
        clock = Clock()
        limiter = RequestLimiter(clock=clock)
        for i in range(2):
            self.assertEqual(limiter.check("upload", "a", "peer-1", session_limit=2, peer_limit=3), 0)
        self.assertEqual(limiter.check("upload", "a", "peer-1", session_limit=2, peer_limit=3), 600)
        self.assertEqual(limiter.check("upload", "b", "peer-1", session_limit=2, peer_limit=3), 0)
        self.assertEqual(limiter.check("upload", "b", "peer-1", session_limit=2, peer_limit=3), 600)
        self.assertEqual(limiter.check("upload", "b", "peer-2", session_limit=2, peer_limit=3), 0)
        self.assertEqual(limiter.check("upload", "b", "peer-2", session_limit=2, peer_limit=3), 600)
        clock.now += 601
        self.assertEqual(limiter.check("upload", "a", "peer-1", session_limit=2, peer_limit=3), 0)

    def test_invalid_limits_rejected(self):
        with patch.dict("os.environ", {"FREEEDIT_UPLOADS_PER_SESSION_10M": "0"}):
            with self.assertRaises(ValueError):
                limits("upload")

    def test_unauthorized_job_does_not_consume_processing_budget(self):
        owner, token = create_session()
        job_id = "abcdef123456"
        limiter = RequestLimiter()
        with patch.object(api, "request_limiter", limiter), patch.dict(
            api.jobs, {job_id: {"owner":owner,"id":job_id,"status":"uploaded"}}, clear=True
        ):
            with TestClient(api.app) as client:
                self.assertEqual(client.post(f"/api/jobs/{job_id}/process",json={}).status_code,404)
            self.assertEqual(limiter._events, {})

    def test_force_secure_cookie_behind_https_proxy(self):
        with patch.dict("os.environ", {"FREEEDIT_SECURE_COOKIES":"true"}):
            with TestClient(api.app) as client:
                response = client.get("/healthz")
                cookie = response.headers["set-cookie"].lower()
                self.assertIn("secure", cookie)
                self.assertIn("httponly", cookie)
                self.assertIn("samesite=strict", cookie)

    def test_limiter_is_fail_closed_at_client_capacity(self):
        clock = Clock()
        limiter = RequestLimiter(clock=clock,max_keys=2)
        self.assertEqual(limiter.check("upload","a","first",
                                       session_limit=10,peer_limit=10),0)
        self.assertEqual(limiter.check("upload","b","second",
                                       session_limit=10,peer_limit=10),600)
        self.assertEqual(limiter.check("upload","a","first",
                                       session_limit=10,peer_limit=10),0)
        clock.now=601
        self.assertEqual(limiter.check("upload","b","second",
                                       session_limit=10,peer_limit=10),0)

    def test_presenter_upload_uses_one_admission_slot(self):
        owner, token = create_session()
        job_id = "abcdef123456"
        media = dict(duration=2, has_video=True, has_audio=True, width=320,
                     height=180, audio_channels=2, frame_rate=24)
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            (work / job_id).mkdir()
            with patch.object(api, "JOBS_DIR", work), patch.object(api, "MAX_ACTIVE_UPLOADS", 1), \
                 patch.object(api, "request_limiter", RequestLimiter()), \
                 patch.dict(api.jobs, {job_id: {"owner": owner, "id": job_id,
                    "status": "uploaded", "media": media}}, clear=True), \
                 patch.object(api.pipeline, "probe", return_value=SimpleNamespace(**media)), \
                 patch.object(api.pipeline, "audio_waveform", return_value=[0]):
                with TestClient(api.app, cookies={COOKIE: token}) as client:
                    response = client.post(f"/api/jobs/{job_id}/presenter?filename=camera.mp4", content=b"fixture")
                self.assertEqual(response.status_code, 200, response.text)
                self.assertTrue((work / job_id / "presenter.mp4").exists())
                self.assertFalse(api.active_uploads)

    def test_integration_429_has_retry_after(self):
        limiter = RequestLimiter()
        owner, token = create_session()
        with patch.object(api, "request_limiter", limiter), patch.dict(
            "os.environ", {
                "FREEEDIT_UPLOADS_PER_SESSION_10M":"1",
                "FREEEDIT_UPLOADS_PER_PEER_10M":"2"
            }
        ):
            with TestClient(api.app, cookies={COOKIE:token}) as client:
                self.assertNotEqual(client.post("/api/upload?filename=sample.txt", content=b"").status_code,429)
                response = client.post("/api/upload?filename=sample.txt",content=b"")
                self.assertEqual(response.status_code,429)
                self.assertGreaterEqual(int(response.headers["Retry-After"]),1)


if __name__=="__main__":
    unittest.main()
