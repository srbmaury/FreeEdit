"""The first appended clip must create exactly one transition."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from backend import app as api


class SequenceAppendTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_append_uses_one_transition(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'main').mkdir();(root/'temp').mkdir()
            (root/'main'/'source.mp4').write_bytes(b'main')
            (root/'temp'/'source.mp4').write_bytes(b'clip')
            media=dict(duration=2,has_video=True,has_audio=False,width=160,height=90,frame_rate=30,audio_channels=0)
            job=dict(filename='main.mp4',media=media)
            def rebuild(work,clips,transitions):
                self.assertEqual(len(clips),2)
                self.assertEqual(transitions,[dict(type='cut',duration=0)])
                return {**media,'duration':4}
            with patch.object(api,'JOBS_DIR',root),patch.object(api,'_job',return_value=job), \
                 patch.dict(api.jobs,{'main':job},clear=True),patch.object(api,'active_uploads',set()), \
                 patch.object(api,'job_controls',{}),patch.object(api,'_persist_job'), \
                 patch.object(api,'_receive_upload',AsyncMock(return_value={'id':'temp',**media})), \
                 patch.object(api.clip_sequence,'rebuild',side_effect=rebuild):
                result=await api.add_sequence_clip('main',None,'clip.mp4')
            self.assertEqual(result['duration'],4)
