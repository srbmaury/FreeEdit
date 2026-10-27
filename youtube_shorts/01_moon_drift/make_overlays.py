from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "overlays"
OUT.mkdir(exist_ok=True)
W, H = 1080, 1920
FONT = "/System/Library/Fonts/Supplemental/Avenir Next.ttc"

def font(size, bold=True):
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)

def new(): return Image.new("RGBA", (W,H), (0,0,0,0))
def centered(draw, y, text, fnt, fill, stroke=0, stroke_fill=(0,0,0,200)):
    box=draw.textbbox((0,0),text,font=fnt,stroke_width=stroke)
    x=(W-(box[2]-box[0]))//2
    draw.text((x,y),text,font=fnt,fill=fill,stroke_width=stroke,stroke_fill=stroke_fill)

def save(name, image): image.save(OUT/f"{name}.png")

# Persistent micro-brand and credits.
im=new(); d=ImageDraw.Draw(im)
d.rounded_rectangle((62,67,404,123),radius=18,fill=(4,18,35,165),outline=(135,226,255,110),width=2)
d.text((82,78),"FIELD NOTES   /   SPACE",font=font(25),fill=(158,235,255,255))
d.text((62,1857),"NASA GODDARD  •  ORBITAL VISUALIZATION",font=font(22,False),fill=(183,204,221,225),stroke_width=1,stroke_fill=(0,0,0,210))
save("persistent",im)

# Credit the iconic Apollo image while it is on screen.
im=new(); d=ImageDraw.Draw(im)
d.rounded_rectangle((54,1410,565,1466),radius=16,fill=(4,17,30,184),outline=(132,235,255,90),width=2)
d.text((77,1423),"APOLLO 8  •  NASA / BILL ANDERS",font=font(21),fill=(220,235,246,245))
save("photo_credit",im)

# Opening hook card.
im=new(); d=ImageDraw.Draw(im)
d.rounded_rectangle((54,146,830,378),radius=22,fill=(4,12,25,155),outline=(120,219,255,85),width=2)
d.text((82,170),"THE MOON IS",font=font(68),fill=(255,255,255,255),stroke_width=2,stroke_fill=(2,8,20,220))
d.text((82,254),"DRIFTING AWAY",font=font(66),fill=(139,232,255,255),stroke_width=2,stroke_fill=(2,8,20,220))
save("hook",im)

# Hero statistic, shown while the spoken number lands.
im=new(); d=ImageDraw.Draw(im)
d.rounded_rectangle((54,1437,850,1585),radius=24,fill=(4,17,30,188),outline=(132,255,225,150),width=2)
d.text((82,1440),"3.8",font=font(104),fill=(151,255,225,255),stroke_width=2,stroke_fill=(0,0,0,220))
d.text((294,1488),"CENTIMETERS / YEAR",font=font(36),fill=(255,255,255,255),stroke_width=1,stroke_fill=(0,0,0,180))
save("metric",im)

# Laser-ranging mini graphic, paired with real NASA motion.
im=new(); d=ImageDraw.Draw(im)
d.rounded_rectangle((54,1436,950,1598),radius=22,fill=(4,17,30,188),outline=(132,235,255,120),width=2)
d.text((82,1452),"LASER  >  REFLECTOR  >  RETURN",font=font(31),fill=(155,242,255,255))
d.text((82,1510),"MEASURING THE MOON'S DISTANCE",font=font(24,False),fill=(214,228,240,240))
save("laser",im)

# Closing phrase.
im=new(); d=ImageDraw.Draw(im)
d.rounded_rectangle((54,1440,880,1538),radius=22,fill=(4,17,30,180),outline=(132,255,225,105),width=2)
d.text((82,1460),"A SLOW COSMIC DANCE",font=font(39),fill=(151,255,225,255))
save("outro",im)

captions = [
    (0.0,4.6,"The Moon is moving away from Earth."),
    (4.6,6.8,"NASA's laser measurements reveal…"),
    (6.8,11.0,"About 3.8 centimeters per year."),
    (11.0,13.2,"The reason? Ocean tides."),
    (13.2,17.0,"Earth's rotation pulls the tidal bulge ahead."),
    (17.0,22.0,"That tug transfers energy into the Moon's orbit."),
    (22.0,27.8,"Scientists bounce lasers off reflectors on the Moon."),
    (27.8,30.3,"They time the return to measure its distance."),
    (30.3,33.3,"A tiny drift—about as fast as fingernails grow."),
]
for i,(start,end,text) in enumerate(captions,1):
    im=new(); d=ImageDraw.Draw(im)
    f=font(43)
    words=text.split(); lines=[]; cur=""
    for word in words:
        candidate=(cur+" "+word).strip()
        if d.textbbox((0,0),candidate,font=f)[2] > 930 and cur:
            lines.append(cur); cur=word
        else: cur=candidate
    if cur: lines.append(cur)
    line_h=56; y=1678 + max(0,(2-len(lines))*25)
    box_h=len(lines)*line_h+38
    d.rounded_rectangle((45,y-13,1035,y-13+box_h),radius=24,fill=(1,8,19,198),outline=(120,220,255,78),width=2)
    for line in lines:
        centered(d,y,line,f,(255,255,255,255),stroke=1,stroke_fill=(0,0,0,230)); y+=line_h
    save(f"caption_{i}",im)
