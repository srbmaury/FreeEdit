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
- Set `FREEEDIT_SESSION_SECRET` to a randomly generated, high-entropy value
  on a persistent deployment. Without it, the process generates a fresh key
  on startup; old cookies become invalid. In-memory job metadata is also lost
  on restart. Multi-worker or replicated deployments require shared session
  keys, job metadata, ownership checks and job storage.
- Unsafe requests carrying a cross-site Origin header are rejected.
- Use HTTPS, appropriate host/edge upload rate limits, and separate worker
  capacity limits in publicly accessible deployments. Signed sessions do not
  replace user login or public-network abuse controls.

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
The application still relies on one worker process and local disk. Privacy
and operational guarantees must be reevaluated before horizontally scaling
or serving regulated/sensitive recordings.
