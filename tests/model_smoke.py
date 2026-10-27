"""Opt-in real model checks: unittest discover -s tests -p model_smoke.py -v.

Use FREEEDIT_PERSON_FIXTURE for a centered portrait with a clear top-right
background. Ordinary tests stay lightweight and never download model weights.
"""
import array
import math
import os
import random
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from backend import background, pipeline


class ModelSmokeTests(unittest.TestCase):
    def test_real_denoiser_suppresses_stationary_noise_across_chunks(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); source=root/'noise.wav'
            rng=random.Random(42)
            samples=array.array('h',(round(rng.uniform(-3500,3500)) for _ in range(60000)))
            with wave.open(str(source),'wb') as wav:
                wav.setparams((1,2,48000,0,'NONE','not compressed'))
                wav.writeframes(samples.tobytes())
            with patch.dict(os.environ,{'DF_CHUNK_SECONDS':'0.5'}):
                result=pipeline.denoise(source,root/'denoised',30,1.25)
            with wave.open(str(result),'rb') as wav:
                self.assertEqual(wav.getframerate(),48000)
                self.assertEqual(wav.getnchannels(),1)
                self.assertEqual(wav.getnframes(),len(samples))
                clean=array.array('h',wav.readframes(wav.getnframes()))
            rms=lambda values:math.sqrt(sum(value*value for value in values)/len(values))
            ratio=rms(clean)/rms(samples)
            print(f'Real denoiser stationary-noise RMS ratio: {ratio:.4f}')
            self.assertLess(ratio,.8,'Denoising must do more than copy the noisy input')

    @unittest.skipUnless(os.environ.get('FREEEDIT_PERSON_FIXTURE'),'Set a centered portrait fixture')
    def test_real_segmentation_preserves_person_and_replaces_background(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); source=root/'person.mp4'
            subprocess.run([pipeline.FFMPEG(),'-v','error','-y','-loop','1','-i',
                os.environ['FREEEDIT_PERSON_FIXTURE'],'-vf','scale=320:-2','-t','1','-r','15',
                '-c:v','libx264','-threads','1','-pix_fmt','yuv420p',str(source)],
                check=True,capture_output=True)
            info=pipeline.probe(source)
            mask=background.create_mask(source,root,info,{},lambda *_:None)
            mask_info=pipeline.probe(mask)
            pixels=subprocess.run([pipeline.FFMPEG(),'-v','error','-i',str(mask),
                '-frames:v','1','-pix_fmt','gray','-f','rawvideo','-'],
                check=True,capture_output=True).stdout
            foreground=pixels[int(mask_info.height*.4)*mask_info.width+int(mask_info.width*.5)]
            backdrop=pixels[int(mask_info.height*.05)*mask_info.width+int(mask_info.width*.95)]
            print(f'Real segmentation confidence: person={foreground}, background={backdrop}')
            self.assertGreater(foreground,200)
            self.assertLess(backdrop,50)
            output=pipeline.process(source,root,denoise_audio=False,atten_lim=None,edits=[],cuts=[],
                background=dict(mode='color',color='#00ff00'),progress=lambda *_:None,preset='high')
            frame=subprocess.run([pipeline.FFMPEG(),'-v','error','-i',str(output),'-frames:v','1',
                '-pix_fmt','rgb24','-f','rawvideo','-'],check=True,capture_output=True).stdout
            index=(int(info.height*.05)*info.width+int(info.width*.95))*3
            red,green,blue=frame[index:index+3]
            self.assertGreater(green,200)
            self.assertLess(max(red,blue),60)
