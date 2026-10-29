# Using FreeEdit

FreeEdit is a focused screen-recording editor. It keeps edits relative to the **original recording timeline**. This guide covers the editing workflow, media samples, presenter/background effects, and saving projects.

## Typical workflow

Privacy masks remain covered when export resolution is reduced. Regions too
small for blur or pixelation use a solid cover. Always review the exported
recording before sharing sensitive material.

1. Upload a screen recording, webcam clip or audio file.
2. Choose **Audio**, **Pauses**, **Cut**, **Text**, **Hide area**, **Reframe**, **Captions**, **Annotations**, **Draw**, **Background**, or **Videos** from the task rail.
3. Use **Edits (V)** beside the preview to select and adjust existing edits. Drag timeline blocks to change their position or edges to change their duration. Changes can be undone.
4. Use **Export → Preview result** to review the selected range, then export the complete result.
5. Save a `.freeedit.json` project and keep both source recordings if you want to edit again later.

The desktop timeline sits below the preview, beside the settings inspector.
Effect tracks appear when they contain edits; pause suggestions appear after
analysis. Undo and redo keep recent changes within a memory budget, so older
steps can expire in large projects. Save a project file to keep a lasting copy.

### Cut, range selection and pauses

- Drag across the waveform or timeline ruler, or mark the start and end with **I** and **O**. Range actions include Play, Cut and Reframe. Draft ranges do not change the project until applied.
- **Cut (X)** opens a form for exact start/end times; applied cuts are skipped during playback. You can edit or remove them in Edits.
- **Pauses → Detect pauses** finds quiet audio rather than semantic speech pauses. Review and listen to each suggestion before removing it. Detection is paginated (25 results at a time); selections persist across pages.
- The waveform shows at most 4,096 amplitude bins, normalized for visualization rather than loudness measurement.

### Text, captions and privacy masks

- **Text (T):** click the recording, type text in Edits, then position, resize, style and time it.
- **Hide area (H):** drag a region and choose solid cover, blur or pixelation. **Use a solid cover for genuinely sensitive material**; blur and pixelation are not strong redaction.
- **Captions:** import an SRT file; captions become editable timed text. There is no automatic transcription.

### Annotations: icons, arrows, shapes, callouts and logos

Open **Annotations** and choose a pictured icon, shape, arrow or callout from the visual gallery. The next click on the recording **places the selected annotation immediately**. Alternatively, choose **Upload image or logo** (PNG, JPG or WebP under 750 KB) before clicking the video; the image is decoded first so it appears as soon as it is placed.

Use **Edits** to drag/resize, change color/opacity/rotation/timing, or select **None, Fade or Slide** animations. Switching animation styles on an existing edit updates the saved project and seeks to a sample of the new effect; the gallery animation choice only affects new annotations. When an existing annotation is selected, click an empty part of the video to reposition it. The inspector scrolls at full available height rather than clipping long edit cards.

Annotations use the original source timeline and render as transparent PNG overlays in FFmpeg export. Images are embedded into version-2 project JSON; keep them small, as the overall project file size limit still applies. They share the combined overlay count with text and privacy masks. Free motion keyframes and object tracking are not included.

### Custom drawing

Choose **Draw (D)**, then drag on the video with the **Pen** or **Highlighter**.
Choose a color, width in original video pixels, opacity, and start/end times.
Each completed stroke becomes a timed drawing in the Notes track. A tap makes
one dot; a canceled gesture adds nothing. Undo and Redo apply to individual
strokes. **Erase stroke** removes a whole visible stroke you touch, while
**Clear drawings in this range** removes drawing strokes overlapping the entered
range in one undoable action. Other annotations remain intact.

Choose **Done drawing** to return to Edits. Select a drawing to move, resize,
rotate, recolor, change its width or opacity, animate it, or adjust its timing.
Drawings retain vector points in project files and browser recovery and use the
same painter for preview and transparent PNG export. They remain attached to
original source coordinates when Reframe zooms or crops the recording. Audio-only
exports omit them.

To combine strokes, open **Draw → Drawing groups**, check two or more strokes,
and choose **Group selected strokes**. The group becomes one Notes-track item
with shared position, size, rotation, opacity, timing and animation. Its initial
range runs from the earliest selected start to the latest selected end. Grouping
resets individual animations to one shared animation; colors and stroke opacities
are preserved. The group occupies its uppermost member's layer.

Select the group in **Edits** and choose **Ungroup drawing** to edit individual
colors and widths again. Ungrouping keeps the current transformed geometry,
combined opacity, shared timing and animation. Erasing touches one member stroke;
it does not remove the whole group. Grouping, ungrouping and erasing support undo
and redo and survive project saves and browser recovery.

