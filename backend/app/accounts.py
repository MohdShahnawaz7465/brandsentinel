"""Real accounts and private workspaces: sign up, log in, add team members, workspace settings.
Passwords are stored only as salted hashes. Every workspace is private to its own members."""
from __future__ import annotations

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from . import auth, db
from .netutil import Limiter, client_ip
from .store import current_user, now, session, ws_out

router = APIRouter()
EMAIL_RX = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
MEMBER_ROLES = ("writer", "legal", "brand_manager", "admin")
MAX_USERS = 25  # people in one workspace
signup_limit = Limiter(5, 3600)   # sign-ups per hour per visitor address
login_limit = Limiter(10, 60)     # log-in attempts per minute per visitor address
account_limit = Limiter(10, 900)  # log-in attempts per 15 minutes per account (slows password guessing)
_dummy_hash: str | None = None


class SignupIn(BaseModel):
    workspace_name: str = ""
    name: str = ""
    email: str = ""
    password: str = ""


class LoginIn(BaseModel):
    email: str = ""
    password: str = ""


class MemberIn(BaseModel):
    name: str = ""
    email: str = ""
    role: str = "writer"
    password: str = ""


class SettingsIn(BaseModel):
    ai_enabled: Optional[bool] = None
    name: Optional[str] = None


def _text(v: str, label: str, lo: int, hi: int) -> str:
    v = (v or "").strip()
    if not lo <= len(v) <= hi:
        raise HTTPException(400, "%s must be %d to %d characters." % (label, lo, hi))
    return v


def _email(v: str) -> str:
    v = (v or "").strip().lower()
    if len(v) > 254 or not EMAIL_RX.match(v):
        raise HTTPException(400, "Enter a valid email address.")
    return v


def _password(v: str) -> str:
    if len(v or "") < 8:
        raise HTTPException(400, "The password must be at least 8 characters.")
    if len(v) > 200:
        raise HTTPException(400, "The password is too long.")
    return v


def _admin_of_real_workspace(user: dict, c) -> dict:
    if user["role"] != "admin":
        raise HTTPException(403, "Only an admin can do this.")
    w = c.one("SELECT * FROM workspaces WHERE id = ?", (user["ws"],))
    if not w:
        raise HTTPException(401, "This workspace no longer exists. Log in again.")
    if w["is_demo"]:
        raise HTTPException(403, "The demo workspace is shared by everyone, so it cannot be changed. Create your own workspace to manage a team.")
    return w


@router.post("/api/auth/signup")
def signup(body: SignupIn, request: Request):
    if not signup_limit.allow(client_ip(request)):
        raise HTTPException(429, "Too many sign-ups from this address. Try again later.")
    wname, name = _text(body.workspace_name, "The workspace name", 2, 80), _text(body.name, "Your name", 1, 80)
    email, pw = _email(body.email), _password(body.password)
    wid, uid = "ws-" + uuid.uuid4().hex[:10], "m-" + uuid.uuid4().hex[:12]
    with db.connect() as c:
        if c.one("SELECT 1 AS x FROM users WHERE email = ?", (email,)):
            raise HTTPException(409, "An account with this email already exists. Log in instead.")
        c.run("INSERT INTO workspaces (id, name, ai_enabled, is_demo, created_at) VALUES (?, ?, 1, 0, ?)", (wid, wname, now()))
        c.run("INSERT INTO users (id, name, role, email, pw_hash, workspace_id) VALUES (?, ?, 'admin', ?, ?, ?)", (uid, name, email, auth.hash_password(pw), wid))
        return session(c, c.one("SELECT id, name, role, workspace_id FROM users WHERE id = ?", (uid,)))


@router.post("/api/auth/login")
def login(body: LoginIn, request: Request):
    global _dummy_hash
    email = (body.email or "").strip().lower()
    if not login_limit.allow(client_ip(request)) or not account_limit.allow(email):
        raise HTTPException(429, "Too many log-in attempts. Wait a few minutes and try again.")
    with db.connect() as c:
        u = c.one("SELECT id, name, role, workspace_id, pw_hash FROM users WHERE email = ?", (email,)) if email else None
        if u and u.get("pw_hash"):
            ok = auth.check_password(body.password or "", u["pw_hash"])
        else:
            _dummy_hash = _dummy_hash or auth.hash_password("not-a-real-password")
            auth.check_password(body.password or "", _dummy_hash)  # same work for unknown emails, so timing does not reveal them
            ok = False
        if not ok:
            raise HTTPException(401, "Wrong email or password.")
        return session(c, u)


@router.get("/api/workspace")
def workspace(user: dict = Depends(current_user)):
    with db.connect() as c:
        w = c.one("SELECT * FROM workspaces WHERE id = ?", (user["ws"],))
        if not w:
            raise HTTPException(401, "This workspace no longer exists. Log in again.")
        out = ws_out(w)
        if user["role"] == "admin":
            out["members"] = [{"id": m["id"], "name": m["name"], "role": m["role"], "email": m.get("email") or ""}
                              for m in c.rows("SELECT id, name, role, email FROM users WHERE workspace_id = ? ORDER BY name", (user["ws"],))]
        return out


@router.post("/api/workspace/members")
def add_member(body: MemberIn, user: dict = Depends(current_user)):
    name, email, pw = _text(body.name, "The name", 1, 80), _email(body.email), _password(body.password)
    if body.role not in MEMBER_ROLES:
        raise HTTPException(400, "Role must be one of: writer, legal, brand_manager, admin.")
    with db.connect() as c:
        _admin_of_real_workspace(user, c)
        if c.one("SELECT COUNT(*) AS n FROM users WHERE workspace_id = ?", (user["ws"],))["n"] >= MAX_USERS:
            raise HTTPException(409, "This workspace already has %d people, which is the limit." % MAX_USERS)
        if c.one("SELECT 1 AS x FROM users WHERE email = ?", (email,)):
            raise HTTPException(409, "An account with this email already exists.")
        uid = "m-" + uuid.uuid4().hex[:12]
        c.run("INSERT INTO users (id, name, role, email, pw_hash, workspace_id) VALUES (?, ?, ?, ?, ?, ?)", (uid, name, body.role, email, auth.hash_password(pw), user["ws"]))
        return {"id": uid, "name": name, "role": body.role, "email": email}


@router.put("/api/workspace/settings")
def settings(body: SettingsIn, user: dict = Depends(current_user)):
    with db.connect() as c:
        _admin_of_real_workspace(user, c)
        if body.ai_enabled is not None:
            c.run("UPDATE workspaces SET ai_enabled = ? WHERE id = ?", (1 if body.ai_enabled else 0, user["ws"]))
        if body.name is not None:
            c.run("UPDATE workspaces SET name = ? WHERE id = ?", (_text(body.name, "The workspace name", 2, 80), user["ws"]))
        return ws_out(c.one("SELECT * FROM workspaces WHERE id = ?", (user["ws"],)))


def ai_allowed(request: Request) -> bool:
    """False when the caller is signed in to a workspace whose admin switched the AI step off.
    Visitors with no login (the browser-only mode) belong to no workspace, so this switch does not apply to them."""
    h = request.headers.get("authorization", "")
    if not h.lower().startswith("bearer "):
        return True
    try:
        user = auth.read_token(h[7:].strip())
    except auth.AuthError:
        return True
    try:
        with db.connect() as c:
            w = c.one("SELECT ai_enabled FROM workspaces WHERE id = ?", (user["ws"],))
    except Exception:
        return False  # cannot check the switch, so do not send anything to the AI
    return bool(w["ai_enabled"]) if w else True