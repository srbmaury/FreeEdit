"""Active reads extend retention without letting unauthorized sessions touch jobs."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
from fastapi.testclient import TestClient
from backend import app as api
from backend.sessions import COOKIE, create_session
from backend.models import ProcessRequest, ResultPreviewRequest


class ActivityTests(unittest.TestCase):
    def test_active_media_survives_cleanup_but_idle_job_expires(self):
        owner, token = create_session()
        active, idle = '111111111111', '222222222222'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in (active, idle):
                (root/name).mkdir()
                (root/name/'source.wav').write_bytes(b'fixture')
            jobs = {name: {'id': name, 'owner': owner, 'status': 'uploaded', 'updated_at': 0}
                    for name in (active, idle)}
            with patch.object(api, 'JOBS_DIR', root), patch.object(api, 'JOB_TTL_HOURS', 1), \
                 patch.dict(api.jobs, jobs, clear=True), patch('backend.app.time.time', return_value=10000):
                client = TestClient(api.app, cookies={COOKIE: token})
                try:
                    response = client.get(f'/api/jobs/{active}/source', headers={'Range': 'bytes=0-0'})
                    self.assertEqual(response.status_code, 206)
                    self.assertEqual(api.jobs[active]['updated_at'], 10000)
                    api._cleanup_old_jobs()
                    self.assertTrue((root/active).exists())
                    self.assertFalse((root/idle).exists())
                finally:
                    client.close()

    def test_export_admission_returns_identity_retained_in_job(self):
        job_id = '444444444444'
        job = {'id': job_id, 'status': 'uploaded', 'media': {'duration': 4,
               'has_video': True, 'has_audio': True, 'width': 320, 'height': 180}}
        executor = Mock()
        with patch.dict(api.jobs, {job_id: job}, clear=True), \
             patch.dict(api.job_controls, {}, clear=True), patch.dict(api.job_futures, {}, clear=True), \
             patch.object(api, 'executor', executor):
            result = api._submit(job_id, ProcessRequest(denoise=False), api._run)
            self.assertEqual(result['submission_id'], api.jobs[job_id]['export_submission_id'])
            self.assertEqual(len(result['submission_id']), 32)
            executor.submit.assert_called_once()

    def test_preview_admission_has_independent_identity(self):
        job_id = '666666666666'
        job = {'id': job_id, 'status': 'uploaded', 'export_submission_id': 'old-export',
               'media': {'duration': 4, 'has_video': True, 'has_audio': True, 'width': 320, 'height': 180}}
        executor = Mock()
        with patch.dict(api.jobs, {job_id: job}, clear=True), \
             patch.dict(api.job_controls, {}, clear=True), patch.dict(api.job_futures, {}, clear=True), \
             patch.object(api, 'executor', executor):
            result = api._submit(job_id, ResultPreviewRequest(denoise=False, start=0, end=2), api._preview_result)
            self.assertEqual(result['submission_id'], job['result_preview_submission_id'])
            self.assertEqual(len(result['submission_id']), 32)
            self.assertEqual(job['export_submission_id'], 'old-export')

    def test_failed_admission_does_not_leave_an_export_identity(self):
        job_id = '555555555555'
        job = {'id': job_id, 'status': 'uploaded', 'media': {'duration': 4,
               'has_video': True, 'has_audio': True, 'width': 320, 'height': 180}}
        executor = Mock()
        executor.submit.side_effect = RuntimeError('executor stopped')
        with patch.dict(api.jobs, {job_id: job}, clear=True), \
             patch.dict(api.job_controls, {}, clear=True), patch.object(api, 'executor', executor):
            with self.assertRaises(api.HTTPException) as raised:
                api._submit(job_id, ProcessRequest(denoise=False), api._run)
            self.assertEqual(raised.exception.status_code, 503)
            self.assertNotIn('export_submission_id', job)
            self.assertNotIn(job_id, api.job_controls)
            self.assertEqual(job['status'], 'uploaded')

    def test_unauthorized_read_does_not_extend_retention(self):
        owner, _ = create_session()
        job_id = '333333333333'
        with patch.dict(api.jobs, {job_id: {'id': job_id, 'owner': owner, 'updated_at': 0}}, clear=True):
            client = TestClient(api.app)
            try:
                self.assertEqual(client.get(f'/api/jobs/{job_id}').status_code, 404)
                self.assertEqual(api.jobs[job_id]['updated_at'], 0)
            finally:
                client.close()

class UploadReservationTests(unittest.TestCase):
    def test_directory_creation_failure_releases_upload_slot(self):
        import asyncio
        from types import SimpleNamespace
        request = SimpleNamespace(state=SimpleNamespace(owner='test'))
        with patch.object(api, 'active_uploads', set()), \
             patch.object(api.Path, 'mkdir', side_effect=OSError('disk full')):
            for _ in range(api.MAX_ACTIVE_UPLOADS + 1):
                with self.assertRaises(OSError):
                    asyncio.run(api._receive_upload(request, 'sample.mp4'))
                self.assertEqual(api.active_uploads, set())

class RetainedResultTests(unittest.TestCase):
    def test_existing_download_survives_preview_operations_but_not_replacement_export(self):
        owner, token = create_session()
        job_id = '777777777777'
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/job_id).mkdir()
            (root/job_id/'output.mp4').write_bytes(b'completed export')
            job = {'id':job_id, 'owner':owner, 'status':'done', 'operation':'export',
                   'filename':'clip.mp4', 'output':'output.mp4'}
            with patch.object(api,'JOBS_DIR',root), patch.dict(api.jobs,{job_id:job},clear=True):
                client = TestClient(api.app,cookies={COOKIE:token})
                try:
                    for operation in ('result-preview','preview','background','composition','silence'):
                        job.update(status='processing',operation=operation)
                        response=client.get(f'/api/jobs/{job_id}/result?download=1')
                        self.assertEqual(response.status_code,200,operation)
                        self.assertEqual(response.content,b'completed export')
                    for status in ('queued','processing','cancelling'):
                        job.update(status=status,operation='export')
                        self.assertEqual(client.get(f'/api/jobs/{job_id}/result').status_code,400)
                finally:
                    client.close()
