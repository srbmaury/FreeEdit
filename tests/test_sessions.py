"""Anonymous-session access control regression checks (no media dependencies)."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import app as api
from backend.sessions import COOKIE, create_session, verify_session


class SessionTests(unittest.TestCase):
    def test_signature_cannot_be_forged(self):
        owner, token = create_session()
        self.assertEqual(verify_session(token), owner)
        self.assertIsNone(verify_session(token[:-1] + ("0" if token[-1] != "0" else "1")))
        self.assertIsNone(verify_session("invalid"))

    def test_other_session_cannot_read_or_delete_job(self):
        job_id = "123abc456def"
        owner, token = create_session()
        with patch.dict(api.jobs, {job_id: {
            "id": job_id, "status": "uploaded", "owner": owner, "updated_at": 0,
            "filename": "demo.mp4", "output": None, "media": {"has_video": True}
        }}, clear=True):
            with TestClient(api.app) as other:
                self.assertEqual(other.get(f"/api/jobs/{job_id}").status_code, 404)
                self.assertEqual(other.delete(f"/api/jobs/{job_id}").status_code, 404)
                self.assertEqual(other.get(f"/api/jobs/{job_id}/source").status_code, 404)
                self.assertEqual(other.get(f"/api/jobs/{job_id}/result").status_code, 404)
            with TestClient(api.app, cookies={COOKIE: token}) as same:
                response = same.get(f"/api/jobs/{job_id}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["id"], job_id)

    def test_cross_origin_modification_is_rejected(self):
        with TestClient(api.app) as client:
            response = client.post(
                "/api/storage/cleanup?keep=none",
                headers={"Origin": "https://untrusted.example"},
            )
            self.assertEqual(response.status_code, 403)

    def test_owner_not_exposed_in_job_status(self):
        owner, token = create_session()
        job_id = "abcdef123456"
        with patch.dict(api.jobs, {job_id: {
            "id": job_id, "owner": owner, "status": "uploaded",
        }}, clear=True):
            with TestClient(api.app, cookies={COOKIE: token}) as client:
                response = client.get(f"/api/jobs/{job_id}")
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("owner", response.json())

    def test_storage_cleanup_only_deletes_own_jobs(self):
        a, cookie_a = create_session()
        b, cookie_b = create_session()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for job_id in ("111111111111", "222222222222"):
                directory = root / job_id
                directory.mkdir()
                (directory / "source.mp4").write_bytes(b"temporary")
            with patch.object(api, "JOBS_DIR", root), patch.dict(api.jobs, {
                "111111111111": {"id": "111111111111", "status": "uploaded", "owner": a},
                "222222222222": {"id": "222222222222", "status": "uploaded", "owner": b}
            }, clear=True):
                with TestClient(api.app, cookies={COOKIE: cookie_a}) as client:
                    seen = client.get("/api/storage")
                    self.assertEqual(seen.status_code, 200)
                    self.assertEqual(seen.json()["files"], 1)
                    cleaned = client.post("/api/storage/cleanup?keep=nonexistent")
                    self.assertEqual(cleaned.status_code, 200)
                    self.assertFalse((root / "111111111111").exists())
                    self.assertTrue((root / "222222222222").exists())


if __name__ == "__main__":
    unittest.main()
