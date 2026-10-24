"""Regression checks for timed, smooth zoom sections.

Run: python -m unittest discover -s tests -v
Requires ffmpeg/ffprobe for the integration test.
"""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from backend import pipeline


class TimedReframeTests(unittest.TestCase):
    def setUp(self):
        self.settings = {"aspect": "wide", "zoom": 1, "focus_x": .5, "focus_y": .5,
                         "sections": [{"start": .6, "end": 2.4, "transition": .3,
                                       "zoom": 1.8, "focus_x": .7, "focus_y": .3}]}

    def test_geometry_even_and_inside_source(self):
        x, y, w, h = pipeline.reframe_geometry(1280, 720,
            {"aspect":"vertical", "zoom": 1, "focus_x": .5, "focus_y": .5})
        self.assertTrue(w < h)
        self.assertTrue(all(number % 2 == 0 for number in (x,y,w,h)))
        self.assertLessEqual(x+w,1280)
        self.assertLessEqual(y+h,720)

    def test_smoothstep_expression_has_both_boundary_weights(self):
        z = pipeline.reframe_expressions(self.settings["sections"], "z")
        self.assertIn("T-0.600", z)
        self.assertIn("2.400-T", z)
        self.assertIn("3-2*", z)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg unavailable")
    def test_animated_export_with_timed_sections(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            src, output = root / "source.mp4", root / "output.mp4"
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi",
                "-i","testsrc2=size=160x90:rate=24:duration=3",
                "-c:v","libx264","-preset","ultrafast","-threads","1",str(src)],
                check=True, capture_output=True)
            parts, video = pipeline.build_timed_reframe(
                "[0:v]", 160, 90, self.settings, 24)
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",
                "-i",str(src),"-filter_complex",";".join(parts),"-map",video,
                "-an","-c:v","libx264","-preset","ultrafast","-threads","1",str(output)],
                check=True,capture_output=True)
            info = pipeline.probe(output)
            self.assertTrue(info.has_video)
            self.assertEqual((info.width, info.height), (160,90))
            self.assertAlmostEqual(info.duration,3,delta=.2)


if __name__=="__main__":
    unittest.main()
