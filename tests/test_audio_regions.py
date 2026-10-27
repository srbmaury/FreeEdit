"""Decode synthetic sound to verify gains, envelopes, cuts and preview clocks."""
import array
import math
import subprocess
import tempfile
import unittest
from pathlib import Path
from pydantic import ValidationError
from fastapi import HTTPException
from backend import rendering
from backend.models import AudioRegion, ProcessRequest


class AudioRegionTests(unittest.TestCase):
    def test_admission(self):
        base=dict(start=0,end=1,volume=0,fade=.05)
        for update in ({'volume':-1},{'volume':2.1},{'fade':.3},{'fade':float('nan')},{'end':0}):
            with self.assertRaises(ValidationError):AudioRegion(**{**base,**update})
        with self.assertRaises(ValidationError):ProcessRequest(audio_regions=[base]*51)
        with self.assertRaises(HTTPException):
            ProcessRequest(audio_regions=[base]).validate_media(dict(has_video=True,has_audio=False,duration=4))
        with self.assertRaises(HTTPException):
            ProcessRequest(audio_regions=[{**base,'end':5}]).validate_media(dict(has_video=True,has_audio=True,duration=4))

    def test_sample_gains_mute_boost_overlap_and_boundary_fades(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.wav'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=1000:duration=4:sample_rate=48000',
                '-ac','2','-c:a','pcm_s16le',str(source)],check=True)
            regions=[dict(start=.5,end=1.5,volume=.5,fade=.1),dict(start=2,end=3,volume=2,fade=.1),dict(start=2.4,end=2.6,volume=0,fade=.02)]
            settings=ProcessRequest(denoise=False,preset='audio_only',audio_regions=regions).model_dump()
            def samples(path):
                data=subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-f','f32le','-ac','2','-ar','48000','-'])
                result=array.array('f');result.frombytes(data);return result
            def rms(data,t,length=.02):
                span=data[int(t*48000)*2:int((t+length)*48000)*2];self.assertTrue(span)
                return math.sqrt(sum(x*x for x in span)/len(span))
            full=root/'full';full.mkdir();output=rendering.render(source,full,settings,lambda *_:None)
            data=samples(output);normal=rms(data,.2)
            self.assertAlmostEqual(rms(data,.8)/normal,.5,delta=.025)
            self.assertAlmostEqual(rms(data,2.15)/normal,2,delta=.025)
            self.assertLess(rms(data,2.45),1e-5)
            self.assertGreater(rms(data,.51)/normal,.7)
            self.assertLess(rms(data,.51)/normal,.97)
            # Previews that start inside a ramp must retain its original clock.
            for start in (.52, .8, 2.42, 3.5):
                work=root/str(start);work.mkdir()
                sample,_=rendering.preview(source,None,work,settings,start,start+.3,4,lambda *_:None)
                actual=samples(sample)
                self.assertAlmostEqual(rms(actual,.02),rms(data,start+.02),delta=.003)
            # Audio-only cuts remove the same original-time regions.
            cut=root/'cut';cut.mkdir();settings['cuts']=[dict(start=.1,end=.3)]
            trimmed=samples(rendering.render(source,cut,settings,lambda *_:None))
            self.assertAlmostEqual(rms(trimmed,.6)/normal,.5,delta=.025)
            self.assertLess(rms(trimmed,2.25),1e-5)
            # The maximum admitted expression must remain parseable and bounded.
            maximum=root/'maximum';maximum.mkdir()
            settings['audio_regions']=[dict(start=.5,end=1.5,volume=.5,fade=.05)]*50
            quiet=samples(rendering.render(source,maximum,settings,lambda *_:None))
            self.assertLess(rms(quiet,.6),1e-5)

    def test_video_branch_and_final_fades_preserve_mute(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=blue:size=160x90:rate=24:duration=3',
                '-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-threads','1','-c:a','aac','-shortest',str(source)],check=True)
            settings=ProcessRequest(denoise=False,audio={'level_speech':True,'fade_in':.1,'fade_out':.1},
                audio_regions=[dict(start=1,end=2,volume=0,fade=.05)],cuts=[dict(start=.2,end=.4)]).model_dump()
            work=root/'video';work.mkdir();out=rendering.render(source,work,settings,lambda *_:None)
            raw=subprocess.check_output(['ffmpeg','-v','error','-ss','1.1','-i',str(out),'-t','0.3','-f','f32le','-'])
            data=array.array('f');data.frombytes(raw)
            self.assertTrue(data);self.assertLess(max(abs(x) for x in data),.001)
