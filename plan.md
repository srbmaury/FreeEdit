# FreeEdit feature roadmap

Status: in progress, 25 October 2026. Primary audience: screen-recording cleanup and polished demos. Keep the tool focused on cleaning up and presenting screen recordings. No backward-compatibility work is needed while there are no users.

## Current implementation

- Cuts, timed text, privacy masks, SRT import, waveform and pause detection exist.
- Timed Reframe portions have zoom, focus, timing, smooth transitions, dashed draft guides, project persistence, and export support. They are sections with fixed target settings, not arbitrary editable keyframes.
- Cuts/text/masks and Reframe portions support timeline dragging and edge resizing.
- Waveform/ruler range dragging transfers to Cut or Reframe drafts, with source-range playback and Clear/Escape.
- Point-pick Smart Focus positions draft and saved portions using the existing crop geometry.
- Two-video composition supports a main recording plus presenter inset, presenter background effects, and main/presenter/both/muted audio. Sequential clip assembly is missing.
- Whole-video aspect ratios and quality presets exist. Platform-specific framing/encoding presets are missing.
- Source playback, individual processed samples, and rendered export comparison exist. A bounded combined result preview is implemented and browser-validated.
- Noise removal, restrained speech compression/leveling, and output-end fades are implemented. Target-LUFS normalization and per-cut ramps remain separate future work.

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

## Quality milestone — delivered and remaining

Delivered: grouped app menu with offline icons/keyboard navigation; visible limits documentation; draft timeline range selection and Cut/Reframe reuse; source-range playback; direct Reframe movement/resizing and undo; point-pick focus; finer scrubber increments.

Browser verification uses the supplied short screen recording: select a waveform range, transfer it to Reframe, add it, pick focus, move the section, resize it and undo, transfer the same range to Cut. Export is checked with both edits active. The film audit remains evidence of the existing 100-result cap, not evidence of unrestricted movie editing.

Still needed before a 9/10 claim: Presentation Mode, representative compatibility/long-file profiling, first-use feedback from target users, and release documentation that matches the deployed app. Rectangle-draw focus and fully editable point keyframes remain future extensions. Do not equate completing this first milestone with achieving the target score.

## Stage 2 implementation — 25 October 2026

Implemented: shared preview/export rendering contract; selected-range/playhead result preview capped at 15 seconds; retained-time Original/Result comparison; cancellation; identical-request caching and presenter replacement invalidation; stale-preview indication; audio-only samples; collapsed speech compression/leveling and output-end fades; project save/restore of audio settings.

Focused real-media request checks passed for a preview combining a privacy mask, timed Reframe, cut, leveling and fades; cached-media reuse; full export duration; cut-only-range rejection; audio-only preview; and presenter mixing. Browser checks with the supplied recording passed for processed playback, Original/Result switching, selected-range preview across a cut, cancellation, stale-preview notices, file-based project reopening, browser recovery with audio settings restored, audio-only preview, and full export. Preview layout was checked in dark and light themes; the player leaves room for the close/editing controls on short windows. A sparse-frame seeking bug found during browser QA was fixed: keyframe preroll supplies the held frame at the selected start, preserving the expected four-second result for a five-second selection with a one-second cut. Startup recovery now waits for the background/presenter validation helpers. Python compilation, JavaScript syntax and whitespace checks pass. Presentation Mode and sequential clips have not started.

## Reliability and large-file follow-up — 25 October 2026

Delivered changes: pause-analysis source ranges with selected-range reuse and total-match counts; disk-backed line-by-line analysis logs; bounded FFmpeg error tails; lossless preview-window disk estimates independent of full source size; startup/on-demand checks for required rendering encoders/filters and writable storage. Cut and suggestion review caps remain explicit. This is not a claim of unrestricted movie editing or validated clean-machine installation.

Earlier range-analysis validation (superseded by pagination below): the supplied 2h17m film produced 454 qualifying pauses in a full scan (100 retained), and ranged scans at 30–32 minutes and near the end return original-time suggestions. Browser checks passed for reversed-range errors, whole-recording reset, selected-range transfer, and detection. Generated 244-second audio confirmed the “first 100 of 122” warning; analyzing 200–244 seconds returned the remaining 22 and applying a suggestion created a cut at the correct original timestamp. The setup dialog shows rendering/storage checks, and `preflight --verify-render` passes on this machine. Setup now runs the generated-media check after installation. No fresh-machine installation or full-movie export/memory benchmark has been claimed or performed in this slice.

## Paginated pause review and preview failure handling — 25 October 2026

