# Choose the right preview

Start with a screen recording, make a small change, and use **Export → Preview result** before a full export. Keep the original recording and download a project file to continue another day.

| Review option | What it checks | Scope |
| --- | --- | --- |
| Editing preview | Placement and timing of cuts, text, masks and zoom | Interactive source playback; audio processing and person-background effects require rendered samples |
| Audio → Preview noise removal | Noise-reduction strength on the main recording | Up to 10 seconds from the playhead; ignores cuts and visual edits; unavailable with a presenter |
| Background preview | Person-background settings | Short rendered sample; use a result preview to check the complete edit |
| Videos → Preview combined video | Presenter placement, presenter background and chosen sound sources | Three seconds; main-background effects, cuts, text and privacy masks are excluded |
| Export → Preview result | Export settings, cuts, captions/text, masks, zoom, backgrounds and sound together | Up to 15 seconds from the selected range or playhead; Original/Result comparison follows retained time |
| Export file | The complete rendered recording | Review the output before sharing; later edits require another export |

## Select and review a section

Drag across the waveform or ruler, or seek to a start and press **I**, then seek to an end and press **O**. The range actions offer **Play range**, **Cut range**, and **Reframe range**. Cut and Reframe first fill a draft; the document changes only when you add it. Escape clears a draft range. Numeric timing fields remain available for precise adjustments. Keyboard editing shortcuts do not run inside input fields or dialogs.

Select an existing edit from the timeline or **Edits (V)**. Drag it to move it, drag its edges to resize it, or use its inspector fields. Undo reverses document changes. A selected Reframe portion shows the dashed crop guide; **Pick focus in video** places the focus directly.

## Captions and optional processing

**Captions** imports an existing SRT file as editable text overlays; it does not transcribe speech automatically. Ordinary cuts, text, privacy masks, captions and Reframe need FFmpeg. Noise removal additionally needs the DeepFilterNet environment; person-background effects need the separate background environment. Use **⋯ → Check setup** for availability and the setup documentation for installation.

For audio-only exports, choose Main, Presenter or Both in Videos. Video layers and background effects are excluded, including presenter segmentation. Cuts, selected sound sources and audio finishing still apply.

## Know what was exported

Editing during export affects the next export, not the request already submitted. If edits differ, the completed result shows **Edits changed**. Browser recovery preserves the submitted export's identity and timing separately from current edits. If that identity is unavailable, timing comparison is disabled instead of guessing. Save a project file for durable recovery; it contains edits and source identities, not the recordings.
