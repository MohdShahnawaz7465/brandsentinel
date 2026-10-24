"""Tiny database layer. Hosted: Postgres (Neon) through DATABASE_URL. Local and tests: a SQLite file.
Write SQL with ? placeholders; they are converted for Postgres."""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = [
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, author_id TEXT NOT NULL, "
    "needs_legal INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, at TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL)",
]
DEMO_USERS = [
    ("u-asha", "Asha Rao", "writer"), ("u-ravi", "Ravi Nair", "writer"), ("u-dev", "Dev Malhotra", "brand_manager"),
    ("u-meera", "Meera Iyer", "legal"), ("u-sam", "Sam Park", "admin"),
]
_ready: set[str] = set()
_lock = threading.Lock()


class NoDatabase(Exception):
    """Raised on a host without a database (for example Vercel before DATABASE_URL is set)."""


def url() -> str:
    return os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL") or ""


def _sqlite_path() -> str:
    if os.environ.get("BS_SQLITE"):
        return os.environ["BS_SQLITE"]
    if os.environ.get("VERCEL"):
        raise NoDatabase("No database is connected on this host. Set DATABASE_URL.")
    return os.path.join(os.path.dirname(HERE), "local.db")


class Conn:
    def __init__(self, raw, pg: bool):
        self.raw, self.pg = raw, pg

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if self.pg else sql

    def run(self, sql: str, params=()):
        cur = self.raw.cursor()
        cur.execute(self._sql(sql), tuple(params))
        return cur

    def rows(self, sql: str, params=()) -> list[dict]:
        cur = self.run(sql, params)
        if cur.description is None:
            return []
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) if not isinstance(r, dict) else r for r in cur.fetchall()]

    def one(self, sql: str, params=()):
        r = self.rows(sql, params)
        return r[0] if r else None


@contextlib.contextmanager
def connect():
    u = url()
    if u:
        import psycopg  # installed from requirements.txt

        # prepare_threshold=None: Neon's pooled connections do not support server-side prepared statements.
        raw = psycopg.connect(u, prepare_threshold=None)
        c, key = Conn(raw, True), u
    else:
        path = _sqlite_path()
        raw = sqlite3.connect(path)
        c, key = Conn(raw, False), path
    try:
        with _lock:
            if key not in _ready:
                for stmt in SCHEMA:
                    c.run(stmt)
                for uid, name, role in DEMO_USERS:
                    c.run("INSERT INTO users (id, name, role) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING", (uid, name, role))
                raw.commit()
                _ready.add(key)
        yield c
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()