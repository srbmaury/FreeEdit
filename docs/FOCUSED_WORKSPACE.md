# Focused workspace UI

Based on main commit e179ffa53399655e46c17bf9f676f705fc338e3c.
Feature branch: design/focused-workspace.

## What changes

- Desktop: task rail, recording preview, one focused inspector, full-width timeline beneath preview and inspector.
- Tasks: Videos, Audio, Pauses, Background, Cut, Text, Hide area, Export. **Select (V)** lives in the preview toolbar instead of the task rail.
- The inspector shows **Your edits** until an edit is selected, then **Edit properties**. On desktop the Select inspector fills the right-hand column, with the edit list scrolling within the available height rather than stopping at 48vh. On narrow screens the list expands naturally in document flow. Using Select preserves presenter-inset positioning.
- Original edit controls, timeline lanes, waveform, upload, project recovery, save/open, themes, processing APIs, and output comparison remain connected to their existing handlers.
- Background retains blur/color/image choices, built-in and uploaded images, fixed camera inset selection, numeric region fields, and the real three-second processed sample from main.
- Undo/redo and an export shortcut sit next to preview actions.
- Processing progress, Cancel, errors, references, and replacement-file recovery remain visible independently of the active inspector.
- Audio-only files disable background/text/hide; silent videos disable audio/pauses.
- At 850px and below, the task rail wraps above the preview; timeline and inspector stack below it.
- Explicit light/dark foreground pairs improve secondary labels, selected controls, disabled controls, primary actions, badges, and timeline text.

## Integration

No build step or new production dependencies. Run FreeEdit normally with `./run.sh`.
The two new files are frontend/workspace.css and frontend/workspace.js; index.html loads them after the existing styles and scripts. app.js dispatches six lightweight workspace events at mode/selection/upload/export transitions.

If applying the accompanying patch to your own checkout:

```sh
git switch main
git pull --ff-only
git switch -c design/focused-workspace
git apply --check /path/to/FreeEdit-UI.patch
git apply /path/to/FreeEdit-UI.patch
./run.sh
```

The patch targets the base commit above. If main has changed, review/apply conflicts without overwriting newer features. To undo before committing, restore app.js and index.html and remove workspace.css, workspace.js, and this document.

## Validation and limits

- JavaScript syntax checks and git whitespace/conflict checks pass.
- A DOM harness loaded the actual frontend scripts and checked initialization, switching inspectors, background blur, camera region and draw mode, text placement, cut creation, undo/redo, export visibility, persistent processing area, and audio-only/silent-video availability.
- Checked representative text/background contrast pairs numerically: light secondary 6.06:1, dark secondary 7.71:1, light primary 5.89:1, dark primary 7.84:1, timeline labels at least 6.66:1.
- Browser rendering and real media processing were not validated in this environment: the browser runtime download failed. The DOM harness uses media/canvas stubs and does not establish visual correctness, full accessibility compliance, noise-removal quality, or segmentation quality.

Before deployment, check a real recording at desktop and 320/390/768px widths in both themes; test camera-region dragging, background preview, pause audition/cuts, text/masks, export cancel/retry, download and original/exported comparison. Verify no page-wide horizontal overflow and that numeric position/timing fields remain visible.
