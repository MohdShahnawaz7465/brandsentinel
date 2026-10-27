"""Small network helpers shared by the routes: the visitor's address and a sliding-window limiter."""
from __future__ import annotations

import os
import time
from collections import defaultdict, deque

from fastapi import Request


def client_ip(request: Request) -> str:
    """Visitor address. Behind a host's proxy every request looks like it comes from the proxy, so with
    TRUST_PROXY=1 we use the LAST X-Forwarded-For entry (added by the host's own proxy). The first entry
    can be faked by the visitor, so it is never used."""
    if os.environ.get("TRUST_PROXY") == "1":
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else "unknown"


class Limiter:
    """Allow at most `limit` hits per `window` seconds for each key. Memory is per server instance,
    so on a serverless host this is a guard against abuse, not an exact global limit."""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self.hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now, q = time.monotonic(), self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True

    def clear(self) -> None:
        self.hits.clear()