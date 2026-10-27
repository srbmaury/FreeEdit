from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
src = root / "assets/nasa_earth_moon_orbit.mp4"
audio = root / "narration.m4a"
photo = root / "assets/photo_intro.mp4"
out = root / "moon_drift_short.mp4"
overlay_dir = root / "overlays"
assets = [
    ("persistent.png", 0, 33.3),
    ("photo_credit.png", 0, 4.6),
    ("hook.png", 0, 5.8),
    ("metric.png", 5.2, 11.2),
    ("laser.png", 22.0, 27.9),
    ("outro.png", 30.3, 33.3),
    ("caption_1.png", 0, 4.6),
    ("caption_2.png", 4.6, 6.8),
    ("caption_3.png", 6.8, 11.0),
    ("caption_4.png", 11.0, 13.2),
    ("caption_5.png", 13.2, 17.0),
    ("caption_6.png", 17.0, 22.0),
    ("caption_7.png", 22.0, 27.8),
    ("caption_8.png", 27.8, 30.3),
    ("caption_9.png", 30.3, 33.3),
]
cmd = ["ffmpeg", "-hide_banner", "-y", "-i", str(src), "-i", str(audio), "-i", str(photo)]
for name, _, _ in assets:
    cmd += ["-loop", "1", "-framerate", "30", "-t", "33.3", "-i", str(overlay_dir / name)]
filters = [
    "[0:v]trim=duration=33.3,setpts=PTS-STARTPTS,split=2[back][front]",
    "[back]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=36:14,eq=brightness=-0.22:saturation=0.62[bg]",
    "[front]crop=720:600:280:60,scale=1080:900:flags=lanczos,eq=contrast=1.06:saturation=1.15[fg]",
    "[bg][fg]overlay=0:490:shortest=1,drawbox=x=0:y=490:w=1080:h=4:color=0xA6E7FF@0.8:t=fill,drawbox=x=0:y=1390:w=1080:h=3:color=0xA6E7FF@0.65:t=fill[v0]",
    "[v0][2:v]overlay=0:490:enable=\'between(t,0,4.6)\':eof_action=pass:shortest=0[vPhoto]",
]
last = "vPhoto"
for i, (name, start, end) in enumerate(assets, 3):
    nxt=f"v{i-1}"
    # Short alpha fades make the title/caption transitions feel less like static cards.
    inp=f"[{i}:v]"
    if name == "hook.png":
        filters.append(inp + "format=rgba,fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st=5.35:d=0.45:alpha=1[hookfade]")
        inp="[hookfade]"
    filters.append(f"[{last}]{inp}overlay=0:0:enable='between(t,{start},{end})':eof_action=pass:shortest=0[{nxt}]")
    last=nxt
filters.append(f"[{last}]format=yuv420p,fade=t=out:st=32.75:d=0.55[v]")
cmd += ["-filter_complex", ";".join(filters), "-map", "[v]", "-map", "1:a:0", "-t", "33.3",
        "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)]
subprocess.run(cmd, check=True)
print(out)
