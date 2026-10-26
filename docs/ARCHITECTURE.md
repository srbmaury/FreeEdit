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

## Frontend module boundaries

The app remains a lightweight static application with no bundler or framework dependency. Native browser modules are introduced at independent boundaries:

- `api-client.mjs` owns JSON transport, timeout defaults, caller cancellation signals, API error formatting and request references. The classic `api()` adapter delegates to it, preserving feature call sites while removing transport implementation from editor state.
- `scene-schema.mjs` owns background and presenter project rules, independent of the DOM. Project validation imports these directly. Live presenter validation uses the same rules, initialized before uploads can open an editor.
- `source-identity.mjs` owns full-file chunk hashing without editor or storage dependencies; both main and presenter uploads use it.
- `project-schema.mjs` validates and normalizes plain project data. It imports pure scene-validation rules and receives its editor-model dependency explicitly. It reads no DOM, browser storage or live editor state. `projects.js` owns file selection, recovery and downloads, and awaits schema validation before using imported data.

Uploads wait for editor adapter registration (`DOMContentLoaded`) before accessing later feature scripts. Recovery also awaits the schema module and checks that a new upload/project has not started in the meantime. Save project captures a data snapshot and source name before asynchronous validation; completion updates the UI only if the same recording remains open.

Module assets use a JavaScript MIME type and revalidation headers, including `.mjs` files. CI syntax checks cover both classic scripts and native modules.

This is an incremental migration. Feature adapters still share classic-script state and callbacks; the editor model is still explicitly injected into project validation during this transition. Scene rules now have direct module dependencies. Further slices should move these pure rules into modules, then separate shared state ownership and feature initialization. A single full-framework rewrite is not required.

## Media analysis boundary

`backend/waveform.py` reduces a PCM stream to a bounded envelope with fixed 64 KiB reads. It has no FFmpeg, process or disk dependencies. `pipeline.audio_waveform` owns decoder lifecycle, timeout, cancellation and error translation. Decoded waveform audio is no longer spooled to disk. Focused tests cover fragmented sample boundaries, partial bins, source-time padding and read-size bounds.


## Review follow-up invariants

All editor creation paths (manual edits, captions, pause cuts and timed Reframe) check `EditorModel.limitError` before IDs, undo or document state are changed. The same rule validates saved projects: 200 combined objects, 100 cuts, 100 masks/text and 20 Reframe portions.

Export admission returns a server submission identity. Browser recovery stores that identity with the original document signature and retained-time ranges, independently of later edits. Resume uses those values only when the job's identity matches. Missing or mismatched metadata leaves the export stale and disables source/result timing comparison rather than inventing matching settings.

Authorized status/media reads refresh retention at most every 30 seconds. A visible editor (or playing source) sends a status heartbeat every minute, including when paused and fully buffered. Unauthorized reads cannot refresh another session's files.

Audio-only presenter rendering calls a lossless sound mixer with the shared timing, volume and sound-source rules. It does not render the inset or generate segmentation masks; noise reduction, cuts, leveling and fades then run on the mixed audio.

## Export state ownership

`export-state.mjs` owns pure retained-range construction, source/result time mapping and recovered submission validation. It receives plain values, never reads the DOM or current editor document, and returns a copied submission snapshot. `editor-history.js` adapts these rules to comparison controls; `projects.js` owns recovery storage and waits for module initialization; `editor-export.js` owns submission and polling. This is a bounded extraction, not a claim that all feature globals have been removed.

The optional About identity is a server-start snapshot. `runtime_info.py` fingerprints backend/frontend source and records Git metadata when available. The endpoint omits local paths. `launch.py` prints local checkout/runtime paths to the terminal and diagnoses a busy port before running preflight. Runtime code is not hot-reloaded; static-file changes still require a restart to avoid mixing frontend and backend revisions.

Recovery now defers its storage write until document, full-export identity and preview identity are restored together. A completed full export reconnects its result/download controls. Result previews receive an independent server admission ID; their submitted document signature is saved separately from later edits. Reconnected previews can finish or reopen after completion. Unknown identities remain reviewable with explicitly unverified/stale settings instead of being labeled current.