All qualifying pause results are now stored on disk, with 25-row UI pages and bounded API pages. Selected rows are retained across pages under the existing 100-cut budget; already-cut portions cannot be accidentally applied twice. Page requests are tied to the analysis identity and browser owner. Rerunning analysis replaces selections/results. Preview retry/cancel no longer leaves an old sample claiming readiness, and original/result playback failures have a visible recovery message. Review and audio-finishing controls are consistently locked while processing.

Validation: all 122 generated pause results are reachable without duplicates, including the final page; invalid page sizes, stale analysis IDs, out-of-range pages, and other-session access are rejected. Browser checks passed for cross-page selection persistence, the shared 100-cut limit through both list and timeline selection, applying a final-page cut, already-cut guidance, undo, and retaining results while changing analysis scope. The real film produced 454 disk-backed results with only 25 in the first response. Playback failure/recovery and cancellation status were checked with generated media. Audio-only project saving was fixed by excluding video Reframe settings; saving, relinking and reopening restored the correct cut. Pagination was reviewed in dark and light themes. Focused syntax/compilation/whitespace checks pass.

## Frontend dependency cleanup — first slice

Extracted JSON transport and pure project schema validation into native ES modules without a build step or new runtime dependency. Classic feature adapters delegate through explicit imports. Upload initialization waits for adapter registration; recovery awaits validation and avoids interrupting a new file. Project downloads use an immutable snapshot and recording identity across asynchronous validation. Remaining feature globals are intentionally tracked as follow-up work rather than described as a completed full migration.

Validation status: focused checks pass for saved audio/video project normalization without mutation, unsupported-version rejection, live API error metadata, caller abort signals, module MIME/cache headers, updated inspector wiring, JavaScript syntax and Python compilation. Browser validation completed unsupported-project feedback, source upload, timed Reframe and cut edits, video project download, reload/recovery, processed preview readiness, and export submission. Follow-up browser validation on port 8000 passed video project download and file-based reopen with source relinking, two-edit restoration, reload/recovery, combined preview (5.239 seconds), completed export playback (7.755 seconds), and audio project save/reopen with the correct pause cut. Generated audio returned all 122 expected pause matches in paginated results; the supplied short recording showed the explicit no-matches explanation. Replacement warnings were verified. No browser console errors were captured after the fresh load. The asynchronous save guard was exercised through normal saving; a deliberately interleaved recording-switch race was not forced. Focused syntax, inspector wiring, compilation and whitespace checks pass. Remaining evidence gaps: full-movie export/resource profiling, fresh-machine setup, exhaustive cross-browser/accessibility checks, and final background/presenter combinations were not retested in this pass. Minor UX finding: the audio-only empty edit list suggests disabled video tools. This slice remains uncommitted; no merge or push was performed.


## Maintainability and real-file profiling — 25 October 2026

Separated file fingerprinting and background/presenter schema rules into native modules; project validation imports scene rules directly and live presenter checks share the same rules after explicit initialization. PCM envelope reduction is a pure bounded-stream component, with decoder lifecycle retained in the pipeline. Waveforms no longer spool decoded tracks. Focused tests cover fragmented PCM reads, bounds and padding, full chunk identities, unreadable files, invalid scene geometry/trim and independent validation. A real-movie browser check found and fixed ruler pointer capture overriding named tick times.

Real-file measurements and scope are recorded in `docs/LARGE_FILE_VALIDATION.md`. The reproducible opt-in `scripts.profile_media` tool measures waveform, pauses, late preview, cancellation and optional full export. Movie upload/source playback, full pause results, exact 130-minute seek, scene project save/relink/reopen, invalid presenter trim feedback and playable combined preview were validated in the browser. Full export completed in 458.609 seconds with 149.5 MiB sampled process-tree peak RSS and the exact expected duration. Whole-output audio/video decode passed; beginning/middle/end frame anchors and sampled audio alignment passed. The exported MP4 played near its end in the browser, with drag selection still working and no console errors captured. Full-length noise removal, segmentation/composition, 4K and near-cap edit counts remain unverified. No commit, merge or push has been performed.


## Fresh installation, demanding workloads and pending remote squash — 25 October 2026

Fresh isolated main and background environments installed on the existing Mac. Generated render/model initialization passed; model-dependent workloads used those fresh runtimes. System tools, wheel caches and the noise-model cache were reused, so this is not a clean-OS certification. Setup now constrains web dependencies with the fetched lock and initializes the background segmenter before declaring success. Diagnostics distinguish cold initialization timeout from missing runtime and the UI gives probes a longer request budget. MediaPipe's arm64 runtime works but its wheel metadata triggers a platform-tag warning in pip check; this remains documented.

