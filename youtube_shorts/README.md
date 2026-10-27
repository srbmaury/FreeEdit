# YouTube Shorts starter batch

Two vertical science Shorts, 1080×1920 at 30 fps, with Hindi narration, burned-in English captions, NASA imagery, and animated camera movement / motion graphics.

- [01 — The Moon Is Drifting Away](01_moon_drift/moon_drift_short.mp4): 33 seconds
- [02 — The Tiny Mirror That Measures the Moon](02_lunar_laser/lunar_laser_short.mp4): 27 seconds

Each episode folder includes its English SRT, Hindi script, voice track, source footage / image, overlay source images, rendering scripts, and a credits / YouTube metadata draft.

On macOS, rerender with FFmpeg and Pillow installed, plus the Hindi `Lekha` system voice:

```sh
python3 -m pip install Pillow
python3 make_overlays.py
python3 render.py
```

The narration uses the system Hindi voice (macOS `Lekha`). The videos include no third-party music.
