"""The first appended clip must create exactly one transition."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from starlette.requests import Request
from backend import app as api


class SequenceAppendTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_append_uses_one_transition(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'main').mkdir();(root/'temp').mkdir()
            (root/'main'/'source.mp4').write_bytes(b'main')
            (root/'temp'/'source.mp4').write_bytes(b'clip')
            media=dict(duration=2,has_video=True,has_audio=False,width=160,height=90,frame_rate=30,audio_channels=0)
            job=dict(filename='main.mp4',media=media)
            def rebuild(work,clips,transitions,*,output):
                self.assertEqual(len(clips),2)
                self.assertEqual(transitions,[dict(type='cut',duration=0)])
                return {**media,'duration':4}
            with patch.object(api,'JOBS_DIR',root),patch.object(api,'_job',return_value=job), \
                 patch.dict(api.jobs,{'main':job},clear=True),patch.object(api,'active_uploads',set()), \
                 patch.object(api,'job_controls',{}),patch.object(api.JobStore,'save'), \
                 patch.object(api,'_receive_upload',AsyncMock(return_value={'id':'temp',**media})), \
                 patch.object(api.clip_sequence,'rebuild',side_effect=rebuild):
                result=await api.add_sequence_clip('main',Request({'type': 'http'}),'clip.mp4')
            self.assertEqual(result['duration'],4)


class SequenceMediaTests(unittest.TestCase):
    def test_matching_odd_clips_crossfade_and_recover_by_revision(self):
        import subprocess
        from fastapi.testclient import TestClient
        from backend import pipeline

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture = root / "odd.mp4"
            subprocess.run([
                pipeline.FFMPEG(), "-loglevel", "error", "-y", "-filter_threads", "1",
                "-f", "lavfi", "-i", "testsrc=size=161x91:rate=30:duration=2",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                "-c:v", "libx264", "-pix_fmt", "yuv444p", "-c:a", "aac", str(fixture),
            ], check=True)
            content = fixture.read_bytes()
            with patch.object(api, "JOBS_DIR", root):
                with TestClient(api.app, raise_server_exceptions=False) as client:
                    response = client.post("/api/upload?filename=first.mp4", content=content)
                    self.assertEqual(response.status_code, 200, response.text)
                    path = f"/api/jobs/{response.json()['id']}"
                    response = client.post(f"{path}/clips?filename=second.mp4", content=content)
                    self.assertEqual(response.status_code, 200, response.text)
                    pair = response.json()
                    self.assertEqual((pair["width"], pair["height"]), (162, 92))
                    cut = {"type": "cut", "duration": 0}
                    fade = {"type": "crossfade", "duration": .5}
                    order = [clip["id"] for clip in pair["clips"]]
                    response = client.put(f"{path}/clips/order", json={"order": order, "transitions": [fade]})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertAlmostEqual(response.json()["duration"], 3.5)
                    response = client.post(f"{path}/clips?filename=third.mp4", content=content)
                    self.assertEqual(response.status_code, 200, response.text)
                    triple = response.json()
                    order = [clip["id"] for clip in triple["clips"]]
                    for invalid in ({"order": [{}]}, {"order": order, "transitions": [None, cut]},
                                    {"order": order, "transitions": [{"type": []}, cut]}):
                        response = client.put(f"{path}/clips/order", json=invalid)
                        self.assertEqual(response.status_code, 422, response.text)
                    self.assertEqual(client.get(path).json()["sequence_revision"], triple["sequence_revision"])
                    stale = {"X-FreeEdit-Sequence-Revision": pair["sequence_revision"]}
                    response = client.put(f"{path}/clips/order", json={"order": order, "transitions": [cut, cut]},
                                          headers=stale)
                    self.assertEqual(response.status_code, 412, response.text)
                    response = client.post(f"{path}/clips?filename=stale.mp4", content=content, headers=stale)
                    self.assertEqual(response.status_code, 412, response.text)
                    response = client.post(f"{path}/process", json={"denoise": False}, headers=stale)
                    self.assertEqual(response.status_code, 412, response.text)
                    response = client.post(f"{path}/result-preview", json={"denoise": False, "start": 0, "end": 1},
                                           headers=stale)
                    self.assertEqual(response.status_code, 412, response.text)
                    for transitions in ([cut, fade], [fade, fade]):
                        response = client.put(f"{path}/clips/order", json={"order": order[::-1], "transitions": transitions})
                        self.assertEqual(response.status_code, 200, response.text)
                        final = response.json()
                        result = root / path.rsplit("/", 1)[-1] / f"sequence-{final['sequence_revision']}.mp4"
                        info = pipeline.probe(result)
                        self.assertTrue(info.has_audio)
                        self.assertAlmostEqual(info.duration, final["duration"], delta=.05)
                    cookie = client.cookies.get(api.COOKIE)
                with TestClient(api.app) as client:
                    client.cookies.set(api.COOKIE, cookie)
                    current = client.get(path).json()
                    self.assertEqual(current["sequence_revision"], final["sequence_revision"])
                    self.assertEqual(client.get(f"{path}/source", params={"revision": triple["sequence_revision"]}).status_code, 409)
                    self.assertEqual(client.head(f"{path}/source", params={"revision": final["sequence_revision"]}).status_code, 200)
