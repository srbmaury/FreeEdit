"""Full-frame cursor alpha masks use source coordinates, cuts and preview timing."""
import base64
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw
from fastapi import HTTPException
from pydantic import ValidationError
from backend import pipeline, rendering
from backend.models import ProcessRequest


def mask():
    # Deliberately low resolution: backend must map it to the full source.
    image=Image.new('RGBA',(80,45),(0,0,0,140))
    ImageDraw.Draw(image).ellipse((30,12,50,32),fill=(0,0,0,0))
    stream=io.BytesIO();image.save(stream,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()


class CursorEffectTests(unittest.TestCase):
    @staticmethod
    def edit():
        return dict(type='annotation',x=0,y=0,start=.5,end=3.5,image=mask(),canvas_size=[160,90],animation='fade',transition=.5)

    def test_full_canvas_admission(self):
        media=dict(has_video=True,has_audio=False,width=160,height=90,duration=4)
        req=ProcessRequest(denoise=False,edits=[self.edit()]);req.validate_media(media)
        for update in ({'canvas_size':[999,90]},{'x':1},{'animation':'slide'}):
            with self.assertRaises(HTTPException):
                ProcessRequest(edits=[{**self.edit(),**update}]).validate_media(media)
        with self.assertRaises(ValidationError):ProcessRequest(edits=[self.edit()]*9)

    def test_spotlight_pixels_and_preview_after_cut(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=white:size=160x90:rate=24:duration=4',
                '-c:v','libx264','-threads','1',str(source)],check=True,capture_output=True)
            settings=ProcessRequest(denoise=False,preset='high',edits=[self.edit()],cuts=[dict(start=.1,end=.2)]).model_dump()
            full=root/'full';full.mkdir()
            output=rendering.render(source,full,settings,lambda *_:None)
            def frame(path,t):
                return subprocess.check_output(['ffmpeg','-v','error','-ss',str(t),'-i',str(path),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','-'])
            data=frame(output,1.4)
            self.assertLess(data[(10*160+10)*3],140)
            self.assertGreater(data[(45*160+80)*3],235)
            self.assertGreater(frame(output,.1)[(10*160+10)*3],235)
            for start in (.75,1.5,3):
                work=root/str(start);work.mkdir()
                sample,_=rendering.preview(source,None,work,settings,start,start+.5,4,lambda *_:None)
                expected=frame(output,start+.25-.1);actual=frame(sample,.25)
                self.assertEqual(len(actual),len(expected))
                self.assertLess(sum(abs(a-b) for a,b in zip(actual,expected))/len(actual),1.5)
