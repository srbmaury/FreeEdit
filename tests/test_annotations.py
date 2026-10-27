"""Synthetic annotation raster and FFmpeg animation regression tests."""
import base64
import shutil
import subprocess
import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from pydantic import ValidationError
from backend import pipeline, rendering
from backend.models import AnnotationEdit, ProcessRequest


def png_pixel(color=(255, 0, 0, 255), size=1):
    """A tiny valid RGBA PNG; no Pillow dependency required."""
    def chunk(tag, payload):
        return struct.pack(">I",len(payload))+tag+payload+struct.pack(">I",zlib.crc32(tag+payload)&0xffffffff)
    signature=b"\x89PNG\r\n\x1a\n"
    header=chunk(b"IHDR",struct.pack(">IIBBBBB",size,size,8,6,0,0,0))
    data=chunk(b"IDAT",zlib.compress((b"\x00"+bytes(color)*size)*size))
    return "data:image/png;base64,"+base64.b64encode(signature+header+data+chunk(b"IEND",b"")).decode()


class AnnotationValidationTests(unittest.TestCase):
    def test_accepts_fade_slide_and_static(self):
        for animation in ["none","fade","slide"]:
            edit=AnnotationEdit(type="annotation",start=.3,end=2.2,x=4,y=8,
                                image=png_pixel(),animation=animation,transition=.2)
            self.assertEqual(edit.animation,animation)

    def test_rejects_invalid_assets_and_animations(self):
        base={"type":"annotation","start":0,"end":2,"x":0,"y":0,
              "image":png_pixel(),"animation":"fade"}
        for updates in ({"image":"javascript:alert(1)"},{"animation":"bounce"},
                        {"transition":5},{"image":"data:image/png;base64,@@@@@"}):
            with self.subTest(updates=updates),self.assertRaises(ValidationError):
                AnnotationEdit(**{**base,**updates})


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),"FFmpeg required")
class AnnotationVideoTests(unittest.TestCase):
    def test_range_previews_preserve_animation_progress_with_cuts(self):
        """Compare decoded pixels, including partial entrances and exits."""
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            source=root/"source.mp4"
            subprocess.run(["ffmpeg","-v","error","-y","-f","lavfi","-i",
                "color=black:size=160x90:rate=24:duration=4",
                "-c:v","libx264","-threads","1",str(source)],check=True,capture_output=True)

            def frame(path, time):
                return subprocess.run(["ffmpeg","-v","error","-ss",str(time),"-i",str(path),
                    "-frames:v","1","-pix_fmt","rgb24","-f","rawvideo","-"],
                    check=True,capture_output=True).stdout

            for animation in ("none", "fade", "slide"):
                settings=dict(preset="high",denoise=False,atten_lim=None,
                    cuts=[dict(start=.125,end=.25)],
                    edits=[dict(type="annotation",start=.5,end=3.5,x=60,y=30,
                        image=png_pixel(size=32),animation=animation,transition=.5)])
                full=root/animation; full.mkdir()
                output=rendering.render(source,full,settings,lambda *_:None)
                for start in (.25, .75, 1.5, 3):
                    preview=full/str(start); preview.mkdir()
                    sample,_=rendering.preview(source,None,preview,settings,start,start+.5,4,lambda *_:None)
                    for local_time in (.125, .375):
                        with self.subTest(animation=animation,start=start,time=local_time):
                            # The cut precedes every sampled source time.
                            expected=frame(output,start+local_time-.125)
                            actual=frame(sample,local_time)
                            self.assertEqual(len(expected),160*90*3)
                            self.assertEqual(len(actual),len(expected))
                            error=sum(abs(a-b) for a,b in zip(actual,expected))/len(actual)
                            self.assertLess(error,.8,"Preview must match the same exported source frame")

    def test_export_contains_annotation_pixels(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            source=root/"source.mp4"
            subprocess.run(["ffmpeg","-v","error","-y","-f","lavfi","-i",
                "color=black:size=160x90:rate=24:duration=2",
                "-c:v","libx264","-threads","1",str(source)],check=True,capture_output=True)
            for animation in ("none", "fade", "slide"):
                with self.subTest(animation=animation):
                    result=pipeline.process(source,root,denoise_audio=False,atten_lim=None,
                        edits=[dict(type="annotation",start=.2,end=1.8,x=40,y=30,
                            image=png_pixel(size=32),animation=animation,transition=.3)],
                        cuts=[],progress=lambda *_:None,preset="high")
                    frame=subprocess.run(["ffmpeg","-v","error","-ss","1","-i",str(result),
                        "-frames:v","1","-pix_fmt","rgb24","-f","rawvideo","-"],
                        check=True,capture_output=True).stdout
                    pixel=frame[(40*160+50)*3:(40*160+50)*3+3]
                    self.assertEqual(len(pixel),3)
                    self.assertGreater(pixel[0],180)
                    self.assertLess(max(pixel[1:]),60)

    def test_export_annotations_with_cut_and_sound(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            source=root/"source.mp4"
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",
                "-f","lavfi","-i","testsrc2=size=160x90:rate=24:duration=3",
                "-f","lavfi","-i","sine=frequency=350:sample_rate=48000:duration=3",
                "-c:v","libx264","-preset","ultrafast","-threads","1",
                "-c:a","aac","-shortest",str(source)],check=True,capture_output=True)
            edits=[
              {"type":"annotation","start":.3,"end":2.3,"x":12,"y":12,
               "image":png_pixel(),"animation":"fade","transition":.4},
              {"type":"annotation","start":1,"end":2.5,"x":60,"y":30,
               "image":png_pixel((0,255,0,255)),"animation":"slide","transition":.3}
            ]
            result=pipeline.process(source,root,denoise_audio=False,atten_lim=None,
                edits=edits,cuts=[{"start":.1,"end":.2}],progress=lambda *_:None,
                preset="small")
            info=pipeline.probe(result)
            self.assertTrue(info.has_audio)
            self.assertTrue(info.has_video)
            self.assertEqual((info.width,info.height),(160,90))
            self.assertAlmostEqual(info.duration,2.9,delta=.25)


if __name__=="__main__": unittest.main()
