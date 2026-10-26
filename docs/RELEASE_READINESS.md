# Release readiness — 26 October 2026

This is a working-source assessment, not a release announcement. No commit, merge, push or release publication is authorized by this checklist.

## Current evidence

- Fetched remote refs on 26 October: only `origin/main` remains; local main and remote main are both `b6e1ebd34820` (zero commits ahead/behind). The previous feature branches were deleted remotely. GitHub's open-PR query returned no open PRs.
- Current reliability/startup/UX work is uncommitted. The earlier backup stash remains intact. No existing user server was stopped.
- Browser validation: 200-object project rejection and exact project download preservation; current edits restored while an older export continued; completed export correctly marked stale; audio-only mixed presenter export with blur configured; keyboard range transfer to Cut/Reframe and undo; narrow populated/empty timeline lanes; About server identity.
- Focused Python tests cover activity retention, unauthorized reads, export admission identity, failed admission rollback, real audio-only composition and startup conflict handling. Pure frontend tests cover edit limits, recovery identity, retained-time comparison and keyboard selection geometry.
- `run.sh` launch with a free alternate port passed media/rendering/storage preflight and started the server from this checkout. Missing optional denoising packages were reported as CHECK while basic editing remained available. Occupied-port launch returned actionable feedback without touching the listener.

## Before a source release

- [x] Review focused code changes and browser-check keyboard range transfer/undo, recovery, mask/text/zoom lane restoration and playable rendered results. Pointer-drag behavior was not changed in this pass; its earlier validation is recorded in plan.md.
- [ ] Review local changes and explicitly authorize a squash commit/push if desired. Restart from the intended checkout and verify About identity.
- [ ] Verify CI on the resulting commit, rather than treating local checks as remote CI.
- [ ] Review the README, known limits and installation steps in the exact source archive/tag being released. Retain the MIT LICENSE.
- [ ] Keep the remaining hardware, browser and quality gaps visible in the workload documents. Do not advertise a hard memory budget or universal codec support.

## Additional requirements for a bundled binary/container release

The source MIT license is present. Redistribution of optional model weights and bundled native dependencies remains subject to the unresolved inventory and model-terms evidence in [LICENSE_AUDIT.md](LICENSE_AUDIT.md). This pass did not recheck upstream license terms or clear distribution of an image. A source-only workflow that downloads dependencies during user setup must not be described as a verified bundled release.

## Proposed squash summary for review

**Title:** Improve editing reliability, startup identity and timeline access

Preserve submitted export identity during recovery, enforce edit limits before mutation, retain active recordings and skip video processing for audio-only presenter exports. Identify the running checkout, explain occupied ports, add keyboard range marking, collapse empty mobile lanes, and extract pure export timing rules. Include focused tests, browser evidence and explicit workload/setup limitations.

Final local candidate: source ID `64efd724b4a2`, started through `run.sh` on localhost:8031. About matched the launch output. All setup probes were ready with the configured optional noise runtime. The supplied short recording rendered a playable combined preview and 7.755-second full export with a one-second cut and timed Reframe; Original/Result switching passed with no captured console errors. This is local candidate evidence, not a pushed commit or deployed release.

Recovery follow-up: completed-result restoration, preview submission persistence and deferred autosave are implemented and focused tests pass. In-progress preview recovery passed browser validation. Completed-export resume encountered a source-relink fallback whose cause is unresolved; browser access was then disabled in Work settings. Do not mark the recovery follow-up fully browser-validated or merge it until completed-export/finished-preview recovery and current preview-status wording pass in an isolated browser session.

Independent-review fixes are implemented: corrected async browser-smoke project restoration, complete native-module test discovery, per-signing-key cookie names, exception-safe upload reservation cleanup, and audio-settings undo/redo. Focused Python checks and all frontend unit checks pass. Browser access remains disabled; do not treat the corrected browser-smoke source as a passed browser run. Validate audio controls, independent local instances and completed-result recovery before merging.

## Lifecycle and real-movie acceptance follow-up

The delayed-recovery race now checks project identity, original editor session and pending uploads after asynchronous boundaries. Superseded requests return without changing the editor or showing an obsolete relink dialog. Completed exports remain readable during analysis and preview operations; replacement exports still block access while their output is being replaced. Focused tests cover these conditions.

The current-source Udaan API and profiling results are recorded in LARGE_FILE_VALIDATION.md. Streamed upload, complete pause analysis through the final minutes, full audio export, late combined video preview, retained downloads during preview, decoding and cancellation passed. CI browser smoke now includes an audio track, audio undo/redo and completed-export reload recovery; its source passes syntax checks, but it has not been run in this session because browser access remains disabled. Existing source servers were not restarted or replaced.

The current candidate must still pass those UI checks in a browser, then CI on the final commit, before a release-quality claim. No score is guaranteed by completing code tasks. No Git commit, merge, push or release was performed in this follow-up.
