"""Tiny database layer. Hosted: Postgres (Neon) through DATABASE_URL. Local and tests: a SQLite file.
Write SQL with ? placeholders; they are converted for Postgres."""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO_WS = "ws-demo"
SCHEMA = [
    "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, ai_enabled INTEGER NOT NULL DEFAULT 1, "
    "is_demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, author_id TEXT NOT NULL, "
    "needs_legal INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, at TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL)",
]
# Columns added in Round 3. Older databases get them through ALTER TABLE, so nothing has to be recreated.
NEW_COLUMNS = [("users", "email", "TEXT"), ("users", "pw_hash", "TEXT"), ("users", "workspace_id", "TEXT"), ("submissions", "workspace_id", "TEXT")]
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


def _migrate(c: Conn) -> None:
    for table, col, typ in NEW_COLUMNS:
        if c.pg:
            c.run("ALTER TABLE %s ADD COLUMN IF NOT EXISTS %s %s" % (table, col, typ))
        else:
            have = {r["name"] for r in c.rows("PRAGMA table_info(%s)" % table)}
            if col not in have:
                c.run("ALTER TABLE %s ADD COLUMN %s %s" % (table, col, typ))
    c.run("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)")
    c.run("CREATE INDEX IF NOT EXISTS submissions_ws ON submissions (workspace_id)")
    # Everything that existed before workspaces belongs to the shared demo workspace.
    t = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    c.run("INSERT INTO workspaces (id, name, ai_enabled, is_demo, created_at) VALUES (?, 'Demo workspace', 1, 1, ?) ON CONFLICT (id) DO NOTHING", (DEMO_WS, t))
    for uid, name, role in DEMO_USERS:
        c.run("INSERT INTO users (id, name, role) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING", (uid, name, role))
        c.run("UPDATE users SET workspace_id = ? WHERE id = ? AND workspace_id IS NULL", (DEMO_WS, uid))
    c.run("UPDATE submissions SET workspace_id = ? WHERE workspace_id IS NULL", (DEMO_WS,))


def _already_current(c: Conn) -> bool:
    """Hosted database: one quick check instead of ~20 setup statements on every cold start.
    True when all tables, the Round 3 columns and the demo users already exist. Anything unexpected returns False,
    and the full (safe to repeat) setup runs as before."""
    if not c.pg:
        return False
    try:
        cols = c.one(
            "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = current_schema() AND "
            "((table_name = 'users' AND column_name IN ('email', 'pw_hash', 'workspace_id')) OR "
            "(table_name = 'submissions' AND column_name = 'workspace_id'))"
        )
        tabs = c.one(
            "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = current_schema() AND "
            "table_name IN ('workspaces', 'users', 'submissions', 'events')"
        )
        demo = c.one("SELECT count(*) AS n FROM users WHERE workspace_id = ? AND id IN ('u-asha','u-ravi','u-dev','u-meera','u-sam')", (DEMO_WS,))
        return bool(cols and tabs and demo and int(cols["n"]) == 4 and int(tabs["n"]) == 4 and int(demo["n"]) == 5)
    except Exception:
        try:
            c.raw.rollback()
        except Exception:
            pass
        return False


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
                if not _already_current(c):
                    for stmt in SCHEMA:
                        c.run(stmt)
                    _migrate(c)
                    raw.commit()
                _ready.add(key)
        yield c
        raw.commit()
    except Exception:
        raw.rollback()
        raise
    finally:
        raw.close()