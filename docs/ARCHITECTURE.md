# Frontend architecture — FreeEdit

## Design goals

1. One **timeline document** for cuts, privacy masks, text/captions, and timed Reframe.
2. One **mutation boundary** that makes edits visible in the inspector, timeline,
   drawing canvas, exported payload, undo history, and browser recovery.
3. Project files and FFmpeg payloads are explicit, independently validated
   projections of the editor's domain model.
4. Media playback and temporary presenter-video decoding remain separate from
   the persisted edit document. No frontend framework or build step required.
5. No compatibility code for pre-release project-format v1.

## Domain model

`frontend/editor-model.js` defines the edit contract and pure helpers.

```js
// All timed objects use one identity and original-source time range:
{id: 17, type: "cut", start: 4, end: 6}
{id: 18, type: "hide", start: 7, end: 12, x: 40, y: 20, w: 180, h: 70, style: "blur"}
{id: 19, type: "text", start: 10, end: 16, text: "Hello", ...textProperties}
{id: 20, type: "reframe", start: 12, end: 15, zoom: 1.8, focus_x: .5, focus_y: .4, transition: .35}
```

- `S.edits` is the **single source** of timed edits. Captions are timed text.
- `S.selected` is an edit ID regardless of type (no separate selected-zoom
  index that becomes invalid on sorting/deletion).
- `S.reframe` holds only global aspect ratio, zoom, and focus.
- Background, audio processing settings and presenter media are scene/export
  settings, not timeline edits. Presenter decoding state is transient.
- `EditorModel.sections(S.edits)` projects timed Reframe into FFmpeg section
  data; `EditorModel.exportReframe(S.reframe,S.edits)` combines it with
  whole-video aspect and zoom settings.
- `EditorModel.validateReframe` checks ranges, zoom limits and overlaps once.
- `EditorModel.cutRanges` merges cut intervals for preview and export.
- `EditorModel.sorted` orders all edits by their original recording start.

## Store and update flow

```text
  User action in canvas / toolbar / inspector / timeline / Captions
                         |
                   commitEdit(reason, mutation)
                         |
                    checkpoint()  (if new undo step)
                         |
                  editorStore.dispatch()
                         |
       +-----------------+------------------+
       |                 |                  |
  unified Edits      timeline/canvas    export signature
   inspector            preview         + local recovery
       |                 |                  |
       +-----------------+------------------+
                         |
                 explicit export adapter
                         |
              backend validated FFmpeg request
```

The store is intentionally small, observable and synchronous. It keeps the
existing `S` state object so media and workspace controllers can share playback
state while document mutations use one entry point. `edit:property` and
`edit:drag` updates do **not** recreate the user's currently focused input;
structural changes rebuild the edit inspector and timeline.

Undo/redo captures scene settings, timed edits and presenter placement together,
then emits a document change when restored. Project import similarly creates a
validated v2 document and applies it via the store.

## Module map and load order

Classic JavaScript script tags share a global lexical scope. FreeEdit keeps
these in explicit dependency order in `frontend/index.html`, without a build
system:

1. `ui.js`, `media-utils.js`, `editor-model.js` — UI helpers and pure domain logic
2. `app.js` — core state, upload, media playback, preview sizing and transport
3. `editor-render.js` — rendering, hit-testing and canvas pointers
4. `editor-edits.js` — edit commands, selection, inspector and shortcuts
5. `editor-history.js` — undo/redo, review mode and signatures
6. `editor-export.js` — translation to backend schema and FFmpeg process status
7. `editor-session.js` — file reset, cancellation and processing controls
8. `silence.js`, `timeline.js`, `projects.js`, `noise-preview.js` — focused UX
9. `background.js`, `videos.js` — separate optional media composition features
10. `workspace.js`, `reframe-captions.js` — responsive workspace and timed zoom

Scripts attach event listeners at load, but execute cross-module interactions
only after user actions or media events (after the full script bundle loads).
Direct handler references registered before another module loads must be wrapped
in lambdas to avoid early `ReferenceError` exceptions.

## Project schema v2

Project files store `format: "FreeEdit", version: 2`, a cryptographic identity
of the unchanged original recording, `edits`, scene settings, and a playhead
view. File bytes are intentionally never embedded. The old v1 structure with
`settings.reframe.sections` is rejected instead of silently migrated.

The backend API has **not** changed: the frontend export adapter sends cuts,
text/masks, and Reframe sections in the established FastAPI `ProcessRequest`
shape. This isolates backend compositing from frontend UI storage decisions.

## Tests and invariants

- Node unit tests assert unified edit selectors, dispatch/subscription,
  overlapping Reframe validation, preview easing and export projection.
- Python tests generate synthetic media, exercise FFmpeg composition and
  timestamp-preserving Reframe across cuts.
- Playwright exercises upload, timeline editing, project v2, and export in a
  real Chromium browser with JavaScript-error collection.
- GitHub Actions runs these checks on pull requests.

Never add another parallel `selected<X>` or `<feature>.sections` collection
for a timed edit. Add a new edit type to `EditorModel.TIMELINE_TYPES`, its
inspector and renderer, project validation, and its backend payload projection.

## Remaining modernization opportunities

This release deliberately avoids a framework migration: it keeps the lightweight
static application and its no-build deployment, rather than adding a bundler as
an end in itself. Future work may convert classic scripts to ES modules with
explicit imports, after integration coverage exists for every feature.
