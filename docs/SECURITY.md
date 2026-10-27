# FreeEdit security and privacy boundaries

FreeEdit processes recordings on the server hosting the application. This
document describes the current protections and remaining work; it does **not**
claim a security audit or guarantee that hosted processing is private.

## Anonymous job isolation

- New browser sessions receive a signed random `freeedit_session` cookie:
  HttpOnly, SameSite=Strict, Secure for HTTPS requests.
- The server associates uploaded job IDs with that session.
- Every `/api/jobs/{job_id}` request (including source, presenter, preview,
  result, status and deletion) verifies ownership before executing the route.
  Unowned jobs return 404 so their existence is not disclosed.
- Storage figures and manual cleanup consider only that session's jobs.
  Periodic expiration remains global and retains the existing processing/
  upload protections.
- The cookie is *not a login*, and anyone sharing the same browser session
  can access its temporary files. Do not upload media requiring confidential
  server-side handling to an untrusted public deployment.
- Set `FREEEDIT_SECURE_COOKIES=true` when HTTPS terminates at a proxy
  and the application receives internal HTTP; the Render config sets it.
- Sessions survive restarts on the same jobs volume. A private 0600
  `.session-secret` is created atomically unless `FREEEDIT_SESSION_SECRET`
  supplies a stable, high-entropy key. Protect the key and media directory;
  rotating/deleting the key invalidates existing browser cookies.
- Atomic per-job metadata preserves ownership and completed-result identities.
  Restart recovery never guesses ownership for orphan files. Interrupted work
  requires retry; partial full exports are not made available for download.
  A directory lock prevents two API workers from sharing this store. Replication
  still requires a different storage/admission architecture.
- Unsafe requests carrying a cross-site Origin header are rejected.
- The API enforces configurable session and peer request quotas for upload,
  processing and diagnostics, plus a hard concurrent-upload cap and a
  processing queue limit. Quotas return 429 with `Retry-After`.
- Control/edit bodies have a 16 MiB aggregate limit before JSON parsing
  (`FREEEDIT_MAX_EDIT_REQUEST_MB`), including chunked transfers. Media uploads
  retain their separate streaming size limit. Oversized bodies return 413.
- At most two control requests are retained through parsing/validation by
  default (`FREEEDIT_MAX_ACTIVE_EDIT_REQUESTS`). Extra requests receive 429;
  receiving a body times out after 30 seconds
  (`FREEEDIT_EDIT_REQUEST_TIMEOUT_SECONDS`, 408). This bounds concurrent raw
  control-body buffering, not total decoded-image/renderer memory.
- Render requests also cap combined overlay/background PNG dimensions at
  16 million pixels (`FREEEDIT_MAX_OVERLAY_PIXELS`), so highly compressed
  images cannot multiply the individual image limit across 100 overlays.
  This is admission headroom, not a guarantee of total FFmpeg/ML RSS.
- The peer is taken from the ASGI connection, never untrusted forwarding
  headers. Behind Render or another reverse proxy, multiple end users may
  appear as the *same peer*: configure a **real-client-IP edge limiter** and
  treat this application's limiter as defense in depth.
- Use HTTPS, appropriate edge-side request throttling, payload body limits
  and worker capacity controls. Signed sessions do not replace user login
  or public-network abuse controls.

## Operational review checklist

1. Confirm visitor A cannot read, cancel, download, or remove visitor B's job.
2. Confirm "Storage and cleanup" for A cannot list or delete B's job.
3. Verify session cookies are Secure on the deployed HTTPS endpoint.
4. Limit concurrent uploads, processing requests, total disk consumption and
   service access at the proxy/hosting layer.
5. Run `python -m unittest discover -s tests -v` and
   `node --test tests/*.cjs`, plus the Chromium smoke test via CI.
6. Check temporary file expiration after crashes and app restarts.
7. Review third-party binary/model licenses in `docs/LICENSE_AUDIT.md`.

## Known limits

There is no account-based authorization, malware scanner, content scanning,
persistent per-user media library, or distributed rate-limiting service.
The in-memory quotas reset at restart and cannot protect a multi-worker
deployment or identify visitors independently behind a shared proxy.
The application still relies on one worker process and local disk. Privacy
and operational guarantees must be reevaluated before horizontally scaling
or serving regulated/sensitive recordings.
