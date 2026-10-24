# FreeEdit UI design

Open **FreeEdit-Design.html** in a browser for the interactive design reference. It includes task switching, import and export examples, appearance switching, and higher-contrast labels. It is a simulation, not a media-processing application. The editable fragment is FreeEdit-Design-Source.html.

The production implementation lives in frontend/workspace.css and frontend/workspace.js, with small hooks in app.js and index.html. Run the app normally with ./run.sh. The reference and production implementation share the preview-first layout; production retains the existing native media controls and the full Background engine from main.

## Layout

Desktop uses a 132px task rail, flexible preview, and a 300px inspector with 20px gaps. At widths below 1100px, rail/inspector shrink to 106px/260px with 14px gaps. At 850px and below, tasks wrap across the top, followed by the preview, timeline, and inspector. All existing waveform, pause, cut, mask, and text lanes remain.

## Color tokens

| Token | Light | Dark |
| --- | --- | --- |
| Page | #f7f8fb | #15171d |
| Panel | #ffffff | #20232b |
| Secondary surface | #f0f1f7 | #2b2f3a |
| Text | #1c1c1a | #ececea |
| Secondary text | #535b6b | #bec5d2 |
| Accent | #5b50d6 | #aaa2ff |
| Accent text | #ffffff | #19152f |
| Border | #e1e4ed | #373c48 |

Selected task labels use the main text color on a subtle accent surface. Colored timeline blocks use white text with dark fills: cuts #a92828, masks #974411, text #23623e. Do not reuse pale accents as body text on pale backgrounds. Disabled controls retain readable text and explicit disabled semantics.

## Components and behavior

- Task rail: Select, Audio, Pauses, Background, Cut, Text, Hide area, Export. Each task reveals one inspector; choosing Cut creates an editable cut using the existing behavior.
- Preview: real source or exported playback, existing overlay canvas, selection/drawing, original/exported comparison, undo/redo and export shortcut.
- Inspector: existing controls are moved rather than duplicated. Selecting an edit reveals its real timing, geometry, font, mask or cut controls.
- Background: original, blur strength, solid color, built-in/uploaded image, full frame or fixed camera region, keyboard geometry fields, three-second processed sample. Audio-only files disable it.
- Audio: enable noise removal, choose strength, listen to original/cleaned 10-second sample. No-audio files disable it.
- Pauses: presets, advanced threshold/duration/padding, audition, selection, applying cuts. Preserve human review.
- Export: presets and actual output limits; duration/summary, progress, Cancel, errors, replacement-file recovery, result review, download.
- Processing controls and errors are outside the switchable inspector so they remain reachable during noise/background/pause/export work.
- App menu retains project save/open, recovery, appearance, shortcuts, storage, setup diagnostics and links.
- Retention text mirrors the server response rather than hardcoding one hour.

## Validation

See ../FOCUSED_WORKSPACE.md for completed DOM/syntax/contrast checks and remaining browser/real-media verification. The implementation has not been deployed. Browser rendering was not verified in this environment.
