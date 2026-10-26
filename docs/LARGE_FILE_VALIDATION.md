# Large-file validation — 25 October 2026

These measurements describe one machine and one real file, not a maximum supported duration or a memory guarantee. The source file was read without modification.

## Source and environment

- Supplied Udaan MKV: 1,257,725,297 bytes, 8,257.599 seconds (2h 17m 37.6s), 1280×546, 24 fps, stereo audio.
- Local Apple M5, Python 3.12.14, FFmpeg 9.0.2. The isolated browser-validation server allowed uploads up to 20 GiB. The ordinary default remains 1 GiB and must be configured for this file.
- Native browser project fingerprinting read the full movie in 4 MiB chunks. HTTP upload streamed to disk. The movie source loaded and sought successfully in the in-app browser; this does not guarantee MKV codec support in other browsers.
- RSS below is sampled every 0.5 seconds for the profiling Python process and its descendants, including FFmpeg. It excludes browser/GPU memory, OS file cache, and unrelated jobs. Brief peaks can be missed.

## Measurements

| Operation | Elapsed | Sampled process-tree peak RSS | Outcome |
| --- | ---: | ---: | --- |
| Streaming waveform scan | 4.152 s | 46.8 MiB | 4,096 bins, no decoded-audio spool |
| Full pause scan | 3.659 s | 46.2 MiB | 454 results stored on disk, bounded first page |
| Result preview at 8,210–8,225 s | 0.717 s | 232.7 MiB | 14-second H.264/AAC output after removing one second; leveling/fades enabled |
| Export cancellation | 5.013 s total | 264.7 MiB | Cancellation scheduled at 5 seconds; all attached child processes stopped |
| Complete export | 458.609 s (7m 38.6s) | 149.5 MiB | 509,691,012-byte MP4; 8,251.599 s, exactly six seconds shorter |

The previous waveform implementation took 5.238 seconds in a separate run and spooled approximately 126 MiB of decoded mono PCM for this source. The replacement reduces fixed 64 KiB PCM reads directly into at most 4,096 peaks. The single-run timings are not a controlled speed comparison; eliminating the spool is the structural improvement.

## Browser checks

- Actual movie upload, source playback, waveform availability, full pause detection (454 matches).
- Exact 130-minute ruler seek: a pointer-capture conflict previously sought to roughly 132:50; it now seeks to 7,800.000 seconds. Drag-to-select was also checked after the fix and produced a valid range without moving the playhead unexpectedly. Keyboard tick activation remains available.
- Movie project save, full-file identity check and relink/reopen.
- Background settings and presenter offset/trim restored from the downloaded project.
- Presenter trim validation rejects an end beyond the presenter's duration. A valid combined preview at 130 minutes loads as a three-second playable sample.

## Completed export integrity

The full output decoded through FFmpeg with `-xerror` and both audio/video mapped, exiting successfully with no diagnostic errors. Both streams start at zero. Video duration is 8,251.583 s and audio duration 8,251.565 s (about 18 ms apart); container duration is 8,251.599 s. These checks do not establish perceptual lip-sync throughout the film.

Representative grayscale frame comparisons after the beginning, middle and final cuts matched the expected source/output positions:

| Source time | Output time | Frame PSNR at 160×68 |
| ---: | ---: | ---: |
| 120 s | 118 s | 57.47 dB |
| 4,200 s | 4,196 s | 54.99 dB |
| 8,220 s | 8,214 s | 50.28 dB |

One-second mono audio correlation checks at source/output 120/118, 4,200/4,196 and 8,100/8,096 seconds found alignment offsets of -5.0, -5.25 and -4.25 ms, with normalized correlations 0.998, 0.916 and 0.987 despite leveling/re-encoding. This is sampled alignment evidence, not a whole-film manual review.

The complete exported MP4 was also loaded in the browser, sought to 130 minutes and played successfully (`readyState=4`, no media error).

## Reproduce and extend

```sh
.venv/bin/python -m scripts.profile_media /path/to/recording.mkv /tmp/freeedit-profile-new --full-export
```

Use a new output directory. Generated media, pause results and `results.jsonl` remain there. The full export is opt-in and can take minutes or longer. The tool also runs against short media to check the profiling workflow itself. An operation shorter than the sampling interval may have no RSS sample.

## Demanding workloads measured in the follow-up

Measured with the fresh model runtimes described in [installation validation](INSTALLATION_VALIDATION.md). Samples use the same process-tree RSS method above; this is not a hard-memory-limit test.

| Workload | Elapsed | Sampled peak RSS | Result |
| --- | ---: | ---: | --- |
| Full 2h17m movie noise removal, audio-only export | 443.631 s | 678.8 MiB | 8,257.600 s stereo WAV, 1,585,459,278 bytes |
| Full movie person-background blur export | 2,096.726 s | 249.7 MiB | 8,257.625 s MP4, 383,447,018 bytes; mask removed after success |
| 15s synthetic 4K/60fps with mask, timed zoom, cut and audio finishing | 11.385 s | 823.5 MiB | 14.000 s 3840×2160 output |
| 10s 4K/60fps combined preview with a 1s cut | 12.175 s | 823.6 MiB | 9.000 s output |
| 120s synthetic 720p, 100 cuts + 80 masks + 20 zoom portions | 4.313 s | 150.9 MiB | 100.000 s output after parser fix |
| 120s real movie excerpt, blurred presenter, mixed audio, cut, leveling and fades | 15.978 s | 307.8 MiB | 118.000 s output; composition intermediate removed |
| Cancellation during movie segmentation, after cleanup fix | 3.009 s total | 219.0 MiB | Signal scheduled at 3 s; attached processes stopped and partial mask removed |

