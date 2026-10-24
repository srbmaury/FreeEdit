# FreeEdit feature roadmap

Status: proposed, 24 October 2026. This plan covers new editing capabilities; it does not authorize implementing every item at once. Keep the tool focused on cleaning up and presenting screen recordings. No backward-compatibility work is needed while there are no users.

## Current implementation

- Cuts, timed text, privacy masks, SRT import, waveform and pause detection exist.
- Timed Reframe portions have zoom, focus, timing, smooth transitions, dashed draft guides, project persistence, and export support. They are sections with fixed target settings, not arbitrary editable keyframes.
- Cuts/text/masks support timeline dragging and edge resizing. Reframe blocks currently select a section; moving/resizing them on the timeline is missing.
- Two-video composition supports a main recording plus presenter inset, presenter background effects, and main/presenter/both/muted audio. Sequential clip assembly is missing.
- Whole-video aspect ratios and quality presets exist. Platform-specific framing/encoding presets are missing.
- Source playback, individual processed samples, and a rendered export comparison exist. A combined rendered preview before final export is missing.
- Noise removal exists; audio leveling and fades do not.

## Recommended order

| Stage | Scope | Reason |
| --- | --- | --- |
| 1 | Shared time-range selection, timeline Reframe manipulation, Smart Focus | Largest usability improvement using the current single-source architecture |
| 2 | Combined rendered preview, audio leveling and fades | Makes edits trustworthy and improves spoken recordings |
| 3 | Presentation Mode and export destinations | Distinctive output without building a full general-purpose editor |
| 4 | Sequential clips: split, trim, reorder, join | Valuable P0 objective, but requires a project/timeline architecture change |
| 5 | Callouts, section speed, local automatic captions | Builds on stable timing, preview and project foundations |
| 6 | Transcript editing, cursor automation, moving masks | Higher complexity; require additional timing, detection, and review workflows |

P0 means essential editing value, not equal implementation cost. Do not start all five P0 features concurrently. Sequential clips are a separate milestone despite their P0 priority.

## P0 requirements

### 1. Drag-to-select timeline ranges

Create a shared `selection: {start, end}` on the original timeline. A click seeks; a drag beyond a small threshold creates a range. Keep edit-block dragging distinct from range creation. Support zoomed/scrolling timelines, touch/pointer cancellation, keyboard adjustment, Use playhead, and numeric entry.

Offer a compact contextual action row: **Cut**, **Reframe**, **Preview range**, **Clear**. Disable actions that require video for audio-only files. A draft selection is view state, not a destructive edit or undo step.

Acceptance: drag in either direction; select near boundaries; scroll/zoom without losing time accuracy; apply the same range to Cut or Reframe; Escape clears it; merely selecting removes nothing.

### 2. Timeline-editable zoom sections, followed by keyframes

First extend the existing Reframe track to move portions and resize either edge, with the same timing validation and undo behavior as other blocks. Expose transition duration in the selected properties; constrain it to half the section duration. Keep overlaps rejected with a visible explanation.

Then add explicit keyframes only if needed: source timestamp, zoom, focus X/Y, and easing. Distinguish a range/section from a keyframe point in the UI and model. Define interpolation and boundary behavior once for browser and renderer. Do not label the existing fixed-target portions as arbitrary keyframes.

Acceptance: moving/resizing a portion updates Edits, preview, saved project and export together; one drag is one undo step; no overlaps or invalid durations; transitions match the renderer.

### 3. Audio leveling and fades

Add a collapsed Audio section for **Level speech volume**, output loudness/peak targets behind Advanced, and fade-in/fade-out duration. Start with deterministic normalization and explicit boundary fades; avoid claiming that normalization alone evens every quiet/loud phrase. Define a separate dynamic leveling option if required.

Document processing order: choose/mix sound sources, noise removal, retained timeline, leveling, fades, encode. Decide whether fades apply only at output ends or at each joined clip; use small transition ramps at cut boundaries where necessary. Prevent clipping and excessive gain on near-silent input.

Acceptance: audio samples and final preview use identical settings; cuts and source-volume mixing remain aligned; fades fit short outputs; audio-only export works; no-audio media exposes no ineffective controls.

### 4. Accurate combined final preview

Add **Preview result** for a selected range or a short range around the playhead. Use the same backend composition and rendering path as export, including presenter, backgrounds, masks, captions, Reframe, cuts and audio processing. Offer original/result comparison and cancellation. Label the processed interval and quality clearly.

Cache by source identities, complete edit/settings signature, range and renderer settings. Invalidate on every material change. Keep source-time to output-time mapping explicit for cuts, later speed changes and sequential clips. Download remains an export action; preview does not require rendering the entire recording.

Acceptance: the selected rendered preview agrees with that interval in final export; changing an edit marks old samples stale; removed-only ranges explain why there is nothing to preview; errors/cancel preserve edits; temporary preview media is cleaned up.