Completed movie-length noise removal (443.631 seconds, 678.8 MiB sampled peak RSS), movie background blur (2096.726 seconds, 249.7 MiB), short 4K60 export/preview (~824 MiB), 200-object dense export and two-minute presenter blur/mixed audio composition. Dense cuts exposed parser-depth failure, fixed with balanced FFmpeg expressions; the advertised 100-cut generated-media test passes. Segmentation cancellation exposed a retained partial mask; cleanup now passes real cancellation and failure/timeout tests. Measurements, installation scope, remaining gaps and raw records are in the validation documents. `scripts.profile_effects` reproduces the model workloads without changing source media.

Fetched remote branches: `origin/main` remains 666e0ce. `origin/hardening/security-ci-reframe` and `origin/refactor/unified-editor-architecture` are whitespace-equivalent to their earlier squash commits 4df6164/eef4bc8. Newly discovered `origin/hardening/production-performance-tests` at 654d25e was applied with `git merge --squash` and the preserved local changes restored without conflicts. Integration fixes ensure unauthorized jobs do not consume operation quota and a presenter upload can use a one-slot upload configuration. Focused admission, rendering, waveform and cleanup checks pass.

The combined candidate is **not committed or pushed**. Browser access was disabled in Work settings before the new branch's playback invalidation, admission feedback, cold setup feedback and current combined editor/export could be validated. The user's requirement to validate affected UI before merging remains outstanding; finish those browser checks before the requested squash commit on main. The older backup stash is preserved.


## Combined candidate browser validation completed — 25 October 2026

Browser access restored. Validated the merged candidate on port 8026 with the isolated model runtimes: all setup checks ready; supplied recording upload; cut + timed Reframe; playable preview and full export; save/download/relink/reopen; undo stale-result feedback and redo ready-state restoration; playback; presenter upload and mixed-audio preview; reload/recovery restoring both edits. A separate localhost server configured with a one-upload session budget showed the expected quota error and retry control. A generated 200-object project (100 cuts, 80 masks, 20 zooms) was imported and exported through the browser. Focused checks remain passing. No new remote changes appeared on the final fetch. The requested single squash commit on main combines this validated local work with origin/hardening/production-performance-tests at 654d25e. Older remote branches were already included through earlier squash commits; no duplicate merge is needed. No push requested.


## Review findings fixed — 26 October 2026

Implemented shared pre-mutation edit limits for manual cut/text/masks, captions, pause batches and timed Reframe; project-file validation uses the same limits. Rejections preserve the existing document, IDs and undo. Export submissions now carry a server identity, and recovery persists the original submitted signature/ranges separately from current edits; unknown or mismatched submissions remain stale and timing comparison is disabled. Authorized media/status reads extend activity with throttled timestamps, with a visible-editor/playback heartbeat covering buffered/paused editing. Audio-only presenter exports now mix lossless audio using shared source, offset, trim and volume rules; segmentation and video encoding are skipped.

Focused Node checks cover boundary limits, mutation-free rejection and matching/mismatched export recovery. Focused Python checks cover active versus idle expiry, unauthorized reads, submission identity and real audio-only main/presenter/mixed exports with segmentation/video composition forbidden, plus the affected existing rendering/admission checks. Browser use is disabled in Work settings. The changed UI paths still need browser validation; nothing has been committed, merged or pushed in this slice.

## Product-quality implementation — 26 October 2026

| Area | Implemented / validated in this pass | Remaining scope |
| --- | --- | --- |
| Reliability | 200-object rejection preserves exact downloaded edits and Undo; fresh-context recovery reconnects while an older export continues and later marks it stale; mixed presenter WAV works with blur configured; retention/unauthorized access tested with controlled time; failed queue admission restores state | Broader browser/platform coverage; no 24-hour wall-clock retention run |
| Startup / installation | Checkout/runtime identity in launch output; occupied-port guidance without stopping listeners; source identity and start time in About; free-port launch with optional dependency feedback | Clean OS and other-platform installs; optional runtime packaging issues from installation report |
| UI and clarity | Empty mobile timeline lanes collapse; populated Cut/Zoom/Mask/Text lanes reappear; no horizontal page overflow at 495 px; desktop behavior retained | Target-user usability feedback and broader responsive/accessibility review |
| Editing workflow | I/O range marks use playhead time; range transfer to Cut and Reframe plus undo verified in browser; shortcuts/help updated | Editable point keyframes and sequential clips remain roadmap features, not claimed here |
| Maintainability | Pure `export-state.mjs` owns submission validation, copied snapshots and retained-time mapping; startup module readiness awaited by recovery; focused boundary/mismatch tests | Feature adapters still share editor state; no full migration claimed |
| Large files | New reproducible 100-PNG overlay workload and full decode passed; prior full-movie measurements preserved | Lower-memory hardware, real 4K recordings, non-stereo audio, disk exhaustion and independent perceptual quality review |
| Feature usefulness | Preview guide distinguishes sample scope; caption import explicitly excludes automatic transcription | Validate guidance with actual target users; avoid adding features solely to raise a score |
| Release readiness | Read-only fetch: only origin/main, zero ahead/behind; no open PRs returned; readiness checklist and proposed squash summary recorded | User-authorized commit/push, CI on that commit, version verification after restart; bundled-model redistribution questions remain open |

