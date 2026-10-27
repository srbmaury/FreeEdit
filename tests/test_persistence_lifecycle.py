"""Persistence failures and slow disks must not strand or freeze jobs."""
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import app as api
from backend.execution import JobControl
from backend.models import ProcessRequest


class PersistenceLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.job_id = "123456abcdef"
        (self.root / self.job_id).mkdir()
        self.job = {"id": self.job_id, "status": "queued", "updated_at": time.time(),
                    "media": {"duration": 1, "has_audio": True, "has_video": False}}
        for patcher in (patch.object(api, "JOBS_DIR", self.root),
                        patch.dict(api.jobs, {self.job_id: self.job}, clear=True),
                        patch.dict(api.job_controls, {}, clear=True),
                        patch.dict(api.job_futures, {}, clear=True)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_worker_disk_failure_is_terminal_and_retryable_even_if_error_save_fails(self):
        control = JobControl()
        api.job_controls[self.job_id] = control
        with patch.object(api, "_persist_job", side_effect=OSError("disk full")):
            api._execute(api._run, self.job_id, ProcessRequest(),
                         {"queued_at": time.time()}, control)
        self.assertEqual(self.job["status"], "error")
        self.assertNotIn(self.job_id, api.job_controls)
        with patch.object(api, "_persist_job"), patch.object(api.executor, "submit") as submit:
            self.assertTrue(api._submit(self.job_id, ProcessRequest(), api._run)["ok"])
            submit.assert_called_once()

    def test_cancelled_job_remains_terminal_when_metadata_save_fails(self):
        control = JobControl()
        control.cancel()
        api.job_controls[self.job_id] = control
        with patch.object(api, "_persist_job", side_effect=OSError("disk full")):
            api._execute(api._run, self.job_id, ProcessRequest(), {}, control)
        self.assertEqual(self.job["status"], "cancelled")
        self.assertNotIn(self.job_id, api.job_controls)

    def test_admission_disk_failure_rolls_back_and_returns_503(self):
        self.job["status"] = "uploaded"
        with patch.object(api, "_persist_job", side_effect=OSError("disk full")), \
             patch.object(api.executor, "submit") as submit:
            with self.assertRaises(api.HTTPException) as raised:
                api._submit(self.job_id, ProcessRequest(), api._run)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(self.job["status"], "uploaded")
        self.assertNotIn(self.job_id, api.job_controls)
        submit.assert_not_called()

    def test_slow_writer_releases_registry_lock_and_later_writer_saves_latest_state(self):
        entered, release, acquired = threading.Event(), threading.Event(), threading.Event()
        snapshots, errors = [], []

        def save(snapshot):
            snapshots.append(snapshot)
            if len(snapshots) == 1:
                entered.set()
                if not release.wait(3):
                    raise RuntimeError("writer timed out")

        def persist():
            try:
                api._persist_job(self.job)
            except Exception as exc:
                errors.append(exc)

        def mutate():
            with api.jobs_lock:
                self.job["stage"] = "newer"
            acquired.set()

        with patch.object(api.JobStore, "save", side_effect=save):
            first = threading.Thread(target=persist)
            first.start()
            second = None
            mutation = None
            try:
                self.assertTrue(entered.wait(1))
                mutation = threading.Thread(target=mutate)
                mutation.start()
                self.assertTrue(acquired.wait(1), "disk IO must not hold jobs_lock")
                second = threading.Thread(target=persist)
                second.start()
            finally:
                release.set()
                first.join(4)
                if mutation:
                    mutation.join(4)
                if second:
                    second.join(4)
        self.assertFalse(errors)
        self.assertNotIn("stage", snapshots[0])
        self.assertEqual(snapshots[-1]["stage"], "newer")
