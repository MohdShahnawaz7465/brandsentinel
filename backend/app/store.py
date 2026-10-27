"""Server-side drafts, approvals and history. Roles and workspaces are checked here, not in the browser.
Every draft belongs to one workspace; a user can only see and change drafts of their own workspace."""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import auth, db, engine as E, workflow as wf

router = APIRouter()
ID_RX = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
MAX_DATA = 300_000  # characters of JSON per draft
HERE = os.path.dirname(os.path.abspath(__file__))
_SOURCES: dict | None = None


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def current_user(request: Request) -> dict:
    h = request.headers.get("authorization", "")
    if not h.lower().startswith("bearer "):
        raise HTTPException(401, "Log in first.")
    try:
        return auth.read_token(h[7:].strip())
    except auth.AuthError as e:
        raise HTTPException(503 if "AUTH_SECRET" in str(e) else 401, str(e))


def ws_out(w: dict) -> dict:
    return {"id": w["id"], "name": w["name"], "aiEnabled": bool(w["ai_enabled"]), "isDemo": bool(w["is_demo"])}


def _pack(r: dict, names: dict) -> dict:
    return {"id": r["id"], "title": r["title"], "status": r["status"], "authorId": r["author_id"], "authorName": names.get(r["author_id"], r["author_id"]),
            "needsLegal": bool(r["needs_legal"]), "createdAt": r["created_at"], "updatedAt": r["updated_at"], "data": json.loads(r["data"])}


def _names(c, ws: str) -> dict:
    return {u["id"]: u["name"] for u in c.rows("SELECT id, name FROM users WHERE workspace_id = ?", (ws,))}


def _event(c, sid: str, actor: str, kind: str, detail: str = ""):
    c.run("INSERT INTO events (id, submission_id, at, actor_id, kind, detail) VALUES (?, ?, ?, ?, ?, ?)", (uuid.uuid4().hex, sid, now(), actor, kind, detail[:500]))


def _sources() -> dict:
    global _SOURCES
    if _SOURCES is None:
        with open(os.path.join(HERE, "seed.json"), encoding="utf-8") as f:
            _SOURCES = json.load(f)["sources"]
    return _SOURCES


def legal_required(data: dict) -> bool:
    """The server decides for itself whether Legal must sign off, so a browser cannot skip Legal.
    Legal is needed when the draft was flagged, or when the submitted text still holds a claim or fact
    that needs a specialist. The server checks against the built-in sources, so it can only add Legal, never remove it."""
    if data.get("needsLegal"):
        return True
    versions = data.get("versions")
    if not isinstance(versions, list) or not versions or not isinstance(versions[-1], dict):
        return False
    text = versions[-1].get("text")
    if not isinstance(text, str) or not text.strip() or text.startswith("[Image]"):
        return False
    try:
        res = E.review_text(text[:20000], _sources())
    except Exception:
        return False
    return any(f.get("needsSpecialist") for f in res["findings"])


class DemoIn(BaseModel):
    role: str


class DraftIn(BaseModel):
    title: str = Field("Untitled draft", max_length=200)
    data: dict = Field(default_factory=dict)


class TransitionIn(BaseModel):
    action: str
    route: Optional[str] = None
    note: str = Field("", max_length=500)


def _check_data(d: dict) -> str:
    s = json.dumps(d, ensure_ascii=False)
    if len(s) > MAX_DATA:
        raise HTTPException(413, "This draft is too large to save on the server.")
    return s


def session(c, u: dict) -> dict:
    """The login answer: a token, the user and the workspace."""
    w = c.one("SELECT * FROM workspaces WHERE id = ?", (u["workspace_id"],))
    user = {"id": u["id"], "name": u["name"], "role": u["role"], "ws": u["workspace_id"]}
    try:
        token = auth.make_token(user)
    except auth.AuthError as e:
        raise HTTPException(503, str(e))
    return {"token": token, "user": {"id": u["id"], "name": u["name"], "role": u["role"]}, "workspace": ws_out(w)}


@router.post("/api/auth/demo")
def demo_login(body: DemoIn):
    with db.connect() as c:
        u = c.one("SELECT id, name, role, workspace_id FROM users WHERE role = ? AND workspace_id = ? ORDER BY id", (body.role, db.DEMO_WS))
        if not u:
            raise HTTPException(400, "Unknown role.")
        return session(c, u)


