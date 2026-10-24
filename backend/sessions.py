"""Signed anonymous sessions for isolating temporary uploads.

Cookie tokens are not user accounts; losing the signing key on restart expires
the session. Configure FREEEDIT_SESSION_SECRET to retain it across restarts.
"""
import hashlib
import hmac
import os
import secrets

COOKIE = "freeedit_session"
# An ephemeral secret is appropriate for the single-process, ephemeral jobs
# storage used by default. Set a durable secret for a persistent deployment.
_SECRET = (os.environ.get("FREEEDIT_SESSION_SECRET") or "").encode() or secrets.token_bytes(32)


def create_session() -> tuple[str, str]:
    owner = secrets.token_hex(24)
    return owner, owner + "." + hmac.new(_SECRET, owner.encode(), hashlib.sha256).hexdigest()


def verify_session(token: str | None) -> str | None:
    if not token or len(token) != 48 + 1 + 64:
        return None
    try:
        owner, signature = token.split(".", 1)
        if any(c not in "0123456789abcdef" for c in owner):
            return None
        expected = hmac.new(_SECRET, owner.encode(), hashlib.sha256).hexdigest()
        return owner if hmac.compare_digest(signature, expected) else None
    except ValueError:
        return None