The 100-cut workload initially failed because a linearly nested FFmpeg sum expression exceeded parser depth. Balanced expressions fixed that failure. A generated-media test now covers the advertised 100-cut limit. The dense case uses the maximum 200 combined timeline objects (100 cuts, 80 masks, 20 zoom portions); it does not simultaneously use every per-type cap or test 100 PNG text overlays.

Cancellation initially stopped segmentation but retained its partial mask. Failure/timeout/cancellation cleanup now removes that artifact, verified with a second real cancellation and focused cleanup tests. No segmentation decoder/encoder remained running after the check.

Full noise output contains 792,729,600 finite samples, zero clipped samples, peak amplitude 0.9403, and expected duration. This checks numerical integrity, not speech quality across the film. Retained raw/clean/output audio consumed 4,756,377,822 bytes after export; disk figures are snapshots, not sampled peak use. Full background output decoded end-to-end without errors. A movie contains changing scenes and people, so successful processing does not establish visually stable segmentation or consent/suitability for every scene.

Four model threads processed a 30-second excerpt in 1.956 s (665.0 MiB sampled RSS); one thread took 2.326 s (668.9 MiB). Those short single runs do not justify changing the default for all hardware.

Raw records: [demanding-workloads-measurement.json](demanding-workloads-measurement.json).

To repeat effects with an installed runtime, use a new output directory:

```sh
.venv/bin/python -m scripts.profile_effects /path/to/movie.mkv /tmp/noise-new --effect noise
.venv/bin/python -m scripts.profile_effects /path/to/movie.mkv /tmp/background-new --effect background
.venv/bin/python -m scripts.profile_effects /path/to/main.mp4 /tmp/presenter-new --effect presenter --presenter /path/to/camera.mp4
```

These are explicit long-running commands. Configure `DEEPFILTER_PYTHON`, `BACKGROUND_PYTHON` or `FREEEDIT_MODEL_DIR` when the optional runtimes/models are elsewhere.

Still unverified: full-film presenter composition, real 4K/high-frame-rate recordings, maximum PNG-text workloads, multi-channel audio beyond stereo, low-disk exhaustion during a long job, browser/GPU peak memory, hard container memory budgets, and independent whole-output speech/lip-sync/segmentation quality review. The combined squash candidate subsequently passed browser setup, upload, editing, preview/export playback, project relink/recovery, stale-result invalidation, mixed-audio presenter preview, quota feedback and the dense timeline export.

## PNG overlay follow-up — 26 October 2026

A generated 10-second 1280×720/24fps clip passed export with **100 simultaneous PNG inputs through the text-overlay path**: 1.092 seconds, 459.6 MiB sampled process-tree peak RSS, 1,467,705-byte output, 10.0078-second duration. Retained files occupied 1,514,105 bytes after export; this is not peak temporary disk use. The inputs intentionally reuse a synthetic 240×40 pattern at the same position, so the measurement exercises 100 PNG decode/filter inputs, not readable caption layout or font/glyph generation. Timing is too short for strong peak-memory confidence with 0.5-second sampling. No claim of low-memory or movie-length 100-caption support follows from this run.

Raw record: [png-overlay-measurement.json](png-overlay-measurement.json).

Reproduce on a short generated or non-sensitive source with a new output directory:

```sh
.venv/bin/python -m scripts.profile_effects /path/to/short-720p.mp4 /tmp/png-overlays-new --effect overlays
```

The command reads the complete source, so choose a short clip deliberately. It requires no optional models or Pillow and records the result in `results.jsonl`. Real 4K text layers, long PNG workloads, non-stereo audio, disk exhaustion, browser/GPU peaks, hard memory limits, lower-memory machines and independent quality review remain open. Existing full-movie measurements were not repeated in this follow-up.

## Current-source movie recheck — 26 October 2026

Rechecked the supplied 1,257,725,297-byte Udaan MKV (8,257.599 seconds) against current working source on the same Apple M5. The isolated server set `MAX_UPLOAD_MB=2048`; ordinary defaults were not silently changed. The input was read without modification.

Real localhost HTTP/API checks passed:

- Streamed upload in 1 MiB chunks, including waveform preparation: 5.105 seconds, 4,096 bins. A source byte range at byte 1,000,000,000 returned 206 with the expected 1,024 bytes.
- Whole-recording pause analysis: all 454 suggestions stored. The final suggestion spans 8,230.918–8,257.399 seconds, so analysis extends past 30 minutes and through the end of the movie.
- Full audio-only export with a two-second cut, speech leveling and 0.5-second end fades: 5.561 seconds; 8,255.598833-second stereo 48 kHz WAV; 1,585,075,076 bytes. Server admission and returned export identity matched. Noise removal was disabled.
- Combined video preview at 130:00–130:15 with a privacy mask, timed Reframe, one-second cut and audio finishing: exactly 14 seconds, 1,101,335 bytes. The existing full WAV remained downloadable with a 206 byte-range response during preview processing.
- Whole-output FFmpeg decode passed for the audio export and late video preview. This verifies decoding and duration, not independent perceptual quality.

A separate current-source profiler recorded waveform 5.042 seconds / 44.1 MiB sampled peak RSS; pauses 3.641 seconds / 43.9 MiB; late preview 0.732 seconds / 108.9 MiB; cancellation scheduled at five seconds returned at 5.011 seconds / 264.5 MiB with attached children stopped. RSS sampling has the same limitations described above. The HTTP/API checks were separate runs; their memory was not measured by this profiler.

Raw records: [API checks](movie-api-validation-20261026.json), [profiler](movie-profile-20261026.json). Previous full-video, denoising and segmentation measurements remain relevant historical evidence; those expensive workloads were not repeated here. Browser access was disabled in Work settings, so none of this new evidence is described as a browser pass. Cross-platform/low-memory hardware and current recovery UI validation remain outstanding.
