"""Stream small video frames through MediaPipe into a lossless, low-resolution mask."""
import json
import math
import subprocess
import sys
import tempfile


def main():
    import cv2
    import mediapipe as mp
    import numpy as np

    config = json.loads(open(sys.argv[1]).read())
    region = config["region"]
    # Bounded buffers regardless of source resolution or recording duration.
    factor = 256 / max(region["w"], region["h"])
    width, height = max(2, round(region["w"] * factor)), max(2, round(region["h"] * factor))
    fps = 15
    count = max(1, math.ceil(config["duration"] * fps))
    filters = (f"tpad=stop_mode=clone:stop_duration={config['duration']},"
               f"crop={region['w']}:{region['h']}:{region['x']}:{region['y']}:exact=1,"
               f"fps={fps},scale={width}:{height}")
    options = mp.tasks.vision.ImageSegmenterOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=config["model"]),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        output_confidence_masks=True, output_category_mask=False)
    decoder = encoder = None
    detected = 0
    frames = 0
    with tempfile.TemporaryFile() as errors, mp.tasks.vision.ImageSegmenter.create_from_options(options) as segmenter:
        try:
            decoder = subprocess.Popen([config["ffmpeg"], "-v", "error", "-nostdin", "-threads", "1",
                "-ss", str(config["start"]), "-i", config["source"], "-an", "-vf", filters,
                "-t", str(config["duration"]), "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                stdout=subprocess.PIPE, stderr=errors)
            encoder = subprocess.Popen([config["ffmpeg"], "-v", "error", "-y", "-nostdin",
                "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{width}x{height}", "-r", str(fps),
                "-i", "pipe:0", "-an", "-c:v", "ffv1", "-threads", "1", config["output"]],
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
            previous = None
            for index in range(count):
                data = decoder.stdout.read(width * height * 3)
                if not data:
                    break
                if len(data) != width * height * 3:
                    raise RuntimeError("Incomplete decoded frame")
                frame = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
                result = segmenter.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), round(index * 1000 / fps))
                # SelfieSegmenter emits a single foreground confidence mask.
                confidence = result.confidence_masks[0].numpy_view().copy()
                confidence = cv2.resize(confidence, (width, height))
                if np.mean(confidence > 0.6) > 0.01:
                    detected += 1
                alpha = np.clip((confidence - 0.15) / 0.7, 0, 1)
                alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
                if previous is not None:
                    alpha = alpha * 0.8 + previous * 0.2
                previous = alpha
                encoder.stdin.write((alpha * 255).astype(np.uint8).tobytes())
                frames += 1
            encoder.stdin.close()
            if decoder.wait() or encoder.wait() or not frames:
                errors.seek(0)
                raise RuntimeError(errors.read()[-2000:].decode(errors="replace"))
        finally:
            for process in (decoder, encoder):
                if process and process.poll() is None:
                    process.kill()
                    process.wait()
                if process:
                    for pipe in (process.stdin, process.stdout):
                        if pipe and not pipe.closed:
                            pipe.close()
    print(json.dumps({"person_detected": detected >= max(1, min(3, frames // 4)), "frames": frames}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