Groups support up to 100 strokes and 20,000 vector points, and must fit the same
PNG raster limits as individual drawings. Every member still counts toward the
existing 100-overlay budget with other annotations, text and masks. Long gestures are simplified to at most 2,048 points. Large or rotated
strokes must fit the server's PNG limits; reduce the drawing size if prompted.
This version shows each stroke for its full time range; it does not animate the
stroke being written. Older FreeEdit builds may reject projects with drawings.

### Reframe and smart focus

Choose original, wide (16:9), vertical (9:16), or square aspect ratio. Set whole-video zoom/focus, or add **timed Reframe sections** (maximum 20, non-overlapping). Each timed section has its own zoom, focus and easing. Select a section from Edits or the timeline, or use Pick focus in video. Whole-video settings apply outside timed sections.

### Adding a presenter video

1. Upload the main recording, then choose **Videos → Add presenter video**.
2. Place an inset at a corner or select it in the preview to drag and resize it; use numeric positioning and timing for precision.
3. Choose sound from Main, Presenter, Both (with independent volumes), or Muted.
4. Preview a short combined sample; export to apply all other edits.

FreeEdit supports **one main recording and one presenter inset**, not an arbitrary clip sequence. Save both originals: project JSON contains media identities and settings but does not contain the video files. Combining clips creates an intermediate encode and needs extra disk space.

### Person-aware backgrounds

Background effects are optional and need `./setup-background.sh`; noise removal and ordinary edits do not need that extra environment.

| Effect | Controls |
| --- | --- |
| Original | No segmentation |
| Blur | Blur strength |
| Solid color | Background color |
| Image | Built-in styles or a custom PNG/JPEG/WebP |

Use **Camera area only → Draw camera area** to constrain the effect to a webcam region. Camera rectangles are fixed; FreeEdit does not track moving people or camera windows. A short rendered preview lets you inspect segmentation before committing to a full export.

Segmentation works best with a single clearly visible person. Hair, transparent objects, low light, or fast movement may cause halos/flickering. This feature is **not a privacy guarantee**.

## Which preview should I use?

| Preview | What it checks | Scope |
| --- | --- | --- |
| Editing preview | Timing, cuts, text, masks, annotations, Reframe | Interactive original playback; processed audio/background are not shown |
| Audio → Preview noise removal | Original versus cleaned audio | Up to 10 seconds at playhead, without visual edits |
| Background preview | Person segmentation and chosen background | Short rendered sample, without other edits |
| Videos → Preview combined video | Presenter location, background, sound | Short sample; excludes other timeline edits |
| Export → Preview result | Visual edits, cuts, processed audio/background and sound together | Up to 15 seconds around range or playhead |
| Completed export | The entire rendered recording | Review before sharing |

Editing during an export changes the next export, **not** the request already in progress. The result is marked as outdated if the edit document changes afterward.

## Output formats

| Preset | Result |
| --- | --- |
| Balanced | H.264/AAC MP4, CRF 23 |
| Small file | H.264/AAC MP4, CRF 28, up to 1280 px on longest side |
| High quality | H.264/AAC MP4, CRF 18 |
| Audio only | 48 kHz 16-bit PCM WAV |

All video modes re-encode and use even dimensions. Audio-only excludes visual edits. Optional speech leveling and audio fades can be enabled during export.

## Keyboard and accessibility

| Key | Action |
| --- | --- |
| `V` | Edits / Select |
| `H` / `T` / `X` | Hide area / Text / Cut |
| `Space` | Play or pause |
| `←` / `→` | Step a frame (`Shift`: one second) |
| `I` / `O` | Mark range start / end |
| `Esc` | Clear selection/draft |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |

Shortcuts do not activate while typing in fields or dialogs. Small screens stack the editor and inspector. There are numeric position/timing controls if drag interactions are inconvenient.

## Projects and temporary recordings

Choose **⋯ → Save project** to download an editable `.freeedit.json` file. Version 2 stores the edit document, preview/settings and source fingerprints—not original recordings or exported media. Keep your input files and reconnect them when reopening a saved project. Project v1 is intentionally unsupported.

Browser recovery is best-effort and tied to the same browser/site. Multiple tabs have a takeover mechanism; recovery is not a backup. An active anonymous server session can expire, and cleanup deletes temporary files.

See [development and troubleshooting](DEVELOPMENT.md) for optional feature setup, [deployment and limits](OPERATIONS.md) for resource constraints, and [security](SECURITY.md) for privacy boundaries.


### Duplicate edits and reuse styles

