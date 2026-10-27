"""Real FFmpeg tests of audio, cuts, timed Reframe, short output previews.

All assets are synthetic and generated on the runner, never user recordings.
"""
import shutil
import subprocess
import tempfile
import unittest
import math
import struct
from pathlib import Path
from unittest.mock import patch

from backend import pipeline, rendering


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),
                     "FFmpeg and FFprobe required")
class RealMediaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "input.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=18:duration=4",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=4:sample_rate=48000",
            "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1",
            "-c:a", "aac", "-shortest", str(self.source),
        ], check=True, capture_output=True)

    @staticmethod
    def settings():
        return {
            "denoise": False, "atten_lim": None, "preset": "balanced",
            "edits": [{"type":"hide","style":"black","x":8,"y":8,"w":20,"h":20,"start":.5,"end":3}],
            "cuts": [{"start":1.5,"end":1.8}],
            "audio": {"level_speech":True,"fade_in":.3,"fade_out":.3},
            "background": None, "presenter": None,
            "reframe": {
                "aspect":"original","zoom":1,"focus_x":.5,"focus_y":.5,
                "sections":[{"start":1.2,"end":2.5,"zoom":1.7,
                             "focus_x":.6,"focus_y":.4,"transition":.2}],
            },
        }

    def test_full_export_keeps_audio_and_correct_cut_duration(self):
        work = self.root / "full"
        work.mkdir()
        out = rendering.render(self.source,work,self.settings(),lambda *_:None)
        info = pipeline.probe(out)
        self.assertTrue(info.has_video)
        self.assertTrue(info.has_audio)
        self.assertEqual((info.width,info.height),(160,90))
        self.assertAlmostEqual(info.duration,3.7,delta=.2)

    def test_selected_preview_matches_retained_range_and_audio(self):
        work = self.root / "preview"
        work.mkdir()
        output,ranges = rendering.preview(
            self.source,None,work,self.settings(),1,3,4,lambda *_:None)
        media = pipeline.probe(output)
        self.assertTrue(media.has_video)
        self.assertTrue(media.has_audio)
        self.assertEqual(ranges,[(1,1.5),(1.8,3)])
        self.assertAlmostEqual(media.duration,1.7,delta=.25)

    def test_audio_only_leveling_and_fades(self):
        work=self.root/"audio"
        work.mkdir()
        out=pipeline.process(self.source,work,denoise_audio=False,atten_lim=None,
            edits=[],cuts=[{"start":1,"end":1.4}],progress=lambda *_:None,
            preset="audio_only",
            audio={"level_speech":True,"fade_in":.3,"fade_out":.3})
        info=pipeline.probe(out)
        self.assertFalse(info.has_video)
        self.assertTrue(info.has_audio)
        self.assertAlmostEqual(info.duration,3.6,delta=.2)

    def test_preview_audio_uses_full_export_fade_clock_after_cuts(self):
        source=self.root/"tone.wav"
        subprocess.run(["ffmpeg","-v","error","-y","-f","lavfi","-i",
            "sine=frequency=440:sample_rate=48000:duration=4",str(source)],
            check=True,capture_output=True)
        settings=dict(denoise=False,atten_lim=None,preset="audio_only",edits=[],
            cuts=[dict(start=1,end=1.5)],audio=dict(fade_in=.5,fade_out=.5))
        full=self.root/"audio-full"; full.mkdir()
        output=rendering.render(source,full,settings,lambda *_:None)

        def rms(path,time):
            raw=subprocess.run(["ffmpeg","-v","error","-ss",str(time),"-i",str(path),
                "-t","0.05","-ac","1","-ar","48000","-f","s16le","-"],
                check=True,capture_output=True).stdout
            samples=struct.unpack('<'+'h'*(len(raw)//2),raw)
            return math.sqrt(sum(value*value for value in samples)/len(samples))

        steady=rms(output,1)
        self.assertGreater(steady,1000)
        self.assertLess(rms(output,.0625),steady*.35)
        self.assertLess(rms(output,3.4),steady*.35)
        for start in (0,2.5):
            work=self.root/('audio-preview-'+str(start)); work.mkdir()
            end=1 if start==0 else 4
            sample,_=rendering.preview(source,None,work,settings,start,end,4,lambda *_:None)
            for local_time in (.125,.625) if start==0 else (.125,1.25):
                with self.subTest(start=start,time=local_time):
                    full_time=start+local_time-(.5 if start>1 else 0)
                    self.assertAlmostEqual(rms(sample,local_time),rms(output,full_time),delta=steady*.08)


    def test_irregular_frame_timing_with_cut_and_reframe(self):
        """Synthetic VFR-like clip simulates dropped screen-recording frames."""
        source = self.root / "irregular.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=4",
            "-f", "lavfi", "-i", "sine=frequency=360:sample_rate=48000:duration=4",
            "-vf", "select='not(mod(n,3))+eq(mod(n,7),0)',setpts=PTS-STARTPTS",
            "-fps_mode", "vfr", "-c:v", "libx264", "-preset", "ultrafast",
            "-threads", "1", "-c:a", "aac", "-t", "4", str(source),
        ], check=True, capture_output=True)
        work = self.root / "irregular-render"
        work.mkdir()
        output = pipeline.process(source, work, denoise_audio=False, atten_lim=None,
            edits=[], cuts=[{"start":1,"end":1.25}], progress=lambda *_:None,
            reframe={"aspect":"original","zoom":1,"focus_x":.5,"focus_y":.5,
                "sections":[{"start":.5,"end":2.6,"zoom":1.5,
                             "focus_x":.55,"focus_y":.45,"transition":.3}]},
            audio={"level_speech":False,"fade_in":.1,"fade_out":.1})
        result = pipeline.probe(output)
        self.assertTrue(result.has_video)
        self.assertTrue(result.has_audio)
        self.assertGreater(result.duration,3.3)
        self.assertLess(result.duration,4.1)

    def test_one_hundred_cuts_do_not_exceed_expression_parser_depth(self):
        source = self.root / "dense.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
            "testsrc2=size=32x32:rate=25:duration=120", "-f", "lavfi", "-i",
            "sine=frequency=440:duration=120", "-c:v", "libx264", "-preset",
            "ultrafast", "-threads", "1", "-c:a", "aac", str(source),
        ], check=True, capture_output=True)
        work = self.root / "dense"
        work.mkdir()
        output = pipeline.process(source, work, denoise_audio=False, atten_lim=None,
            edits=[], cuts=[{"start": i + .2, "end": i + .4} for i in range(100)],
            progress=lambda *_: None)
        info = pipeline.probe(output)
        self.assertTrue(info.has_audio and info.has_video)
        self.assertAlmostEqual(info.duration, 100, delta=.15)

    def test_background_compositing_works_with_synthetic_person_mask(self):
        """Exercises real background FFmpeg filters, without loading ML weights."""
        work = self.root / "background"
        work.mkdir()
        mask = work / "person-mask.mkv"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=c=white:s=160x90:r=18:d=4",
            "-vf", "format=gray", "-c:v", "ffv1", "-threads", "1",
            str(mask),
        ], check=True, capture_output=True)
        with patch("backend.background.create_mask", return_value=mask):
            out = pipeline.process(
                self.source, work, denoise_audio=False, atten_lim=None,
                edits=[], cuts=[], progress=lambda *_:None,
                background={"mode":"color","color":"#112233","blur":16},
                preset="small")
        media = pipeline.probe(out)
        self.assertTrue(media.has_video)
        self.assertTrue(media.has_audio)
        self.assertAlmostEqual(media.duration,4,delta=.25)

    def test_background_replacement_uses_mask_for_color_planes(self):
        work=self.root/'background-color'; work.mkdir()
        mask=work/'person-mask.mkv'
        subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',
            'color=black:size=160x90:rate=18:duration=4','-vf','format=gray',
            '-c:v','ffv1','-threads','1',str(mask)],check=True,capture_output=True)
        with patch('backend.background.create_mask',return_value=mask):
            output=pipeline.process(self.source,work,denoise_audio=False,atten_lim=None,
                edits=[],cuts=[],progress=lambda *_:None,
                background=dict(mode='color',color='#00ff00'),preset='high')
        raw=subprocess.run(['ffmpeg','-v','error','-i',str(output),'-frames:v','1',
            '-pix_fmt','rgb24','-f','rawvideo','-'],check=True,capture_output=True).stdout
        red,green,blue=raw[(40*160+80)*3:(40*160+80)*3+3]
        self.assertGreater(green,220)
        self.assertLess(max(red,blue),30)


if __name__=="__main__":
    unittest.main()
