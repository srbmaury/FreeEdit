"""Exercise actual speed rendering, pitch, cut mapping and bounded previews."""
import array
import subprocess
import tempfile
import unittest
from pathlib import Path
from fastapi import HTTPException
from pydantic import ValidationError
from backend import pipeline, rendering
from backend.models import ProcessRequest, SpeedRegion


class SpeedTests(unittest.TestCase):
    def test_validation(self):
        for rate in (0, .2, 4.1, float('nan')):
            with self.assertRaises(ValidationError):
                SpeedRegion(start=0, end=1, rate=rate)
        for regions in ([dict(start=0,end=2,rate=2),dict(start=1,end=3,rate=.5)], [dict(start=0,end=5,rate=2)]):
            with self.assertRaises(HTTPException):
                ProcessRequest(speed_regions=regions).validate_media(dict(has_video=True,has_audio=True,duration=4))
        with self.assertRaises(ValidationError):
            ProcessRequest(speed_regions=[dict(start=0,end=1,rate=1)]*21)

    def test_silent_video_speed_preserves_visual_edit_timing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/'source.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=160x90:r=30:d=4',
                '-c:v','libx264','-preset','ultrafast',str(source)],check=True)
            settings=ProcessRequest(denoise=False,speed_regions=[dict(start=1,end=3,rate=4)],
                edits=[dict(type='hide',style='black',start=2,end=3,x=0,y=0,w=160,h=90)]).model_dump()
            work=root/'render';work.mkdir()
            output=rendering.render(source,work,settings,lambda *_:None)
            info=pipeline.probe(output)
            self.assertFalse(info.has_audio)
            self.assertAlmostEqual(info.duration,2.5,delta=.08)
            # A mask covering source [2,3] must appear on output [1.25,1.5].
            def pixel(t):
                return subprocess.check_output(['ffmpeg','-v','error','-ss',str(t),'-i',str(output),
                    '-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-'])
            self.assertLess(max(pixel(1.35)),12)
            self.assertGreater(pixel(1.7)[0],200)

    def test_audio_video_duration_pitch_and_preview(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/'source.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=30:d=4',
                '-f','lavfi','-i','sine=frequency=1000:duration=4:sample_rate=48000',
                '-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',str(source)],check=True)
            settings=ProcessRequest(denoise=False, speed_regions=[dict(start=1,end=3,rate=2)],
                cuts=[dict(start=2,end=2.5)]).model_dump()
            # Retained: [0,1] at 1x, [1,2] at 2x, [2.5,3] at 2x, [3,4] at 1x.
            for preset in ('small','audio_only'):
                settings['preset']=preset
                work=root/preset;work.mkdir()
                output=rendering.render(source,work,settings,lambda *_:None)
                self.assertAlmostEqual(pipeline.probe(output).duration,2.75,delta=.1)
                pcm=array.array('f');pcm.frombytes(subprocess.check_output(['ffmpeg','-v','error','-i',str(output),'-ac','1','-ar','48000','-f','f32le','-']))
                chunk=pcm[int(1.1*48000):int(1.4*48000)]
                frequency=sum(a<=0<b for a,b in zip(chunk,chunk[1:]))/.3
                self.assertAlmostEqual(frequency,1000,delta=15)
                preview=root/(preset+'preview');preview.mkdir()
                sample,ranges=rendering.preview(source,None,preview,settings,1.5,3.5,4,lambda *_:None)
                self.assertEqual(ranges,[(1.5,2,2),(2.5,3,2),(3,3.5,1)])
                self.assertAlmostEqual(pipeline.probe(sample).duration,1,delta=.1)
            # Lowest supported rate exercises chained atempo filters.
            settings.update(preset='audio_only',cuts=[],speed_regions=[dict(start=0,end=4,rate=.25)])
            slow=root/'slow';slow.mkdir()
            self.assertAlmostEqual(pipeline.probe(rendering.render(source,slow,settings,lambda *_:None)).duration,16,delta=.15)