Select an edit and use **Duplicate**, **Copy style**, or **Paste style** in its inspector. Duplicate uses a fresh identity and retains the edit's content and timing. A timed Reframe duplicate is placed immediately after its source, and requires enough free time there. Drawing groups are copied independently, including all strokes.

Use **Cmd/Ctrl+D** to duplicate, **Cmd/Ctrl+Shift+C** to copy style and **Cmd/Ctrl+Shift+V** to paste style while the editor has focus outside an input. Style paste requires compatible edit types (and annotation kinds), and preserves content, geometry, timing and identity. Drawing groups require matching stroke counts and transfer per-stroke color, opacity and width. Cuts support duplication but have no appearance to copy. Undo/redo covers duplication and style paste.

### Canvas backgrounds and framing

Open **Reframe → Canvas background and framing** and enable framing. Choose a matching, wide, vertical or square canvas; adjust padding, corner radius, shadow and background color, or upload a background image. Uploaded images are automatically resized to fit the PNG asset budget; remove an image to reveal the color again. Frames fit within the current output dimensions without enlarging the video.

Framing wraps the completed composition after Reframe, including the presenter, text, masks and drawings. Opening the canvas framing controls shows the finished frame immediately. Opening a whole-video or timed Reframe control shows its source crop guide instead. Edits retain their source coordinates. Framing is included in project files, browser recovery, undo/redo, rendered previews and video exports. Audio-only exports omit framing.


### Cursor spotlight and click highlights

Open **Annotations** and choose **Cursor spotlight** or **Click highlight**. Click the recorded pointer or action in the video, or use **Place spotlight/click highlight at center**. Uploaded videos do not provide pointer events: these effects stay at the position you choose until you move them. To highlight a moving pointer, add separate timed effects at its important stops.

A spotlight keeps an oval area clear and dims the surrounding recording. A click highlight shows a colored ring, translucent center and center dot; its initial duration is 0.7 seconds. Select either effect to adjust its color, opacity (background dimming for spotlight), rotation, size and original-source start/end times. Drag the effect to reposition it, use its lower-right handle to resize, or enter precise coordinates in **Position and size**. Fade is the default; choose None for a static effect. Spotlights support Fade or None, while click rings also support Slide.

These are ordinary annotation edits: their timeline blocks support movement and trimming, and duplication, compatible style paste, delete, undo/redo, project save/load and browser recovery work as usual. Cuts remove the corresponding effect time; Reframe and canvas framing transform the recording and effects together. Video exports and processed range previews use the same timing; audio-only output omits the effects. Up to eight spotlights fit in one project, within the existing visual-edit limit. Each spotlight mask is rasterized with a maximum side of 1024 pixels and scaled to the source canvas during export to keep saved assets bounded.


### Audio mute and volume regions

Open **Audio → Mute and volume regions**. Enter a source-time range or choose the current playhead/selection, set a volume from 0% (mute) to 200%, and set a boundary fade from 0 to 0.25 seconds. Use **Mute range** for silence or **Add volume region** for a level change. New volume regions default to 50% and 0.05-second fades; mute regions default to 0% with the same fades.

Select a region to edit its volume and fade. Drag its teal block in the Volume timeline track to move it, or drag either edge to change its range. Regions use original-recording timestamps, so cuts, source seeking and result previews remain aligned. Overlapping gains multiply and total gain stays at or below 200%; the limiter protects boosts from clipping. Speech leveling runs before the region changes, so it cannot raise a muted or quiet passage again. Final export fades still apply at the start or end after cuts.

Regions apply to the selected sound mix, including presenter audio when present. The source player remains unchanged. Choose **Hear edited audio** to render the same settings as a processed result preview. Regions are saved with the project and browser recovery, support duplicate/copy style and undo/redo, and work in video and audio-only exports. A project supports up to 50 regions. The noise-removal sample is a short denoising comparison and does not include volume regions; use the result preview to hear those changes.

## Speed up or slow down a range

Open **Speed** in the task rail. Enter **From** and **To** times directly, or position the playhead and click **Use playhead** beside either field. Optionally select a timeline range and click **Set speed** or **Use timeline selection** to fill both fields. Enter a multiplier from **0.25× to 4×** and apply it. A Speed block appears on the timeline; select it to edit its multiplier and boundaries, or delete it to restore normal speed. Up to 20 speed ranges are supported; ranges cannot overlap.

Audio pitch is preserved. Cuts, captions, annotations, volume regions and presenter footage keep their original source-time positions and are retimed together in the result. The timeline continues to show source time; Final shows the resulting duration. Undo/redo, saved projects and browser recovery include speed changes. Use Preview result for the fully processed sound and video; the editor player also follows each range's playback speed.
