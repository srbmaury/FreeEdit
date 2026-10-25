"""Bounded in-process admission limiter for anonymous public API users.

The service currently runs one worker. This limits expensive requests both by
signed session and by the actual connecting peer, never by user-supplied
X-Forwarded-For. Configure an edge limiter for proxy-aware/global enforcement.
"""
from collections import deque
import math
import os
import threading
import time


def env_int(name: str, default: int) -> int:
    value = int(os.environ.get(name, default))
    if value < 1:
        raise ValueError(f"{name} must be at least 1")
    return value


class RequestLimiter:
    def __init__(self, *, clock=time.monotonic, max_keys=10000):
        self.clock = clock
        self.max_keys = max_keys
        self._lock = threading.Lock()
        self._events = {}
        self._last_sweep = 0

    def check(self, category: str, owner: str, peer: str, *, session_limit: int,
              peer_limit: int, seconds: int = 600) -> int:
        """Return Retry-After seconds (0 if admitted), atomically for both keys."""
        now = self.clock()
        keys = (("session", category, owner), ("peer", category, peer))
        with self._lock:
            if now - self._last_sweep > 60 or len(self._events) >= self.max_keys:
                # Remove old buckets and bound the number of distinct clients.
                for key, timestamps in list(self._events.items()):
                    while timestamps and now - timestamps[0] >= seconds:
                        timestamps.popleft()
                    if not timestamps:
                        self._events.pop(key, None)
                if len(self._events) >= self.max_keys:
                    oldest = min(self._events, key=lambda k: self._events[k][-1])
                    self._events.pop(oldest)
                self._last_sweep = now
            for key in keys:
                timestamps = self._events.setdefault(key, deque())
                while timestamps and now - timestamps[0] >= seconds:
                    timestamps.popleft()
            retry = max((
                max(0, math.ceil(seconds - (now - self._events[key][0])))
                for key, limit in zip(keys, (session_limit, peer_limit))
                if len(self._events[key]) >= limit
            ), default=0)
            if not retry:
                for key in keys:
                    self._events[key].append(now)
            return retry


def category_for(method: str, path: str) -> str | None:
    if method != "POST":
        return "diagnostics" if method == "GET" and path == "/api/diagnostics" else None
    if path == "/api/upload" or (
        path.startswith("/api/jobs/") and path.endswith("/presenter")
    ):
        return "upload"
    if path.startswith("/api/jobs/") and path.rsplit("/", 1)[-1] in {
        "process", "silence", "preview", "background-preview",
        "composition-preview", "result-preview"
    }:
        return "processing"
    return None


def limits(category: str) -> tuple[int, int]:
    if category == "upload":
        return env_int("FREEEDIT_UPLOADS_PER_SESSION_10M", 8), env_int("FREEEDIT_UPLOADS_PER_PEER_10M", 32)
    if category == "diagnostics":
        return 6, 24
    return env_int("FREEEDIT_OPERATIONS_PER_SESSION_10M", 40), env_int("FREEEDIT_OPERATIONS_PER_PEER_10M", 160)
