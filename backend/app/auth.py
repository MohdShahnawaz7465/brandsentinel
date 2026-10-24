"""Demo login with signed tokens (standard library only). No passwords: judges press a role button."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

TTL = 12 * 3600


class AuthError(Exception):
    pass


def _secret() -> bytes:
    s = os.environ.get("AUTH_SECRET", "")
    if len(s) < 16:
        raise AuthError("AUTH_SECRET is not set on the server (needs at least 16 characters).")
    return s.encode("utf-8")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(user: dict, now: float | None = None) -> str:
    body = _b64(json.dumps({"uid": user["id"], "name": user["name"], "role": user["role"], "exp": int((now or time.time()) + TTL)}, separators=(",", ":")).encode("utf-8"))
    sig = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return body + "." + sig


def read_token(token: str, now: float | None = None) -> dict:
    try:
        body, sig = token.split(".", 1)
        good = _b64(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            raise AuthError("Bad token.")
        data = json.loads(_unb64(body))
    except AuthError:
        raise
    except Exception:
        raise AuthError("Bad token.")
    if data.get("exp", 0) < (now or time.time()):
        raise AuthError("Login expired. Press a demo login button again.")
    return {"id": data["uid"], "name": data["name"], "role": data["role"]}