Focused validation: 13 Python tests across activity/composition/startup and six Node tests across export state, edit admission/recovery and keyboard range geometry pass. Browser tests ran against an isolated current-source server; existing user servers were kept running. A new browser context was used for in-flight recovery because the app intentionally warns before leaving during processing; this is not described as a completed forced reload test. A first attempt using concurrent independent servers on the same hostname encountered shared-cookie session replacement; switching the test to localhost isolated it from the user's 127.0.0.1 instance. The setup documentation now explains that behavior.

No commit, merge or push was performed. The earlier backup stash remains intact. See `docs/RELEASE_READINESS.md`, `docs/PREVIEW_GUIDE.md` and the workload/installation validation documents for evidence and explicit gaps.

Final-source launch also passed on localhost:8031 with source ID `64efd724b4a2`; all setup probes reported ready with the configured optional noise runtime. The supplied recording passed combined preview (4.755 seconds from the playhead), full export (7.755 seconds after a one-second cut), Original/Result switching, and return to the two-edit inspector with no console errors. Port 8000 was not restarted. Source identity covers code at startup; documentation-only evidence updates afterward do not change it.

## Recovery completion follow-up — 26 October 2026

Implemented the three review findings: completed-export result/download restoration, independent result-preview admission identity and pending-preview recovery, and deferred recovery persistence until all metadata is restored. Preview descriptions distinguish current, changed and unverified settings. Nine focused Node checks and five Python activity/admission checks pass, along with syntax/compilation/whitespace checks.

Browser evidence: a generated 15-second 4K60 result preview was started, resumed through a fresh browser context while processing, and opened on completion with readyState 4, no media error and duration 14.979 seconds. Screenshot: `/tmp/freeedit-recovered-preview.png`. The later completed-export resume attempt fell back to locating the source. Its cause was not established before browser access was disabled in Work settings. Existing independent localhost servers can overwrite each other's session cookie; that is a possible explanation, not a verified diagnosis. Completed-export/finished-preview restoration and the latest preview-status wording still require dedicated browser validation with an isolated hostname/session before merge. No commit, merge or push was performed.

## Independent review fixes — 26 October 2026

Fixed all five findings: CI browser project round-trip now awaits asynchronous validation; CI discovers `test_*.mjs` alongside CommonJS tests; session cookies use signing-key namespaces so independent local servers do not overwrite each other's authorization; directory creation is inside upload reservation cleanup; audio finishing, denoise and strength now participate in ordered undo/redo with visual edits. History restoration restores controls before publishing the document change, and focus-listener checkpoints remain supported.

Validation: 20 focused Python session/admission/rate-limit checks pass, including two distinct signing-key instances accessed through the same cookie jar and repeated directory-creation failures without leaked slots. All 29 frontend tests pass under the updated CI discovery command, including new audio/visual interleaved undo/redo and DOM-focus checkpoint coverage. JavaScript/Python syntax and diff whitespace checks pass. The browser smoke invocation is fixed but the browser job itself was not executed: local browser access remains disabled in Work settings. Audio undo UI, independent-instance browser behavior, and the earlier completed-export/finished-preview recovery checks remain pending before merge. Nothing was committed, merged or pushed.

## Stability milestone and movie acceptance — 26 October 2026

Fixed the two findings from the second independent review: stale asynchronous project recovery cannot replace a new project/upload/editor session; prior completed export downloads remain available during previews/analysis while replacement exports stay protected. Added focused lifecycle tests and extended CI browser smoke to check audio undo/redo and completed-export reload recovery.

Rechecked the supplied Udaan movie through real streamed HTTP and current-source profiling: upload and range reads; 454 pauses through 8,257 seconds; full audio export with cut/leveling/fades and expected duration; a 14-second late video preview combining a mask, timed zoom, cut and finishing; continued old-result download during preview; whole-output decode; bounded-memory analysis and cancellation. See docs/LARGE_FILE_VALIDATION.md and new JSON evidence. Existing full-movie video/ML measurements were not repeated. The source recording was unchanged.

Browser use remains disabled in Work settings. New CI browser checks have not executed here, and current recovery/audio/session-isolation UI validation remains required before merge. No clean-OS/cross-platform or low-memory hardware certification is claimed. These evidence gaps prevent an unconditional 8.5–9/10 release claim despite stronger source-level reliability and real-movie results. Work remains uncommitted/unmerged/unpushed; the backup stash is preserved.
