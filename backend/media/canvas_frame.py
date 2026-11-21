"""Frame the completed recording, after overlays and Reframe, with bounded PNG assets."""
import base64
import io
import math
from PIL import Image, ImageDraw, ImageFilter, ImageOps


def geometry(width, height, settings):
    ratio = {'wide': 16/9, 'vertical': 9/16, 'square': 1}.get(settings['aspect'], width/height)
    even = lambda n: max(2, math.floor(n/2)*2)
    w = even(min(width, height*ratio))
    h = even(w/ratio)
    pad = min(w, h)*settings['padding']/100
    scale = min((w-2*pad)/width, (h-2*pad)/height)
    iw, ih = even(width*scale), even(height*scale)
    return dict(w=w, h=h, iw=iw, ih=ih, x=(w-iw)//2, y=(h-ih)//2,
                radius=min(iw, ih)*settings['radius']/100)


def build_frame(label, width, height, settings, work, first_input):
    g = geometry(width, height, settings)
    w, h, iw, ih, x, y = (g[k] for k in ('w','h','iw','ih','x','y'))
    backdrop = Image.new('RGB', (w, h), settings['color'])
    if settings.get('image'):
        with Image.open(io.BytesIO(base64.b64decode(settings['image'].split(',', 1)[1]))) as image:
            image.load()
            fitted = ImageOps.fit(image.convert('RGBA'), (w,h), method=Image.Resampling.LANCZOS)
            backdrop.paste(fitted, (0,0), fitted)
    mask = Image.new('L', (iw,ih))
    ImageDraw.Draw(mask).rounded_rectangle((0,0,iw-1,ih-1), radius=g['radius'], fill=255)
    if settings['shadow']:
        blur = min(w,h)*settings['shadow']/100
        shadow = Image.new('L', (w,h))
        shadow.paste(mask.point(lambda n: round(n*.45)), (x, y+round(blur/2)))
        shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
        backdrop.paste((0,0,0), (0,0,w,h), shadow)
    background_path, mask_path = work/'canvas-background.png', work/'canvas-mask.png'
    backdrop.save(background_path); mask.save(mask_path)
    parts = [f'{label}scale={iw}:{ih},setsar=1,format=rgba[framecontent]',
             f'[{first_input+1}:v]format=gray[framemask]',
             '[framecontent][framemask]alphamerge=shortest=1[roundedcontent]',
             f'[{first_input}:v][roundedcontent]overlay={x}:{y}:shortest=1[framed]']
    return parts, '[framed]', [background_path, mask_path]
