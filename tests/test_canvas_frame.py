import subprocess
import tempfile
import unittest
from pathlib import Path
from pydantic import ValidationError
from fastapi import HTTPException
from backend.models import FramingSettings, ProcessRequest
from backend import pipeline, rendering
from backend.canvas_frame import geometry


class CanvasFrameTests(unittest.TestCase):
    def test_validation_and_geometry(self):
        settings=FramingSettings(aspect='square').model_dump()
        g=geometry(320,180,settings)
        self.assertEqual((g['w'],g['h']),(180,180))
        self.assertGreater(g['x'],0)
        self.assertLessEqual(g['x']+g['iw'],g['w'])
        for field,value in [('padding',26),('radius',-1),('shadow',float('nan')),('image','invalid')]:
            with self.assertRaises(ValidationError): FramingSettings(**{field:value})
        with self.assertRaises(HTTPException):
            ProcessRequest(framing=settings,preset='audio_only').validate_media({'has_video':True})

    def test_real_export_and_preview_keep_duration_audio_and_background(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/'input.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=red:size=320x180:rate=12:duration=2',
                '-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-threads','1','-c:a','aac','-shortest',str(source)],check=True)
            settings=ProcessRequest(denoise=False,framing={'aspect':'square','padding':10,'radius':10,'shadow':3,'color':'#0000ff'},
                cuts=[{'start':.5,'end':.75}],reframe={'zoom':1.2}).model_dump()
            for preview in (False,True):
                work=root/str(preview);work.mkdir()
                out=(rendering.preview(source,None,work,settings,0,1.5,2,lambda *_:None)[0] if preview
                    else rendering.render(source,work,settings,lambda *_:None))
                info=pipeline.probe(out)
                self.assertEqual(info.width,info.height);self.assertTrue(info.has_audio)
                self.assertAlmostEqual(info.duration,1.25 if preview else 1.75,delta=.2)
                data=subprocess.check_output(['ffmpeg','-v','error','-i',str(out),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])
                self.assertGreater(data[2],200);self.assertLess(data[0],40)
                mid=(info.height//2*info.width+info.width//2)*3
                self.assertGreater(data[mid],200);self.assertLess(data[mid+2],40)
