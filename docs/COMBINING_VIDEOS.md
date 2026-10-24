# Combine a main video and a presenter

Upload the main recording, then open **Videos → Add presenter video…**. FreeEdit supports one main video and one presenter inset. The main recording determines the frame size and full duration.

## Placement and timing

- Choose a corner and inset width, or set X/Y in source pixels.
- Use **Select (V)** in the preview toolbar to drag the inset in the editor to move it. The **Videos** inspector remains open while selecting and positioning the presenter. Drag its lower-right corner to resize it. Its aspect ratio is preserved. Presenter placement, timing, audio, and effect changes participate in Undo/Redo.
- **Start in main video** sets when the presenter appears on the original main timeline.
- **Presenter from/to** selects which part of the presenter recording is used.
- The presenter disappears when that range ends; it never extends the main recording.
- Main-video cuts apply to the combined picture and selected sound together.

The live editor shows the original rectangular presenter for placement. Background blur/removal and the selected audio are rendered in **Preview combined video**, a sample of up to three seconds starting at the main playhead. It includes the presenter's timing, placement, background effect, and sound choice. It omits main background effects, cuts, text, privacy masks, and noise removal; these are applied by full export.

## Background and sound

**Presenter background** offers Original, Blur, and Remove background. Blur/removal require the optional background environment (`./setup-background.sh`). The existing **Background** tool applies to the main recording before the presenter is placed. Use a solid Hide area mask for sensitive details: person segmentation can leave halos, missing body parts, and flickering edges.

**Sound from** offers Main video, Presenter video, Both videos, and Muted. Options requiring missing audio tracks are disabled. Both reveals separate volume controls (0–200%). The export mixes those tracks with a limiter to reduce clipping. Presenter audio starts at its video offset and is silent outside the selected interval. Muted MP4 exports contain no audio track. Audio-only exports require a sound source and contain the selected/mixed audio with main cuts.

Noise reduction runs after audio selection/mixing. The ordinary noise sample is disabled while a presenter is attached because it would only preview main audio. Use export to hear noise reduction on the combined sound. Pause detection still analyzes the original main recording, not mixed/presenter sound.

## Save and continue

Saved `.freeedit.json` projects retain placement, timing, effects, volume, and a fingerprint of the presenter. Neither recording is embedded. Keep both originals with the project file. Open the project, locate the main recording, then choose **Videos → Locate presenter video…** and select the unchanged presenter. Export is blocked until it matches the saved fingerprint. Remove the presenter to replace it with a different recording.

Each upload follows the server upload/duration limits. The presenter is copied into the main session's temporary folder and expires with that session. Removing it from the editor disables it but its temporary server copy may remain until the session is cleaned or replaced. The original files are never changed.

## Processing and limits

Combining videos adds an intermediate H.264/AAC composition before the final export; this costs disk space, processing time, and an extra encoding pass. Main-background effects require another pass. The queue and Cancel controls apply to combined preview/export. Disk estimates are conservative heuristics, not reservations. Presenter upload has progress; processing cancellation is available after upload.

This version handles a fixed rectangular inset. It does not concatenate recordings, support multiple presenter layers, follow a moving subject/inset, provide animated keyframes, or implement a general multitrack timeline. Short synthetic/main and person-image clips were checked, including timing, each sound choice, blur/removal, cuts, project relinking, and combined preview. Long two-video exports and varied real talking-head footage need broader validation.
