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
- Set `FREEEDIT_SESSION_SECRET` to a randomly generated, high-entropy value
  on a persistent deployment. Without it, the process generates a fresh key
  on startup; old cookies become invalid. In-memory job metadata is also lost
  on restart. Multi-worker or replicated deployments require shared session
  keys, job metadata, ownership checks and job storage.
- Unsafe requests carrying a cross-site Origin header are rejected.
- The API enforces configurable session and peer request quotas for upload,
  processing and diagnostics, plus a hard concurrent-upload cap and a
  processing queue limit. Quotas return 429 with `Retry-After`.
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
