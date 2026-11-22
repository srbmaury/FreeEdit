"""ChatGPT MCP tools backed by FreeEdit's narration engine."""

import os
import secrets
import threading
from time import monotonic
from typing_extensions import TypedDict
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Response
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from backend.media.tts import NarrationRequest, generate_narration

PUBLIC_URL = os.environ.get("FREEEDIT_PUBLIC_URL", "https://freeedit.srbmaury.com").rstrip("/")
DOWNLOAD_SECONDS = 600
DOWNLOAD_BUDGET = 16 * 1024**2
_downloads: dict[str, tuple[float, bytes]] = {}
_download_lock = threading.Lock()
router = APIRouter(prefix="/api/plugin")
mcp = FastMCP(
    "FreeEdit",
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    max_request_body_size=16 * 1024,
    transport_security=TransportSecuritySettings(
        allowed_hosts=[urlsplit(PUBLIC_URL).netloc, "localhost:*", "127.0.0.1:*"],
        allowed_origins=[PUBLIC_URL, "http://localhost:*", "http://127.0.0.1:*"],
    ),
)


def _expire_downloads(now: float) -> None:
    for token, (expires, _) in list(_downloads.items()):
        if expires <= now:
            del _downloads[token]


class NarrationDownload(TypedDict):
    download_url: str
    expires_in_seconds: int
    format: str


@mcp.tool(annotations=ToolAnnotations(
    title="Generate FreeEdit narration", readOnlyHint=False, destructiveHint=False, openWorldHint=True
))
def generate_voiceover(settings: NarrationRequest) -> NarrationDownload:
    """Send English text to FreeEdit to generate a downloadable WAV with a preset voice and speed."""
    try:
        audio = generate_narration(settings).body
    except HTTPException as exc:
        raise ToolError(exc.detail) from None

    token = secrets.token_urlsafe(32)
    with _download_lock:
        now = monotonic()
        _expire_downloads(now)
        used = sum(len(payload) for _, payload in _downloads.values())
        if used + len(audio) > DOWNLOAD_BUDGET:
            raise ToolError("Narration download storage is full. Try again in a few minutes.")
        _downloads[token] = (now + DOWNLOAD_SECONDS, audio)
    return {
        "download_url": f"{PUBLIC_URL}/api/plugin/narration/{token}",
        "expires_in_seconds": DOWNLOAD_SECONDS,
        "format": "wav",
    }


@router.get("/narration/{token}", include_in_schema=False)
def download_narration(token: str) -> Response:
    with _download_lock:
        _expire_downloads(monotonic())
        download = _downloads.get(token)
    if download is None:
        raise HTTPException(404, "Narration download expired or was not found.")
    return Response(download[1], media_type="audio/wav", headers={
        "Content-Disposition": 'attachment; filename="freeedit-narration.wav"',
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
    })
