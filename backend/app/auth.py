"""Signed login tokens (standard library only). Demo accounts and real accounts both get the same kind of token."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

TTL = 12 * 3600
DEMO_WS = "ws-demo"


class AuthError(Exception):
    pass


def _secret() -> bytes:
    s = os.environ.get("AUTH_SECRET", "")
    if len(s) < 16 or s.lower().startswith("change-me"):
        raise AuthError("AUTH_SECRET is not set on the server (needs at least 16 characters, not the example text).")
    return s.encode("utf-8")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode("ascii").rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(user: dict, now: float | None = None) -> str:
    payload = {"uid": user["id"], "name": user["name"], "role": user["role"], "ws": user.get("ws") or DEMO_WS, "exp": int((now or time.time()) + TTL)}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
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
        raise AuthError("Login expired. Log in again.")
    return {"id": data["uid"], "name": data["name"], "role": data["role"], "ws": data.get("ws") or DEMO_WS}


# ---- passwords: PBKDF2-HMAC-SHA256 with a random salt (standard library, nothing to install) ----
def hash_password(password: str, rounds: int | None = None, salt: bytes | None = None) -> str:
    rounds = rounds or int(os.environ.get("BS_PBKDF2_ROUNDS", "200000"))
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)
    return "pbkdf2_sha256$%d$%s$%s" % (rounds, salt.hex(), dk.hex())


def check_password(password: str, stored: str) -> bool:
    try:
        algo, rounds, salt, good = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(rounds))
    except Exception:
        return False
    return hmac.compare_digest(dk.hex(), good)