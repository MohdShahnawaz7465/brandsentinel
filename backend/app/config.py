"""Tiny .env loader (standard library only). Reads backend/.env and fills os.environ.
Values already set in the terminal win over the file. Never commit .env."""
from __future__ import annotations

import os

ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")


def load_env(path: str = ENV_PATH) -> bool:
    if not os.path.exists(path):
        return False
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            os.environ[k] = v
    return True