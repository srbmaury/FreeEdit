"""Signed anonymous sessions for isolating temporary uploads.

Cookie tokens are not user accounts; losing the signing key on restart expires
the session. Configure FREEEDIT_SESSION_SECRET to retain it across restarts.
"""
import hashlib
import hmac
import os
import secrets

# An ephemeral secret is appropriate for the single-process, ephemeral jobs
# storage used by default. Set a durable secret for a persistent deployment.
_SECRET = (os.environ.get("FREEEDIT_SESSION_SECRET") or "").encode() or secrets.token_bytes(32)
# Cookies are scoped to hosts, not ports. Independent signing keys must use
# independent names so another local server cannot replace this session.
def cookie_name(secret: bytes) -> str:
    return "freeedit_session_" + hmac.new(secret, b"FreeEdit cookie namespace", hashlib.sha256).hexdigest()[:16]


COOKIE = cookie_name(_SECRET)


def create_session() -> tuple[str, str]:
    owner = secrets.token_hex(24)
    return owner, owner + "." + hmac.new(_SECRET, owner.encode(), hashlib.sha256).hexdigest()


def verify_session(token: str | None) -> str | None:
    if not token or len(token) != 48 + 1 + 64:
        return None
    try:
        owner, signature = token.split(".", 1)
        if len(owner) != 48 or len(signature) != 64 or any(
            c not in "0123456789abcdef" for c in owner + signature
        ):
            return None
        expected = hmac.new(_SECRET, owner.encode(), hashlib.sha256).hexdigest()
        return owner if hmac.compare_digest(signature, expected) else None
    except ValueError:
        return None