@router.get("/api/me")
def me(user: dict = Depends(current_user)):
    with db.connect() as c:
        w = c.one("SELECT * FROM workspaces WHERE id = ?", (user["ws"],))
        if not w:
            raise HTTPException(401, "This workspace no longer exists. Log in again.")
        return {"id": user["id"], "name": user["name"], "role": user["role"], "workspace": ws_out(w)}


@router.get("/api/submissions")
def list_submissions(user: dict = Depends(current_user)):
    with db.connect() as c:
        names = _names(c, user["ws"])
        return [_pack(r, names) for r in c.rows("SELECT * FROM submissions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200", (user["ws"],))]


@router.post("/api/submissions")
def create_submission(body: DraftIn, user: dict = Depends(current_user)):
    if not wf.can(user["role"], "create"):
        raise HTTPException(403, "Only writers can start a review.")
    data = _check_data(body.data)
    sid, t = "P-" + uuid.uuid4().hex[:6].upper(), now()
    with db.connect() as c:
        c.run("INSERT INTO submissions (id, title, status, author_id, needs_legal, data, created_at, updated_at, workspace_id) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?)",
              (sid, body.title, user["id"], 1 if body.data.get("needsLegal") else 0, data, t, t, user["ws"]))
        _event(c, sid, user["id"], "created", body.title)
        return _pack(c.one("SELECT * FROM submissions WHERE id = ?", (sid,)), _names(c, user["ws"]))


def _load(c, sid: str, user: dict) -> dict:
    if not ID_RX.match(sid):
        raise HTTPException(400, "Bad id.")
    r = c.one("SELECT * FROM submissions WHERE id = ? AND workspace_id = ?", (sid, user["ws"]))
    if not r:
        raise HTTPException(404, "No such draft.")  # a draft of another workspace looks exactly like a missing one
    return r


@router.put("/api/submissions/{sid}")
def save_submission(sid: str, body: DraftIn, user: dict = Depends(current_user)):
    data = _check_data(body.data)
    with db.connect() as c:
        r = _load(c, sid, user)
        if not wf.can(user["role"], "revise") or r["author_id"] != user["id"]:
            raise HTTPException(403, "Only the writer who started this draft can change it.")
        if r["status"] not in ("draft", "changes_requested"):
            raise HTTPException(409, "This draft is in review and cannot be edited.")
        c.run("UPDATE submissions SET title = ?, data = ?, needs_legal = ?, updated_at = ? WHERE id = ?", (body.title, data, 1 if body.data.get("needsLegal") else 0, now(), sid))
        return _pack(c.one("SELECT * FROM submissions WHERE id = ?", (sid,)), _names(c, user["ws"]))


@router.post("/api/submissions/{sid}/transition")
def transition(sid: str, body: TransitionIn, user: dict = Depends(current_user)):
    with db.connect() as c:
        r = _load(c, sid, user)
        role, note = user["role"], body.note
        if body.action == "submit":
            if not wf.can(role, "submit") or r["author_id"] != user["id"]:
                raise HTTPException(403, "Only the writer who started this draft can submit it.")
            if r["status"] not in ("draft", "changes_requested"):
                raise HTTPException(409, "This draft is already in review.")
            to = body.route if body.route in ("awaiting_specialist", "awaiting_manager") else "awaiting_manager"
            if r["needs_legal"] or legal_required(json.loads(r["data"])):
                # Whatever the browser says, a draft that still holds an unverified claim goes to Legal first.
                if to != "awaiting_specialist":
                    note = (note + " " if note else "") + "(The server sent it to Legal: it still holds a claim that needs sign-off.)"
                to = "awaiting_specialist"
                c.run("UPDATE submissions SET needs_legal = 1 WHERE id = ?", (sid,))
        else:
            res = wf.transition({"status": r["status"]}, role, body.action)
            if not res["ok"]:
                raise HTTPException(403 if "Only" in res["reason"] or "cannot" in res["reason"] else 409, res["reason"])
            to = res["to"]
        c.run("UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?", (to, now(), sid))
        _event(c, sid, user["id"], body.action, note)
        return _pack(c.one("SELECT * FROM submissions WHERE id = ?", (sid,)), _names(c, user["ws"]))


@router.get("/api/submissions/{sid}/events")
def events(sid: str, user: dict = Depends(current_user)):
    with db.connect() as c:
        _load(c, sid, user)
        names = _names(c, user["ws"])
        return [{"at": e["at"], "actor": names.get(e["actor_id"], e["actor_id"]), "kind": e["kind"], "detail": e["detail"]}
                for e in c.rows("SELECT * FROM events WHERE submission_id = ? ORDER BY at", (sid,))]