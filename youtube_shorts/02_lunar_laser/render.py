from pathlib import Path
import subprocess
root=Path(__file__).resolve().parent
src=root/'assets/nasa_earth_moon_orbit.mp4'; audio=root/'narration.m4a'; photo=root/'assets/photo_intro.mp4'; od=root/'overlays'; out=root/'lunar_laser_short.mp4'; duration=27.5
assets=[('persistent.png',0,duration),('photo_credit.png',0,4.6),('hook.png',0,4.6),('seconds.png',9.7,13.9),('photons.png',16.0,21.8),('precision.png',21.8,25.8),('outro.png',25.8,duration)]+[(f'caption_{i}.png',a,b) for i,(a,b) in enumerate([(0,4.6),(4.6,7.2),(7.2,9.7),(9.7,13.9),(13.9,16.0),(16.0,21.8),(21.8,25.8),(25.8,27.5)],1)]
cmd=['ffmpeg','-hide_banner','-y','-i',str(src),'-i',str(audio),'-i',str(photo)]
for name,_,_ in assets: cmd+=['-loop','1','-framerate','30','-t',str(duration),'-i',str(od/name)]
filters=[
 f'[0:v]trim=duration={duration},setpts=PTS-STARTPTS,split=2[back][front]',
 ' [back]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=36:14,eq=brightness=-0.22:saturation=0.62[bg]'.strip(),
 '[front]crop=720:600:280:60,scale=1080:900:flags=lanczos,eq=contrast=1.06:saturation=1.15[fg]',
 '[bg][fg]overlay=0:490:shortest=1,drawbox=x=0:y=490:w=1080:h=4:color=0xA6E7FF@0.8:t=fill,drawbox=x=0:y=1390:w=1080:h=3:color=0xA6E7FF@0.65:t=fill[v0]',
 "[v0][2:v]overlay=0:490:enable='between(t,0,4.6)':eof_action=pass:shortest=0[vPhoto]"
]
last='vPhoto'
for i,(name,start,end) in enumerate(assets,3):
 nxt=f'v{i-1}'; inp=f'[{i}:v]'
 if name=='hook.png':
  filters.append(inp+'format=rgba,fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st=4.15:d=0.45:alpha=1[hookfade]'); inp='[hookfade]'
 filters.append(f'[{last}]{inp}overlay=0:0:enable=\'between(t,{start},{end})\':eof_action=pass:shortest=0[{nxt}]'); last=nxt
filters.append(f'[{last}]format=yuv420p,fade=t=out:st=26.95:d=0.55[v]')
cmd+=['-filter_complex',';'.join(filters),'-map','[v]','-map','1:a:0','-t',str(duration),'-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-movflags','+faststart',str(out)]
subprocess.run(cmd,check=True)
print(out)
