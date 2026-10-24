# Person-aware backgrounds

Open **Background** in the editor sidebar and choose **Blur**, **Solid color**, or **Background image**. The image choices include three built-in gradients and an upload button for PNG, JPEG, or WebP. Original leaves the recording unchanged.

Background effects are opt-in; FreeEdit does not scan every upload for people. Select an effect, then use **Preview background** to process a silent sample of up to three seconds from the playhead. A clear no-person result asks you to change the camera area or playhead. Detection is approximate and can produce false positives.

The main editor shows the source and existing overlays. The processed sample shows the actual background effect. It omits cuts and overlays; full export includes background effects, then privacy masks/text and cuts. Audio cleanup remains independent. Audio-only export excludes background effects.

## Webcam insets

Choose **Camera area only**, then **Draw camera area** and drag around the camera inset in the main preview. Escape exits drawing mode. Numeric X, Y, Width, and Height fields offer keyboard access. The selected rectangle is fixed throughout the recording: it does not follow a moving camera window. The rest of the screen is preserved by the composition step. Video re-encoding may still change pixel values.

## Setup

The background engine is optional and isolated from DeepFilterNet:

```sh
./setup-background.sh
./run.sh
```

The setup script uses Python 3.12 from `.venv` (override with `PYTHON_BIN=/absolute/path/to/python`). It creates `.venv-background`, installs the versions in `requirements-background.txt`, and downloads the model. `BACKGROUND_PYTHON` can point to an existing compatible environment. **Check setup** reports the background engine and model separately.

The first effect also downloads the model if needed. Only the model is downloaded; media processing stays on the FreeEdit server. With FreeEdit running locally, that is your computer. Model downloads come from the versioned Google MediaPipe model URL below, use a 30-second connection/read timeout, and must match the recorded SHA-256. The default cache is `~/.cache/freeedit`; change it with `FREEEDIT_MODEL_DIR`.

Docker builds omit the optional engine by default. Enable it with:

```sh
docker build --build-arg INSTALL_BACKGROUND=true -t freeedit .
```

That build installs the separate environment but does not bake this model into the image. The first background operation requires network access to download it.

## Projects and storage

Saved projects retain the selected effect, blur strength, color, camera rectangle, and the normalized image itself. Uploaded images are resized in the browser and encoded as PNG so projects can carry them without an external path. They share the existing 2 MB project-file limit. New files reset background settings. Background changes participate in undo/redo and mark existing exports as outdated.

A low-resolution mask is generated at 15 fps and interpolated when composing the source video; original video timing drives composition. Frames are streamed through bounded buffers. Mask files increase temporary disk use with recording duration. The disk check adds a conservative 1 MiB per second of recording as mask headroom; it is not a disk reservation against other applications. Cancellation terminates the worker process group on macOS/Linux, including its FFmpeg decoder and encoder. Native Windows background setup and cancellation are not validated.

## Quality and model record

This first implementation targets clearly visible people and is best suited to talking-head footage. Hair, transparent objects, fast movement, low light, small people, multiple people, and scene changes can produce halos, missed areas, or flicker. Mask smoothing reduces small changes but can leave slight motion trails. Do not use this feature to guarantee privacy; use a solid Hide area mask for sensitive content. Preview difficult sections before exporting.

- Engine: MediaPipe Image Segmenter, SelfieSegmenter square, float16, version 1.
- Model source: https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite
- SHA-256: `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`
- API/model documentation: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- Model card linked by that documentation: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf

The model is downloaded rather than committed. FreeEdit's MIT license covers its source, not a blanket grant for every dependency/model. Include the background environment when preparing the dependency inventory and verify the model's applicable terms before redistributing it.