### 5. Split, trim, join and reorder sequential clips

Introduce a source library and ordered clips referencing immutable media. Each clip stores source ID, in/out times, output placement and sound settings. Preserve presenter composition as a layer distinct from sequential clips. Initially use hard cuts and a fixed output canvas; avoid adding transitions and unrestricted layering in the first milestone.

Resolve timeline semantics before coding: source time per clip, project/output time, clip-local edits, captions, Reframe, pause suggestions, and repeated use of the same source. On split, split/rebase timed edits without losing them. Reordering moves attached edits with the clip. Save source fingerprints and relink every required recording when reopening.

Acceptance: import at least three recordings; split, trim, reorder and remove clips; undo each operation; render mixed resolutions/frame rates and audio/no-audio inputs; define duration and timestamp mapping; reopen with relinked sources; bound intermediate storage and cancel processing safely.

## P1 requirements

| Feature | Initial scope | Dependencies / acceptance |
| --- | --- | --- |
| Smart Focus | Click a point or draw a rectangle in the source preview; create a timed Reframe portion with computed zoom/focus and smooth boundaries | Range selection and existing crop geometry. Clamp to aspect/zoom limits; dashed guide and exported focus agree. No automatic cursor tracking in v1. |
| Presentation Mode | Fixed canvas with gradient/image/color background, padding, rounded recording corners and shadow | Combined preview. Keep decorative canvas separate from person-background segmentation. Apply the same geometry to preview/export; offer a few restrained presets. Animated scenes come later. |
| Arrows, circles and callouts | Timed vector overlays with color, thickness, position and label | Shared overlay schema/renderer, timeline, undo and project persistence. Separate callouts from privacy masks. |
| Playback speed per section | Explicit section speed with clear duration change and pitch-preserving audio | Project-time mapping; avoid conflicting speed ranges. Show original and output duration; rebase captions/Reframe correctly. |
| Automatic captions | Optional local speech model, language choice, progress/cancel, editable cues | Establish licensing, model download/size, CPU performance and supported local runtimes before choosing a model. Preserve SRT import; no account required. Export results match edited cues. |
| Export destinations | YouTube landscape, Shorts/Reels portrait, square, presentation | Existing aspect and quality presets plus Presentation canvas. Show resulting dimensions and crop/padding choice. Do not silently crop content or claim platform compliance without checking current requirements during implementation. |
| Cursor spotlight / click effects | Manual timed spotlight first; click effects only from supplied event data or explicit markers | Ordinary imported MP4 files usually lack cursor position/click metadata. Pixel-based detection is a separate experimental feature and must not be presented as reliable event capture. |

## P2 requirements

### Transcript-based editing

Build on automatic captions with word timestamps tied to source identities. Search and select spoken text, seek/highlight the matching range, add captions, or propose a cut. Require visible confirmation of the selected interval before applying a cut. Preserve punctuation/word alignment after changes, and show confidence or allow correction where timestamps are inaccurate.

Acceptance: selecting a sentence maps to the correct media, clip and output interval; cuts are ordinary reversible edits; transcript follows clip reorder and speed changes; local transcription remains optional.

### Moving privacy masks

Begin with manually editable rectangle keyframes; consider tracking-assisted suggestions after that. Interpolate bounds in source coordinates, allow corrections and frame-by-frame review, and keep timing attached to the correct clip. Use solid cover by default for private details. Tracking must expose failures rather than imply guaranteed concealment.

Acceptance: masks remain aligned through zoom/crop, cuts, clip reordering and speed changes; save/reopen preserves keyframes; preview and export match; users can inspect the complete affected range.

## Shared implementation rules

- Reuse the existing tools and inspector; do not add a permanent panel or top-level button for every feature.
- Keep simple defaults visible and advanced settings collapsed. Preserve keyboard access and light/dark contrast.
- Define source, clip and output time in one mapping layer before adding speed or sequential clips.
- Use one rendering contract for processed preview and export. Never burn selection outlines, crop guides or editor chrome into output.
- Use versioned project data when the architecture actually changes, without building compatibility migrations for nonexistent users.
- Keep current processing progress, cancellation, retry, storage limits and source-relink flows intact.
- Validate each delivered feature with focused syntax/functional checks and real-media browser checks. Do not add or run a broad regression suite per the current project preference.

## First implementation slice

Deliver range dragging → Cut/Reframe actions → drag/resize Reframe timeline blocks → click/draw Smart Focus. Keep the existing numeric controls as precise alternatives. Complete a browser walkthrough and a short rendered preview/export comparison before starting the next stage.

## Reference status

The supplied competitor descriptions are inspiration, not verified feature/specification claims. No external sites or image-proxy links are required to implement this roadmap. Verify official product information only if a future comparison or parity target depends on it.
