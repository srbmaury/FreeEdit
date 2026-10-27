"""Signed anonymous sessions for isolating temporary uploads.

Cookie tokens are not user accounts. The signing key lives on the jobs volume
unless FREEEDIT_SESSION_SECRET supplies it; losing either key resets sessions.
"""
import hashlib
import hmac
import os
import secrets
from pathlib import Path
import tempfile

def load_secret(root: Path) -> bytes:
    """Keep anonymous sessions usable after a restart on the same jobs volume."""
    configured = os.environ.get("FREEEDIT_SESSION_SECRET")
    if configured:
        return configured.encode()
    root.mkdir(parents=True, exist_ok=True)
    target = root / ".session-secret"
    if not target.exists():
        # Publish a fully written key atomically; a concurrent initializer
        # either wins the hard link or reads the winner's complete key.
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=root, prefix=".session-", delete=False) as file:
                temporary = Path(file.name)
                file.write(secrets.token_bytes(32))
                file.flush()
                os.fsync(file.fileno())
            try:
                os.link(temporary, target)
            except FileExistsError:
                pass
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
    if target.is_symlink():
        raise RuntimeError("The session key must be a regular private file.")
    secret = target.read_bytes()
    if len(secret) != 32:
        raise RuntimeError("Invalid persisted session key. Restore it from backup or remove it to reset sessions.")
    return secret


_SECRET = load_secret(Path(os.environ.get("FREEEDIT_JOBS_DIR", Path(__file__).resolve().parent.parent / "jobs")))
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
