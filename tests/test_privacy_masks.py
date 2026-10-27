"""Privacy regions must survive scaling, chroma alignment and tiny patches."""
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from backend import pipeline


class PrivacyGeometryTests(unittest.TestCase):
    def test_downscaled_masks_cover_the_entire_requested_rectangle(self):
        info=pipeline.MediaInfo(1,True,False,width=3840,height=2160)
        scale=1/3
        for style in ('black','blur','pixelate'):
            for x,y,w,h in ((601,603,8,80),(3832,2080,8,80),(0,0,4,4),(900,700,80,8)):
                with self.subTest(style=style,rectangle=(x,y,w,h)), tempfile.TemporaryDirectory() as folder:
                    parts,_,_=pipeline.build_video_edits([dict(type='hide',style=style,
                        x=x,y=y,w=w,h=h,start=0,end=1)],info,Path(folder),scale)
                    graph=';'.join(parts)
                    box=re.search(r'drawbox=x=(\d+):y=(\d+):w=(\d+):h=(\d+)',graph)
                    crop=re.search(r'crop=(\d+):(\d+):(\d+):(\d+)',graph)
                    self.assertTrue(box or crop,'A privacy region must never be omitted')
                    left,top,width,height=map(int,box.groups()) if box else (
                        int(crop[3]),int(crop[4]),int(crop[1]),int(crop[2]))
                    self.assertLessEqual(left,x*scale)
                    self.assertLessEqual(top,y*scale)
                    self.assertGreaterEqual(left+width,(x+w)*scale)
                    self.assertGreaterEqual(top+height,(y+h)*scale)
                    self.assertLessEqual(left+width,1280)
                    self.assertLessEqual(top+height,720)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg required')
class PrivacyPixelTests(unittest.TestCase):
    def test_small_export_uses_opaque_fallback_for_subfilter_size_masks(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); source=root/'white.mp4'
            subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i',
                'color=white:size=3840x2160:rate=2:duration=1','-c:v','libx264',
                '-preset','ultrafast','-threads','1',str(source)],check=True,capture_output=True)
            edits=[dict(type='hide',style=style,x=x,y=600,w=4,h=80,start=0,end=1)
                for style,x in zip(('black','blur','pixelate'),(600,1200,1800))]
            output=pipeline.process(source,root,denoise_audio=False,atten_lim=None,
                edits=edits,cuts=[],progress=lambda *_:None,preset='small')
            frame=subprocess.run(['ffmpeg','-v','error','-i',str(output),'-frames:v','1',
                '-pix_fmt','rgb24','-f','rawvideo','-'],check=True,capture_output=True).stdout
            self.assertEqual(len(frame),1280*720*3)
            for x in (200,400,600):
                with self.subTest(x=x):
                    pixel=frame[(210*1280+x)*3:(210*1280+x)*3+3]
                    self.assertLess(max(pixel),60,'Downscaling must not reveal white through a dropped mask')
            self.assertGreater(min(frame[(210*1280+100)*3:(210*1280+100)*3+3]),220)
