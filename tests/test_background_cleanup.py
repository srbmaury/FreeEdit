"""Failed and cancelled segmentation must not retain partial mask files."""
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from backend import background, pipeline
from backend.execution import Cancelled


class BackgroundCleanupTests(unittest.TestCase):
    def test_failure_and_cancellation_remove_partial_artifacts(self):
        for outcome in (Cancelled(), subprocess.TimeoutExpired('worker', 1),
                        SimpleNamespace(returncode=1, stderr='worker failed'),
                        SimpleNamespace(returncode=0, stdout='{"person_detected": false}')):
            with self.subTest(outcome=type(outcome).__name__), tempfile.TemporaryDirectory() as folder:
                work = Path(folder)
                info = SimpleNamespace(duration=2, width=320, height=180)

                def worker(*args, **kwargs):
                    (work / 'person-mask.mkv').write_bytes(b'partial-mask')
                    if isinstance(outcome, BaseException):
                        raise outcome
                    return outcome

                with patch.object(background, 'ensure_model', return_value=work/'model'), \
                     patch('backend.execution.run_process', side_effect=worker):
                    with self.assertRaises((Cancelled, pipeline.PipelineError)):
                        background.create_mask(work/'source.mp4', work, info, {}, lambda *_: None)
                self.assertFalse((work/'person-mask.mkv').exists())
                self.assertFalse((work/'background-worker.json').exists())


if __name__ == '__main__':
    unittest.main()
