"""HTTP API for BrandSentinel. Run from the backend folder:
    python -m uvicorn app.server:app --reload --port 8000
Docs page (try every endpoint in the browser): http://127.0.0.1:8000/docs"""
from __future__ import annotations

import json
import os
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import ai, db, engine as E
from .store import router as store_router
from .config import load_env

load_env()
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "seed.json"), encoding="utf-8") as f:
    SEED = json.load(f)

app = FastAPI(title="BrandSentinel API", version="0.3")
# ALLOWED_ORIGINS in .env: comma-separated frontend addresses. "*" (everything) is only for local development.
ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])

app.include_router(store_router)


@app.exception_handler(db.NoDatabase)
async def no_database(request: Request, exc: db.NoDatabase):
    from fastapi.responses import JSONResponse

    return JSONResponse({"detail": str(exc)}, status_code=503)


RATE_LIMIT, RATE_WINDOW = int(os.environ.get("AI_RATE_LIMIT", "20")), 60.0  # AI requests per minute per visitor
GLOBAL_LIMIT = int(os.environ.get("AI_GLOBAL_LIMIT", "120"))  # AI requests per minute for everyone together (protects the API key)
_hits: dict[str, deque] = defaultdict(deque)
_all_hits: deque = deque()


def client_ip(request: Request) -> str:
    """Visitor address. Behind a host's proxy every request looks like it comes from the proxy, so with
    TRUST_PROXY=1 we use the LAST X-Forwarded-For entry (added by the host's own proxy). The first entry
    can be faked by the visitor, so it is never used."""
    if os.environ.get("TRUST_PROXY") == "1":
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else "unknown"


def too_many(ip: str) -> bool:
    now, q = time.monotonic(), _hits[ip]
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    while _all_hits and now - _all_hits[0] > RATE_WINDOW:
        _all_hits.popleft()
    if len(q) >= RATE_LIMIT or len(_all_hits) >= GLOBAL_LIMIT:
        return True
    q.append(now)
    _all_hits.append(now)
    return False


def make_provider() -> Optional[ai.Provider]:
    key = os.environ.get("GROQ_API_KEY", "")
    if not key:
        return None
    model = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")
    return ai.openai_compatible("https://api.groq.com/openai/v1/chat/completions", model, key)


class ReviewIn(BaseModel):
    text: str = Field(..., max_length=20000)
    use_ai: bool = True


class AICompleteIn(BaseModel):
    prompt: str = Field(..., max_length=12000)


class MeaningIn(BaseModel):
    original: str
    rewrite: str
    must_keep: Optional[list[str]] = None


@app.get("/api/health")
def health():
    return {"ok": True, "ai_configured": make_provider() is not None, "model": os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b"), "brand": SEED["sources"].get("name")}


@app.get("/api/sources")
def sources():
    s = SEED["sources"]
    return {"name": s.get("name"), "version": s.get("version"), "rules": s.get("rules"), "terms": s.get("terms"), "facts": s.get("facts"), "guidelines": s.get("guidelines")}


@app.get("/api/samples")
def samples():
    return SEED["samples"]


@app.post("/api/review")
async def review(body: ReviewIn, request: Request):
    # The AI step costs money, so it shares the same limits as /api/ai-complete. Rules-only reviews stay free.
    if body.use_ai and make_provider() is not None and too_many(client_ip(request)):
        raise HTTPException(429, "Too many AI requests. Wait a minute and try again, or send use_ai=false.")
    res = E.review_text(body.text, SEED["sources"])
    local = res["findings"]
    out = await ai.ai_review(body.text, SEED["sources"], local, make_provider(), body.use_ai)
    findings = E.to_utf16_offsets(body.text, local + out["findings"])
    return {"findings": findings, "verified": res["verified"], "stats": res["stats"], "receipt": out["receipt"]}


@app.post("/api/meaning-check")
def meaning_check(body: MeaningIn):
    return E.meaning_check(body.original, body.rewrite, body.must_keep)


@app.get("/api/evaluate")
def evaluate():
    return E.evaluate_set(SEED["evalSet"], SEED["sources"])


@app.post("/api/ai-complete")
async def ai_complete(body: AICompleteIn, request: Request):
    """Proxy for the browser's AI step. The browser has already redacted the sentences; the API key stays here."""
    if too_many(client_ip(request)):
        raise HTTPException(429, "Too many AI requests. Wait a minute and try again.")
    if "SENTENCES:" not in body.prompt or "SOURCES:" not in body.prompt:
        raise HTTPException(400, "This endpoint only accepts BrandSentinel review prompts.")
    provider = make_provider()
    if provider is None:
        raise HTTPException(503, "No AI key is configured on the server.")
    try:
        # Second safety layer: the browser already redacted, the server removes emails, phone numbers and known confidential names again.
        prompt = E.redact(body.prompt, SEED["sources"].get("confidential"))["text"]
        return await provider.call(prompt)
    except Exception as e:
        raise HTTPException(502, "The AI step failed: " + (str(e) or e.__class__.__name__))