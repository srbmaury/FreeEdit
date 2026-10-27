from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
ROOT=Path(__file__).resolve().parent; OUT=ROOT/'overlays'; OUT.mkdir(exist_ok=True)
W,H=1080,1920; FONT='/System/Library/Fonts/Supplemental/Avenir Next.ttc'
def f(n,b=True): return ImageFont.truetype(FONT,n,index=1 if b else 0)
def blank(): return Image.new('RGBA',(W,H),(0,0,0,0))
def save(n,im): im.save(OUT/(n+'.png'))
def card(y,h=142,w=900):
 d.rounded_rectangle((54,y,54+w,y+h),radius=23,fill=(4,17,30,195),outline=(132,235,255,140),width=2)
def center(text,y,ft,fill):
 b=d.textbbox((0,0),text,font=ft); d.text(((W-(b[2]-b[0]))//2,y),text,font=ft,fill=fill,stroke_width=1,stroke_fill=(0,0,0,180))
# constant identity + source info
im=blank(); d=ImageDraw.Draw(im); d.rounded_rectangle((62,67,423,123),radius=18,fill=(4,18,35,165),outline=(135,226,255,110),width=2); d.text((82,78),'FIELD NOTES   /   SPACE',font=f(25),fill=(158,235,255,255)); d.text((62,1857),'NASA / APOLLO 11  •  LUNAR LASER RANGING',font=f(22,False),fill=(183,204,221,225),stroke_width=1,stroke_fill=(0,0,0,210)); save('persistent',im)
im=blank(); d=ImageDraw.Draw(im); card(146,232,920); d.text((82,170),'A MIRROR LEFT',font=f(68),fill='white',stroke_width=2,stroke_fill=(2,8,20,220)); d.text((82,254),'ON THE MOON',font=f(66),fill=(139,232,255,255),stroke_width=2,stroke_fill=(2,8,20,220)); save('hook',im)
im=blank(); d=ImageDraw.Draw(im); card(1437,148,880); d.text((82,1440),'2.5',font=f(104),fill=(151,255,225,255),stroke_width=2,stroke_fill=(0,0,0,220)); d.text((294,1488),'SECONDS ROUND TRIP',font=f(37),fill='white',stroke_width=1,stroke_fill=(0,0,0,180)); save('seconds',im)
im=blank(); d=ImageDraw.Draw(im); card(1437,148,880); d.text((82,1440),'~200',font=f(90),fill=(151,255,225,255),stroke_width=2,stroke_fill=(0,0,0,220)); d.text((380,1484),'PHOTONS RETURNED',font=f(35),fill='white',stroke_width=1,stroke_fill=(0,0,0,180)); d.text((82,1540),'FROM TENS OF THOUSANDS OF LASER PULSES',font=f(22,False),fill=(210,230,242,245)); save('photons',im)
im=blank(); d=ImageDraw.Draw(im); card(1437,148,880); d.text((82,1452),'MILLIMETER PRECISION',font=f(42),fill=(151,255,225,255),stroke_width=1,stroke_fill=(0,0,0,200)); d.text((82,1510),'TIMING THE RETURN OF LIGHT',font=f(25,False),fill=(210,230,242,245)); save('precision',im)
im=blank(); d=ImageDraw.Draw(im); card(1440,100,730); d.text((82,1460),'A TINY MIRROR. A HUGE MEASURE.',font=f(32),fill=(151,255,225,255)); save('outro',im)
im=blank(); d=ImageDraw.Draw(im); d.rounded_rectangle((54,1410,600,1466),radius=16,fill=(4,17,30,184),outline=(132,235,255,90),width=2); d.text((77,1423),'APOLLO 11  •  NASA / NEIL ARMSTRONG',font=f(20),fill=(220,235,246,245)); save('photo_credit',im)
items=[(0,4.6,'This Apollo-era mirror still works.'),(4.6,7.2,'Scientists send laser pulses from Earth.'),(7.2,9.7,'A reflector sends the light back.'),(9.7,13.9,'The round trip takes about 2.5 seconds.'),(13.9,16.0,'The signal is incredibly faint.'),(16.0,21.8,'In one NASA test, about 200 photons returned.'),(21.8,25.8,'Timing the light measures distance to millimeters.'),(25.8,27.0,'A tiny mirror. An astonishing measurement.')]
for i,(a,b,t) in enumerate(items,1):
 im=blank(); d=ImageDraw.Draw(im); ft=f(42); words=t.split(); lines=[]; cur=''
 for word in words:
  test=(cur+' '+word).strip()
  if d.textbbox((0,0),test,font=ft)[2]>930 and cur: lines.append(cur); cur=word
  else: cur=test
 if cur: lines.append(cur)
 y=1678+max(0,(2-len(lines))*25); d.rounded_rectangle((45,y-13,1035,y-13+len(lines)*56+38),radius=24,fill=(1,8,19,198),outline=(120,220,255,78),width=2)
 for line in lines: center(line,y,ft,(255,255,255,255)); y+=56
 save(f'caption_{i}',im)
