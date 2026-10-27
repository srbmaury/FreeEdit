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

`history-model.js` owns a pure snapshot codec and retention policy. PNG data
is kept in shared asset tables rather than repeated in each JSON snapshot.
Undo and redo together retain at most 100 entries and 16 MiB of accounted
UTF-16 document/asset payload; object overhead and the live document are outside
that budget. Oldest steps are dropped first. Clearing either stack releases
its unused assets without a separate global asset cache.

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

Browser recovery uses `recovery-store.mjs`, a small IndexedDB adapter with
serialized transactions and immutable queued snapshots. Project saves track
revisions so stale completions cannot report a newer document as saved. Only
the small tab-ownership lease uses localStorage; there is no legacy recovery
migration. Failed transactions preserve the previous snapshot and prompt users
to download a project file.

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
- `export-payload.mjs` owns the document-to-API projection. It receives plain
  document/scene values plus explicit rasterization/model adapters, reads no DOM
  or global state, and returns independent request values. Audio-only exports
  skip visual rasterization. `editor-export.js` reads controls and submits jobs.
- `scene-schema.mjs` owns background and presenter project rules, independent of the DOM. Project validation imports these directly. Live presenter validation uses the same rules, initialized before uploads can open an editor.
- `source-identity.mjs` owns full-file chunk hashing without editor or storage dependencies; both main and presenter uploads use it.
- `project-schema.mjs` validates and normalizes plain project data. It imports pure scene-validation rules and receives its editor-model dependency explicitly. It reads no DOM, browser storage or live editor state. `projects.js` owns file selection, recovery and downloads, and awaits schema validation before using imported data.

Uploads wait for editor adapter registration (`DOMContentLoaded`) before accessing later feature scripts. Recovery also awaits the schema module and checks that a new upload/project has not started in the meantime. Save project captures a data snapshot and source name before asynchronous validation; completion updates the UI only if the same recording remains open.

Module assets use a JavaScript MIME type and revalidation headers, including `.mjs` files. CI syntax checks cover both classic scripts and native modules.

This is an incremental migration. Feature adapters still share classic-script state and callbacks; the editor model is still explicitly injected into project validation during this transition. Scene rules now have direct module dependencies. Further slices should move these pure rules into modules, then separate shared state ownership and feature initialization. A single full-framework rewrite is not required.

## Media analysis boundary

`backend/job_store.py` owns atomic job metadata, startup reconciliation and the
exclusive single-process directory lease. `app.py` persists admission before
worker dispatch, records meaningful transitions and periodic progress checkpoints,
and restores job ownership on startup. Raw progress ticks avoid disk writes until
the next 30-second bucket. Interrupted operations become retryable errors; only
completed outputs are recovered. `sessions.py` stores the signing key on the same
volume unless an explicit environment secret is provided.

`body_limit.py` admits a bounded number of control requests through receipt,
parsing and route completion, with byte and receive-time limits. Media uploads
have separate streaming admission. Disk writes/flushes and upload probing use
worker threads so the event loop can keep serving status and cancellation.

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

## Timed annotation edits

The `annotation` timeline type handles icons, arrows, shapes, callouts and
pictures, with consistent IDs, start/end timestamps, positioning and undo.
`frontend/annotation-model.js` validates shape/style constraints and defines
presets/animation easing. `frontend/annotations.js` renders annotations to
the source-resolution canvas and creates transparent raster assets for export.
`backend/models.py` validates PNG payloads; `backend/pipeline.py` composites
them before cuts, with time-based static, fade or slide settings. Asset imports
are decoded before sending preview/export jobs. Project v2 includes annotation
styles and compact image data as part of the edit document.

Range previews retain complete annotation animation intervals on their local
clock, including negative starts, so preview boundaries do not invent fade/slide
entrances or exits. Fade evaluation uses a shifted nonnegative clock because
FFmpeg rejects negative fade start times. Video cuts use half-open retained
intervals, matching audio trimming and avoiding duplicate boundary timestamps.

## Drawing strokes

Custom drawings are `type: "annotation", kind: "drawing"` edits, not a separate
timeline collection. `drawing-model.js` owns normalized vector points, stroke
width, rotated raster bounds, painting and segment hit testing. `drawing.js` owns
the transient pointer gesture and tool controls. A completed gesture commits one
edit through the store; cancellation discards it. Project validation deep-copies
validated points, while existing history/recovery preserve the document.

The annotation painter handles both live rendering and PNG export. Drawing bounds
include rounded caps after stroke-width changes and rotation, and validation
bounds point count and raster area. Pointer movement decimates long gestures to
keep their endpoint without unbounded document growth. Erasing removes complete
visible strokes; clearing a time range is one document mutation.

Drawing groups remain `kind: "drawing"` annotations with a bounded `strokes`
array instead of `points`. Child strokes contain normalized points, width, color
and opacity; transform, timing and animation belong to the group. Nested groups
are flattened when regrouped. Group creation transforms original points into
source coordinates, preserving rotations and paint order, then normalizes them
inside shared bounds. Ungrouping bakes the current transform and opacity into
independent strokes. An explicit animation shift preserves common slide motion.
Groups deep-copy through project validation and history, and rasterize through
the existing annotation export adapter. Overlay admission counts member strokes.


Canvas framing is an optional scene setting (`framing`), separate from person-background replacement. The validated settings travel through the existing project/recovery, history and export contracts. The live canvas compositor and `backend/canvas_frame.py` use the same bounded aspect/contain geometry; FFmpeg applies the frame after all source-coordinate overlays and Reframe, before cuts. Pillow generates static background/shadow and rounded alpha-mask PNGs; the looped inputs end with the recording to keep cut exports bounded. Framing images count against the aggregate decoded-overlay pixel budget.

Duplicate/style actions use the document mutation boundary. Copies receive fresh IDs and deep-copy drawing strokes. Style transfer uses an explicit compatible-property allowlist, leaving source text, images, drawing paths, coordinates, dimensions and times intact.


Cursor effects reuse `annotation` edits with `kind: "spotlight"` or `kind: "click"`. Position and time are authored manually; no pointer metadata or detection is assumed. The shared canvas painter draws a full-source even-odd alpha mask for spotlights and a local ring/dot for clicks. Spotlight opacity controls outside dimming; its aperture stays transparent. Both reuse the annotation fade clock and source-time preview mapping.

Spotlight PNGs are capped at a 1024-pixel longest side. The export adapter supplies `canvas_size` on their annotation payloads; admission requires it to equal the source dimensions at origin (0,0), allows Fade/None only, and caps these masks at eight. FFmpeg scales their alpha masks to its actual preset-scaled source canvas before applying animation, Reframe, framing and cuts. Encoded masks also count toward the shared decoded-image budget. Projects store editable annotation geometry and style; the raster and `canvas_size` are derived again for each export.


Audio regions are `type: "audio"` timed edits with a linear gain and bounded edge fade. FFmpeg applies their original-source-clock envelopes before cuts; multiple region gains multiply with a 2x cap, then output-clock fades are applied. Speech leveling runs before the envelopes and an audio limiter follows boosts. Range previews shift region boundaries by the selected source start, preserving partial fades. Regions affect the final selected mix, after optional presenter composition, and work on video and audio-only outputs. The API admits at most 50 regions and validates their ranges against the recording.
