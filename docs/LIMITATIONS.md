# Current limits and long recordings

FreeEdit currently targets focused recording cleanup. Upload streaming and HTTP byte-range playback do not imply unrestricted project size or full movie-editor support. This document describes the implementation as of 24 October 2026; runtime configuration may impose lower limits.

## Project and analysis limits

| Area | Current limit | Consequence |
| --- | --- | --- |
| Pause suggestions | 25 per UI page; API pages at most 100 | All qualifying matches are stored in a temporary disk file. Previous/Next reaches later results; no first-100-result truncation. The browser keeps the current page plus up to 100 selected rows. Source-time range analysis remains available. |
| Cuts | 100 total | Applying pause cuts checks existing cuts too. Selections across pages share this budget. |
| Text and privacy overlays | 100 combined | Captions count as text overlays. |
| SRT captions | 100 usable cues; input under 1 MB; each cue at most 240 characters and four lines | Movie-length subtitle files will commonly exceed this limit. No automatic caption generation exists. |
| Reframe portions | 20, non-overlapping | Each portion has a fixed target zoom/focus and transition, not arbitrary keyframes. |
| Zoom | 1×–3× | Applies to whole-video and portion reframing. |
| Project JSON | 2 MiB | Project files store edits and source identities, not the recordings. Keep and relink the original media. |
| Composition | One main video plus one presenter inset | Sequential clip joining/reordering is not supported. |

These caps bound UI work, request size, rendering expressions and filter-graph complexity. The exact values are product/implementation choices, not inherent FFmpeg limits. Removing them wholesale is unvalidated: in particular, audio cuts use split/trim/concat and can buffer audio. A scalable replacement should page/virtualize analysis results, process logs incrementally and redesign expensive filter graphs before raising limits substantially.

Pause pagination changes how many results are displayed, not detection criteria. Use source-time range analysis to reduce work when appropriate. Page requests are bound to the current analysis and browser session. Re-running detection replaces the previous result set and its selections.

## Long-video precision

- The waveform has at most 4,096 amplitude bins across the entire recording. It does not gain finer audio detail when the timeline zooms in.
- Timeline zoom is limited to 16×.
- The playback range input uses a normalized 0–1,000 scale with 0.001 increments. Numeric edit times, timeline seeking and stepping controls offer other ways to position edits.
- For a 2h 17m 38s recording, waveform bins span about 2.02 seconds, and each configured playback-slider increment spans about 0.0083 seconds (pointer positioning is still limited by screen pixels).
- File identification hashes the complete file in 4 MiB chunks. This bounds each read, but large files still take time to identify before upload.
- Waveform generation scans audio before the editor opens and uses temporary decoded audio on disk. There is no background waveform indexing or editing proxy yet.

## Speed changes

FreeEdit does not currently offer an editor playback-speed control or export speed changes, either globally or per section. Some browser-native sample/result players may expose playback speed through their own menus; that affects listening/viewing only, not export.

Section speed changes require explicit source/output time mapping, synchronized video/audio processing, pitch handling, and rebasing cuts, captions, masks and Reframe. They are planned in `plan.md`, not implemented.

## Upload, storage and processing

| Setting | Local default | Notes |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | 1024 MiB | Larger files are rejected even though upload streams directly to disk. |
| `MAX_DURATION_MIN` | 0 (no configured duration cap) | A deployment may impose a duration cap. No cap is not a performance guarantee. |
| `JOB_TTL_HOURS` | 24 | Inactive media expires. Active uploads and queued/processing jobs are protected. |
| `MAX_PENDING_JOBS` | 4 | Queued/running processing operations; one operation is executed at a time. |
| `MAX_OUTPUT_SIDE` | 0 (no configured side limit) | Small-file preset still limits the longest side to 1280 pixels. Hosted configuration may impose an additional limit. |

For example, allow uploads up to 20 GiB when starting the local server:

```sh
MAX_UPLOAD_MB=20480 ./run.sh
```

Restart the server and refresh the page after changing configuration. This only raises upload admission, not project caps, memory guarantees or available disk space. Existing in-memory job sessions may need their source files reopened after restart.

Additional constraints:

- Original, decoded audio, cleaned audio, person masks, composition intermediates and exports consume disk. Two stereo PCM16 WAVs at 48 kHz for a 2h 17m 38s recording alone require about 2.95 GiB.
- Noise removal processes short chunks (default five seconds), and person segmentation handles one small frame at a time. Total runtime still increases with recording length.
- Analysis captures FFmpeg logs in memory; export diagnostics have a disk-backed log but currently read it in full on failure. These should use bounded incremental parsing/tail reads for large jobs.
- Media probing has a 30-second timeout. Waveform timeout is 30 seconds plus media duration; pause analysis is 60 seconds plus twice media duration. Export FFmpeg stages default to 300 seconds plus ten times media duration, unless overridden. Denoise has a separate 300 seconds plus five times duration timeout.
- Export re-encodes video; there is no general stream-copy edit mode. Multiple effects may require full-length intermediate passes.
- Only the first video/audio streams are selected. There is no audio-language/track selector; embedded subtitle/chapter preservation is not offered.
- MKV and other container playback depends on the browser. FFmpeg accepting a file does not guarantee that its source plays in the browser; no automatic browser-compatible proxy is provided.
- Pause detection identifies quiet audio, not semantic pauses. Music, dramatic silence and quiet dialogue need human review.

## Direction for safer scaling

Keep admission controls and resource checks configurable. Replace arbitrary result caps with paginated/virtualized results; improve long-timeline precision and waveform detail; stream analysis logs; bound audio-cut buffering; add optional proxies and finer waveform detail. Short combined processed previews are implemented. Profile real long recordings for peak RAM, temporary disk and cancellation behavior before claiming large-movie support.

### Bounded analysis logs and preview storage

Pause analysis writes FFmpeg diagnostics to a temporary file and parses it line by line. It writes all qualifying suggestions to a temporary JSONL file and retains the first 25 in the job status. Additional pages are read from disk; neither the API nor UI loads the complete result set into memory. FFmpeg export errors read only the final 4,000 bytes of their temporary log. These changes bound log-related memory, not total renderer or model memory.

Result-preview admission reserves space for the selected lossless window, audio, and output headroom instead of using the size of the entire recording. High-resolution previews can still require substantial temporary disk space; shorten the selection when needed. This estimate does not replace long-file profiling.
