"""Server-side drafts, approvals and history, plus demo login. Roles are checked here, not in the browser."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import auth, db, workflow as wf

router = APIRouter()
ID_RX = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
MAX_DATA = 300_000  # characters of JSON per draft


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def current_user(request: Request) -> dict:
    h = request.headers.get("authorization", "")
    if not h.lower().startswith("bearer "):
        raise HTTPException(401, "Log in with a demo account first.")
    try:
        return auth.read_token(h[7:].strip())
    except auth.AuthError as e:
        raise HTTPException(503 if "AUTH_SECRET" in str(e) else 401, str(e))


def _pack(r: dict, names: dict) -> dict:
    return {"id": r["id"], "title": r["title"], "status": r["status"], "authorId": r["author_id"], "authorName": names.get(r["author_id"], r["author_id"]),
            "needsLegal": bool(r["needs_legal"]), "createdAt": r["created_at"], "updatedAt": r["updated_at"], "data": json.loads(r["data"])}


def _names(c) -> dict:
    return {u["id"]: u["name"] for u in c.rows("SELECT id, name FROM users")}


def _event(c, sid: str, actor: str, kind: str, detail: str = ""):
    c.run("INSERT INTO events (id, submission_id, at, actor_id, kind, detail) VALUES (?, ?, ?, ?, ?, ?)", (uuid.uuid4().hex, sid, now(), actor, kind, detail[:500]))


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


@router.post("/api/auth/demo")
def demo_login(body: DemoIn):
    with db.connect() as c:
        u = c.one("SELECT id, name, role FROM users WHERE role = ? ORDER BY id", (body.role,))
    if not u:
        raise HTTPException(400, "Unknown role.")
    try:
        return {"token": auth.make_token(u), "user": u}
    except auth.AuthError as e:
        raise HTTPException(503, str(e))


@router.get("/api/me")
def me(user: dict = Depends(current_user)):
    return user


@router.get("/api/submissions")
def list_submissions(user: dict = Depends(current_user)):
    with db.connect() as c:
        names = _names(c)
        return [_pack(r, names) for r in c.rows("SELECT * FROM submissions ORDER BY updated_at DESC LIMIT 200")]


@router.post("/api/submissions")
def create_submission(body: DraftIn, user: dict = Depends(current_user)):
    if not wf.can(user["role"], "create"):
        raise HTTPException(403, "Only writers can start a review.")
    data = _check_data(body.data)
    sid, t = "P-" + uuid.uuid4().hex[:6].upper(), now()
    with db.connect() as c:
        c.run("INSERT INTO submissions (id, title, status, author_id, needs_legal, data, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)",
              (sid, body.title, user["id"], 1 if body.data.get("needsLegal") else 0, data, t, t))
        _event(c, sid, user["id"], "created", body.title)
        return _pack(c.one("SELECT * FROM submissions WHERE id = ?", (sid,)), _names(c))


def _load(c, sid: str) -> dict:
    if not ID_RX.match(sid):
        raise HTTPException(400, "Bad id.")
    r = c.one("SELECT * FROM submissions WHERE id = ?", (sid,))
    if not r:
        raise HTTPException(404, "No such draft.")
    return r


@router.put("/api/submissions/{sid}")
def save_submission(sid: str, body: DraftIn, user: dict = Depends(current_user)):
    data = _check_data(body.data)
    with db.connect() as c:
        r = _load(c, sid)
        if not wf.can(user["role"], "revise") or r["author_id"] != user["id"]:
            raise HTTPException(403, "Only the writer who started this draft can change it.")
        if r["status"] not in ("draft", "changes_requested"):
            raise HTTPException(409, "This draft is in review and cannot be edited.")
        c.run("UPDATE submissions SET title = ?, data = ?, needs_legal = ?, updated_at = ? WHERE id = ?", (body.title, data, 1 if body.data.get("needsLegal") else 0, now(), sid))
        return _pack(c.one("SELECT * FROM submissions WHERE id = ?", (sid,)), _names(c))


@router.post("/api/submissions/{sid}/transition")
def transition(sid: str, body: TransitionIn, user: dict = Depends(current_user)):
    with db.connect() as c:
        r = _load(c, sid)
        role = user["role"]
        if body.action == "submit":
            if not wf.can(role, "submit") or r["author_id"] != user["id"]:
                raise HTTPException(403, "Only the writer who started this draft can submit it.")
            if r["status"] not in ("draft", "changes_requested"):
                raise HTTPException(409, "This draft is already in review.")
            to = body.route if body.route in ("awaiting_specialist", "awaiting_manager") else "awaiting_manager"
            if r["needs_legal"]:
                to = "awaiting_specialist"  # a reworded unverified claim always goes to Legal, whatever the browser says
        else:
            res = wf.transition({"status": r["status"]}, role, body.action)
            if not res["ok"]:
                raise HTTPException(403 if "Only" in res["reason"] or "cannot" in res["reason"] else 409, res["reason"])
            to = res["to"]
        c.run("UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?", (to, now(), sid))
        _event(c, sid, user["id"], body.action, body.note)
        return _pack(c.one("SELECT * FROM submissions WHERE id = ?", (sid,)), _names(c))


@router.get("/api/submissions/{sid}/events")
def events(sid: str, user: dict = Depends(current_user)):
    with db.connect() as c:
        _load(c, sid)
        names = _names(c)
        return [{"at": e["at"], "actor": names.get(e["actor_id"], e["actor_id"]), "kind": e["kind"], "detail": e["detail"]}
                for e in c.rows("SELECT * FROM events WHERE submission_id = ? ORDER BY at", (sid,))]