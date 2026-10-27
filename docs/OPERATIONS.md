# Operating limits, performance and releases

FreeEdit targets screen recordings and short demos; it is **not a guaranteed movie-length editor or multi-tenant storage service**. This is a current operational guide, not a historical readiness checklist.

## Project and editing limits

| Item | Limit or behavior |
| --- | --- |
| Pause analysis | 25 suggestions per UI page; up to 100 per API page; all qualifying matches stored temporarily on disk |
| Cuts | 100 |
| Text/captions, annotations and privacy masks | 100 combined |
| SRT import | Up to 100 usable cues, less than 1 MiB; max 240 characters/four lines per cue |
| Timed Reframe | 20 non-overlapping sections; 1–3× zoom |
| Projects | Version 2 `.freeedit.json`, up to 2 MiB, **without media files** |
| Timeline | At most 4,096 waveform bins; zoom up to 16× |
| Undo/redo | Up to 100 combined steps within a 16 MiB document/asset payload budget; images shared across snapshots |
| Presenter composition | One main recording and one inset; no multi-clip sequence/reordering |
| Playback/export speed | No global or per-section speed-ramping |

These are product limits, not FFmpeg capability limits. Reframing, cuts and overlays are expressed in *source-time coordinates*; exported result time differs after cuts. No general stream-copy editing mode or browser-compatible proxy conversion exists. Embedded subtitles and alternate audio tracks are not selected for export.

## Resource and deployment settings

| Environment variable | Local default | Purpose |
| --- | --- | --- |
| `MAX_UPLOAD_MB` | 1024 MiB | Streaming upload size admission |
| `MAX_DURATION_MIN` | 0 | Zero means no configured duration cap (not a performance promise) |
| `JOB_TTL_HOURS` | 24 | Inactive temporary-media expiration |
| `MAX_PENDING_JOBS` | 4 | In-flight and queued processing |
| `FREEEDIT_JOBS_DIR` | `./jobs` | Writable temporary media directory |
| `MAX_OUTPUT_SIDE` | 0 | Optional limit on output's longest dimension |
| `DF_CHUNK_SECONDS` | 5 | Noise-reduction worker chunking |
| `FFMPEG_THREADS` / `OMP_NUM_THREADS` | automatic | Resource-use knobs |
| `FREEEDIT_MAX_ACTIVE_UPLOADS` | 2 | Cap simultaneous uploads |
| `FREEEDIT_UPLOADS_PER_SESSION_10M` | 8 | Per-session upload budget |
| `FREEEDIT_UPLOADS_PER_PEER_10M` | 32 | Per-connection-peer upload budget |
| `FREEEDIT_OPERATIONS_PER_SESSION_10M` | 40 | Per-session heavy-operation budget |
| `FREEEDIT_OPERATIONS_PER_PEER_10M` | 160 | Per-peer heavy-operation budget |

Hosted configuration in `render.yaml` may impose smaller limits than local defaults (e.g., upload size, recording duration and processing resolution). Consult that file for the actual deployment settings. To change the local upload admission only:

```sh
MAX_UPLOAD_MB=2048 ./run.sh
```

Raising upload limits does **not** increase available disk, RAM, filter-graph tolerance or project caps.

The standard service runs one API worker with in-memory job/session state and local disk. Do **not** run several API processes over the same job directory without redesigning shared ownership and admission state. An external reverse proxy should enforce rate limits based on verified client IPs; untrusted `X-Forwarded-For` is not an identity source. See [security and privacy](SECURITY.md).

`FREEEDIT_SESSION_SECRET` should be stable, random and high-entropy on a persistent deployment. Set `FREEEDIT_SECURE_COOKIES=true` when TLS is terminated before the ASGI server.

## Disk, memory and codec risks

- Uploads stream to disk, but exports also create decoded/cleaned audio, person masks, composed intermediate videos and final files. Multiple copies can be large; free-space estimates are advisory.
- Noise removal operates in short chunks; background segmentation processes frames independently. Full-video rendering still scales with file length.
- FFmpeg accepts formats that HTML video might not decode; use a browser-supported MP4 if source preview fails.
- Cuts may require audio processing buffers; overlay filtering, x264 decoding/encoding and ML inference may dominate memory.
- Source file identity is hashed in bounded chunks but takes time proportional to file length.
- The waveform is limited to 4,096 amplitude bins regardless of zoom, so it cannot show fine detail for very long recordings.
- The default application uses the first audio/video tracks; chapter timestamps and embedded subtitles are not adapted to edits. Verify the complete output before sharing.

## Performance evidence (not promises)

The repository's [historical benchmark snapshots](benchmarks.json) include machine, version and measurement limitations.

Examples from those snapshots:

| Test | Environment | Observation |
| --- | --- | --- |
| Synthetic 10-minute 720p 10-fps denoised recording | macOS arm64 | ~39.85 s export; largest child RSS ~423 MiB (not total app/browser RAM) |
| Real 2h 17m 37.6s MKV, 1280×546 | Apple M5, macOS, FFmpeg 9.0.2 | Per-stage results and peak process-tree RSS; not a maximum supported duration |
| 100 simultaneous text-overlay PNGs on a 10-second 720p clip | macOS arm64 | ~1.09 s processed clip in the measured profile |

These are **dated single-machine measurements**, not hosting/SLA claims; they exclude browser/GPU memory and may miss short RSS peaks. Long recordings, true person segmentation, variable-frame-rate sources and full feature combinations need validation on target hardware.

For a new baseline:

```sh
.venv/bin/python -m scripts.profile_media /path/to/media.mkv /tmp/freeedit-profile --full-export
OMP_NUM_THREADS=1 DF_THREADS=1 FFMPEG_THREADS=1 \
  .venv/bin/python -m scripts.benchmark --seconds 600 --denoise
```

Keep generated recordings and measurements out of the repository; add a reviewed baseline if it materially changes the supported-media guidance.

## Release checklist

1. Verify all tests in CI and reproduce the Docker build. Run the actual model-backed features on representative recordings, including mobile/desktop browser preview and long files.
2. Keep source `LICENSE` and resolve each third-party dependency/model distribution term in [LICENSE_AUDIT.md](LICENSE_AUDIT.md). The DeepFilterNet3 **pretrained model's redistribution terms are not yet cleared**.
3. Record the shipping Python, FFmpeg and native component versions and check hashes. `requirements-web.lock` pins the tested Python 3.12 web stack; the complete audio, optional segmentation, OS and container dependency graph remains incompletely hash-locked.
4. Generate a local inventory in each optional runtime environment:

   ```sh
   .venv/bin/python -m scripts.release_inventory > /tmp/freeedit-release-inventory.json
   ```

   Retain actual license/notice files, model hashes and FFmpeg `-version` / `-L` evidence separately; metadata alone is not a legal clearance.
5. Review session security, request caps, disk expiry, cancellation, log privacy, recovery and the actual reverse proxy/HTTPS configuration.
6. Record which Git SHA and tested image/tag were released. Never bundle users' recordings, temporary jobs, model caches with unclear terms, or private logs.

Historical one-time readiness reports and unmerged-branch notes have been removed from the active docs; they remain recoverable through Git history.
