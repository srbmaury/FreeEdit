# Using FreeEdit

FreeEdit is a focused screen-recording editor. It keeps edits relative to the **original recording timeline**. This guide covers the editing workflow, media samples, presenter/background effects, and saving projects.

## Typical workflow

Privacy masks remain covered when export resolution is reduced. Regions too
small for blur or pixelation use a solid cover. Always review the exported
recording before sharing sensitive material.

1. Upload a screen recording, webcam clip or audio file.
2. Choose **Audio**, **Pauses**, **Cut**, **Text**, **Hide area**, **Reframe**, **Captions**, **Annotations**, **Background**, or **Videos** from the task rail.
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
