"""FFmpeg composition integration tests with generated, non-user recordings.

Run with: python -m unittest discover -s tests -v
"""
import json
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave
import array
from pathlib import Path

from backend.composition import compose
from backend import pipeline, rendering


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),
                     "FFmpeg and FFprobe are required")
class CompositionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.main = cls.root / "main.mp4"
        cls.presenter = cls.root / "presenter.mp4"
        cls.silent_main = cls.root / "silent_main.mp4"
        cls.make_clip(cls.main, "blue", 4, with_audio=True, size="128x72", tone=440)
        cls.make_clip(cls.presenter, "red", 2, with_audio=True, size="64x48", tone=880)
        cls.make_clip(cls.silent_main, "blue", 4, with_audio=False, size="128x72")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    @staticmethod
    def make_clip(path, color, seconds, *, with_audio, size, tone=440):
        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
               "-i", f"color=c={color}:s={size}:r=12:d={seconds}"]
        if with_audio:
            cmd += ["-f", "lavfi", "-i",
                    f"sine=frequency={tone}:sample_rate=48000:duration={seconds}"]
        cmd += ["-c:v", "libx264", "-preset", "ultrafast",
                "-threads", "1", "-pix_fmt", "yuv420p"]
        if with_audio:
            cmd += ["-c:a", "aac", "-shortest"]
        subprocess.run(cmd + [str(path)], check=True, capture_output=True, text=True)

    def compose_to(self, main=None, *, sound="both", offset=1, start=0, length=None):
        work = self.root / f"case-{self._testMethodName}-{sound}-{start}-{offset}"
        work.mkdir(exist_ok=True)
        settings = {"box": {"x": 24, "y": 16, "w": 48, "h": 32},
                    "offset": offset, "trim_start": 0, "trim_end": 2,
                    "effect": "original", "sound": sound,
                    "main_volume": 1, "presenter_volume": 1}
        return compose(main or self.main, self.presenter, work, settings,
                       lambda stage, fraction: None, start=start, length=length)

    @staticmethod
    def metadata(path):
        raw = subprocess.check_output(
            ["ffprobe", "-v", "error", "-of", "json",
             "-show_streams", "-show_format", str(path)])
        return json.loads(raw)

    @staticmethod
    def sample_pixel(path, second, x=35, y=25):
        frame = subprocess.check_output(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(second),
             "-i", str(path), "-frames:v", "1", "-f", "rawvideo",
             "-pix_fmt", "rgb24", "pipe:1"])
        position = (y * 128 + x) * 3
        return frame[position:position + 3]

    def test_presenter_appears_only_during_its_interval(self):
        output = self.compose_to()
        meta = self.metadata(output)
        self.assertAlmostEqual(float(meta["format"]["duration"]), 4, delta=.15)
        self.assertEqual({s["codec_type"] for s in meta["streams"]}, {"audio", "video"})
        before = self.sample_pixel(output, .4)
        during = self.sample_pixel(output, 1.5)
        after = self.sample_pixel(output, 3.4)
        self.assertGreater(before[2], before[0] + 70, before)
        self.assertGreater(during[0], during[2] + 70, during)
        self.assertGreater(after[2], after[0] + 70, after)

    def test_preview_seek_preserves_presenter_timing(self):
        output = self.compose_to(sound="presenter", start=1.5, length=2)
        self.assertAlmostEqual(float(self.metadata(output)["format"]["duration"]), 2, delta=.15)
        during = self.sample_pixel(output, .3)
        after = self.sample_pixel(output, 1.8)
        self.assertGreater(during[0], during[2] + 70, during)
        self.assertGreater(after[2], after[0] + 70, after)

    def test_nonoverlapping_presenter_only_preview_has_silent_audio(self):
        output = self.compose_to(sound="presenter", offset=2.5, length=1)
        self.assertEqual(
            {s["codec_type"] for s in self.metadata(output)["streams"]},
            {"audio", "video"})
        self.assertGreater(self.sample_pixel(output, .5)[2], 150)

    def test_presenter_audio_without_main_audio(self):
        output = self.compose_to(main=self.silent_main, sound="presenter")
        self.assertEqual(
            {s["codec_type"] for s in self.metadata(output)["streams"]},
            {"audio", "video"})

    def test_audio_only_presenter_effects_never_run_segmentation(self):
        for sound in ("main", "presenter", "both"):
            with self.subTest(sound=sound), tempfile.TemporaryDirectory() as folder:
                work = Path(folder)
                settings = {"denoise": False, "atten_lim": None, "preset": "audio_only",
                    "edits": [], "cuts": [{"start": 3, "end": 3.5}],
                    "audio": {"level_speech": True, "fade_in": .1, "fade_out": .1},
                    "presenter": {"box": {"x": 0, "y": 0, "w": 64, "h": 48},
                        "offset": 1, "trim_start": 0, "trim_end": 2,
                        "effect": "blur", "sound": sound, "main_volume": .5, "presenter_volume": .5}}
                with patch("backend.composition.create_mask", side_effect=AssertionError("no segmentation")), \
                     patch("backend.background.create_mask", side_effect=AssertionError("no segmentation")), \
                     patch("backend.composition.compose", side_effect=AssertionError("no video composition")):
                    output = rendering.render(self.main, work, settings, lambda *_: None, self.presenter)
                info = pipeline.probe(output)
                self.assertFalse(info.has_video)
                self.assertTrue(info.has_audio)
                self.assertAlmostEqual(info.duration, 3.5, delta=.05)
                self.assertFalse((work / "composition").exists())
                if sound == "presenter":
                    with wave.open(str(output)) as audio:
                        audio.setpos(int(.2 * audio.getframerate()))
                        samples = array.array("h", audio.readframes(int(.2 * audio.getframerate())))
                        self.assertLess(max(map(abs, samples)), 8)
                        audio.setpos(int(1.2 * audio.getframerate()))
                        samples = array.array("h", audio.readframes(int(.2 * audio.getframerate())))
                        self.assertGreater(max(map(abs, samples)), 100)

    def test_muted_export_has_no_audio_track(self):
        output = self.compose_to(sound="muted")
        self.assertEqual(
            [s["codec_type"] for s in self.metadata(output)["streams"]], ["video"])


if __name__ == "__main__":
    unittest.main()
