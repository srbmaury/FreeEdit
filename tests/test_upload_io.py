"""Slow upload disks must not stall the API or strand failed uploads."""
import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend import app as api


class UploadIOTests(unittest.IsolatedAsyncioTestCase):
    async def test_disk_write_does_not_block_event_loop(self):
        entered, release = threading.Event(), threading.Event()
        original = api._write_upload_chunk

        def slow_write(*args):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("Event loop was blocked by disk IO")
            original(*args)

        async def stream():
            yield b"fixture"

        media = SimpleNamespace(duration=1, has_audio=False, has_video=True, width=320, height=180)
        request = SimpleNamespace(stream=stream, state=SimpleNamespace(owner="test"))
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(api, "JOBS_DIR", Path(folder)), \
             patch.object(api, "_write_upload_chunk", slow_write), \
             patch.object(api.pipeline, "probe", return_value=media), \
             patch.dict(api.jobs, {}, clear=True), patch.object(api, "active_uploads", set()):
            task = asyncio.create_task(api._receive_upload(request, "sample.mp4"))
            try:
                async with asyncio.timeout(2):
                    while not entered.is_set():
                        await asyncio.sleep(.01)
                # Only the event loop can release this writer before its deadline.
                release.set()
                result = await task
                self.assertTrue((Path(folder) / result["id"] / "source.mp4").exists())
                self.assertFalse(api.active_uploads)
            finally:
                release.set()
                if not task.done():
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    async def test_unexpected_probe_failure_cleans_file_and_reservation(self):
        async def stream():
            yield b"fixture"

        request = SimpleNamespace(stream=stream, state=SimpleNamespace(owner="test"))
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(api, "JOBS_DIR", Path(folder)), \
             patch.object(api.pipeline, "probe", side_effect=RuntimeError("broken decoder")), \
             patch.object(api, "active_uploads", set()):
            with self.assertRaisesRegex(RuntimeError, "broken decoder"):
                await api._receive_upload(request, "sample.mp4")
            self.assertEqual(list(Path(folder).iterdir()), [])
            self.assertFalse(api.active_uploads)

    async def test_disconnect_and_size_limit_remove_partial_files(self):
        async def interrupted():
            yield b"partial recording"
            raise ConnectionError("client disconnected")

        async def oversized():
            yield b"too large"

        for stream, error in ((interrupted, ConnectionError), (oversized, api.HTTPException)):
            request = SimpleNamespace(stream=stream, state=SimpleNamespace(owner="test"))
            with tempfile.TemporaryDirectory() as folder, \
                 patch.object(api, "JOBS_DIR", Path(folder)), \
                 patch.object(api, "MAX_UPLOAD_MB", 0 if stream is oversized else 1), \
                 patch.object(api, "active_uploads", set()):
                with self.assertRaises(error):
                    await api._receive_upload(request, "sample.mp4")
                self.assertEqual(list(Path(folder).iterdir()), [])
                self.assertFalse(api.active_uploads)
