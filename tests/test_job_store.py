"""Restart recovery must preserve ownership and never expose partial exports."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from backend.job_store import JobStore, InstanceLease
from backend.sessions import load_secret


class JobStoreTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.store = JobStore(self.root)
        self.work = self.root / "123456abcdef"
        self.work.mkdir()
        (self.work / "source.mp4").write_bytes(b"source")
        self.job = {"id": self.work.name, "owner": "a" * 48, "status": "uploaded",
                    "filename": "demo.mp4", "media": {"duration": 1, "has_video": True},
                    "output": None, "updated_at": time.time()}

    def restore(self):
        return self.store.restore(ttl_hours=1)

    def test_completed_result_and_submission_identity_survive(self):
        (self.work / "output.mp4").write_bytes(b"complete")
        self.job.update(status="done", output="output.mp4", export_submission_id="submission")
        self.store.save(self.job)
        self.assertEqual(self.restore()[self.job["id"]], self.job)

    def test_interrupted_export_requires_retry_and_removes_partial_result(self):
        for status in ("queued", "processing", "cancelling"):
            self.job.update(status=status, operation="export", output="output.mp4")
            (self.work / "output.mp4").write_bytes(b"incomplete")
            self.store.save(self.job)
            recovered = self.restore()[self.job["id"]]
            self.assertEqual(recovered["status"], "error")
            self.assertEqual(recovered["error_code"], "server_restarted")
            self.assertIsNone(recovered["output"])
            self.assertFalse((self.work / "output.mp4").exists())
            self.assertTrue((self.work / "source.mp4").exists())

    def test_interrupted_preview_keeps_previous_completed_export(self):
        (self.work / "output.mp4").write_bytes(b"complete")
        self.job.update(status="processing", operation="result-preview", output="output.mp4",
                        result_preview={"file": "output.mp4"})
        self.store.save(self.job)
        recovered = self.restore()[self.job["id"]]
        self.assertEqual(recovered["output"], "output.mp4")
        self.assertIsNone(recovered["result_preview"])
        self.assertEqual((self.work / "output.mp4").read_bytes(), b"complete")

    def test_failed_replace_preserves_previous_manifest_and_removes_temporary(self):
        self.store.save(self.job)
        self.job["filename"] = "changed.mp4"
        with patch.object(Path, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.store.save(self.job)
        self.assertEqual(self.restore()[self.job["id"]]["filename"], "demo.mp4")
        self.assertFalse(list(self.work.glob(".metadata-*")))

    def test_missing_output_is_not_advertised_as_done(self):
        self.job.update(status="done", output="output.mp4")
        self.store.save(self.job)
        recovered = self.restore()[self.job["id"]]
        self.assertEqual(recovered["status"], "uploaded")
        self.assertIsNone(recovered["output"])

    def test_expired_unowned_corrupt_and_unsafe_metadata_are_skipped(self):
        for changes in ({"updated_at": time.time() - 7200}, {"owner": ""},
                        {"output": "../../secret"}, {"updated_at": float("inf")}):
            job = {**self.job, **changes}
            (self.work / "job.json").write_text(json.dumps({"version": 1, "job": job}))
            self.assertEqual(self.restore(), {})
        (self.work / "job.json").write_text("broken")
        self.assertEqual(self.restore(), {})
        (self.work / "job.json").unlink()
        self.assertEqual(self.restore(), {})

    def test_instance_lock_is_exclusive_and_released(self):
        first, second = InstanceLease(self.root), InstanceLease(self.root)
        first.acquire()
        try:
            with self.assertRaisesRegex(RuntimeError, "Another FreeEdit"):
                second.acquire()
        finally:
            first.release()
        second.acquire()
        second.release()

    def test_session_key_is_private_and_stable_without_environment_override(self):
        with patch.dict(os.environ, {}, clear=True):
            first = load_secret(self.root)
            self.assertEqual(first, load_secret(self.root))
            self.assertEqual(len(first), 32)
            self.assertEqual((self.root / ".session-secret").stat().st_mode & 0o777, 0o600)
            (self.root / ".session-secret").write_bytes(b"corrupted")
            with self.assertRaisesRegex(RuntimeError, "Invalid persisted"):
                load_secret(self.root)


class RestartIntegrationTests(unittest.TestCase):
    def test_new_process_restores_recording_result_and_session_isolation(self):
        script = '''
import json, os
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import app as api
from backend.pipeline import MediaInfo
from backend.sessions import COOKIE
with TestClient(api.app) as client:
    if os.environ['PHASE'] == 'upload':
        media = MediaInfo(duration=1, has_video=True, has_audio=False, width=320, height=180)
        with patch.object(api.pipeline, 'probe', return_value=media):
            response = client.post('/api/upload?filename=demo.mp4', content=b'source')
        assert response.status_code == 200, response.text
        job = response.json()['id']
        (api.JOBS_DIR / job / 'output.mp4').write_bytes(b'complete')
        api._update(job, status='done', output='output.mp4', export_submission_id='retained-id')
        print(json.dumps({'job':job, 'cookie':client.cookies.get(COOKIE)}))
    else:
        job = os.environ['JOB']
        assert client.get(f'/api/jobs/{job}').status_code == 404
        client.cookies.set(COOKIE, os.environ['TOKEN'])
        response = client.get(f'/api/jobs/{job}')
        assert response.status_code == 200, response.text
        assert response.json()['export_submission_id'] == 'retained-id'
        assert 'owner' not in response.json()
        assert client.get(f'/api/jobs/{job}/source').content == b'source'
        assert client.get(f'/api/jobs/{job}/result').content == b'complete'
        print(json.dumps({'restored':True}))
'''
        with tempfile.TemporaryDirectory() as folder:
            env = {**os.environ, "FREEEDIT_JOBS_DIR": folder, "PHASE": "upload"}
            env.pop("FREEEDIT_SESSION_SECRET", None)
            first = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True,
                                   text=True, timeout=20)
            self.assertEqual(first.returncode, 0, first.stderr)
            saved = json.loads(first.stdout)
            env.update(PHASE="restore", JOB=saved["job"], TOKEN=saved["cookie"])
            second = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True,
                                    text=True, timeout=20)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertTrue(json.loads(second.stdout)["restored"])
