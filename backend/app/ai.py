"""AI step: send a few redacted sentences plus retrieved sources to a swappable provider, keep only findings
that cite a real source and quote real text, and build the "what left our system" receipt.
Port of src/ai.js. Providers use only the standard library, so there is nothing extra to install."""
from __future__ import annotations

import asyncio
import json
import math
import re
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from . import engine as E

CATS = ["tone", "messaging", "terminology", "claim"]
SEVS = ["low", "medium", "high"]
MAX_SEGMENTS, MAX_CHARS = 10, 1800


class Provider:
    """name + an async call(prompt) -> dict."""

    def __init__(self, name: str, call: Callable[[str], Awaitable[dict]]):
        self.name = name
        self.call = call


def pick_segments(text: str, local_findings: list[dict]) -> list[dict]:
    def covered(s):
        return any(f["start"] >= 0 and f["start"] < s["end"] and f["end"] > s["start"] and f["category"] != "readability" for f in local_findings)

    out, chars = [], 0
    for s in E.split_sentences(text):
        if E.word_count(s["text"]) < 6 or covered(s):
            continue
        if len(out) >= MAX_SEGMENTS or chars + len(s["text"]) > MAX_CHARS:
            break
        out.append(s)
        chars += len(s["text"])
    return out


def build_prompt(brand: str, segments: list[dict], items: list[dict]) -> str:
    return "\n".join(
        [
            "You are a careful brand reviewer for " + brand + ". Review ONLY the numbered sentences below.",
            'Report a problem only when it breaks one of the SOURCES. Never invent a source. Copy "quote" exactly from the sentence.',
            "Each suggestion rewrites only the quoted text and must keep the writer's meaning. At most 3 suggestions.",
            'Return JSON only, in this shape: {"findings":[{"segment":0,"quote":"...","sourceId":"G-1","category":"tone|messaging|terminology|claim","severity":"low|medium|high","title":"short title","explanation":"why, in plain words","confidence":0.0,"suggestions":["..."]}]}',
            'If nothing is wrong return {"findings":[]}.',
            "",
            "SENTENCES:",
            "\n".join(str(i) + ": " + s["text"] for i, s in enumerate(segments)),
            "",
            "SOURCES:",
            "\n".join("[" + it["id"] + "] (" + it["type"] + ") " + it["text"] for it in items),
        ]
    )


def build_receipt(mode: str, provider: str = "", reason: str = "", sent=None, redactions=None, source_ids=None, accepted: int = 0, blocked=None, error: str = "") -> dict:
    sent = sent or []
    return {
        "id": "R" + uuid.uuid4().hex[:10],
        "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "mode": mode, "provider": provider, "reason": reason, "sent": sent, "redactions": redactions or [],
        "sourceIds": source_ids or [], "bytes": sum(len(s["text"]) for s in sent), "accepted": accepted,
        "blocked": blocked or [], "error": error,
    }


async def ai_review(text: str, sources: dict, local_findings: list[dict], provider: Optional[Provider], enabled: bool) -> dict:
    if not enabled:
        return {"findings": [], "receipt": build_receipt("rules-only", reason="AI review is switched off by an admin. Nothing left this page.")}
    if provider is None:
        return {"findings": [], "receipt": build_receipt("rules-only", reason="No AI provider is configured. Nothing left this page.")}
    segs = pick_segments(text, local_findings)
    if not segs:
        return {"findings": [], "receipt": build_receipt("rules-only", provider=provider.name, reason="Every sentence was already handled by the fixed checks, so nothing was sent.")}

    redactions, sent = [], []
    for i, s in enumerate(segs):
        r = E.redact(s["text"], sources.get("confidential"))
        redactions.extend(r["redactions"])
        sent.append({"index": i, "text": r["text"]})
    seen: dict[str, dict] = {}
    for s in sent:
        for it in E.retrieve(s["text"], sources, 5):
            seen.setdefault(it["id"], it)
    items = list(seen.values())[:12]
    source_ids = [i["id"] for i in items]
    prompt = build_prompt(sources.get("name") or "the brand", sent, items)

    try:
        raw = await provider.call(prompt)
    except Exception as e:  # report in the receipt instead of failing the review
        return {"findings": [], "receipt": build_receipt("ai-assisted", provider.name, sent=sent, redactions=redactions, source_ids=source_ids, error=str(e) or e.__class__.__name__)}

    lst = raw.get("findings") if isinstance(raw, dict) and isinstance(raw.get("findings"), list) else []
    blocked, findings = [], []
    valid = set(source_ids)
    for f in lst:
        title = (f.get("title") if isinstance(f, dict) else None) or "(untitled)"

        def why(reason, title=title):
            blocked.append({"reason": reason, "title": title})

        if not isinstance(f, dict):
            why("not a finding object")
            continue
        seg_i = f.get("segment")
        if isinstance(seg_i, bool) or not isinstance(seg_i, int) or not (0 <= seg_i < len(segs)):
            why("refers to a sentence that was not sent")
            continue
        seg = segs[seg_i]
        if f.get("sourceId") not in valid:
            why('cites "' + str(f.get("sourceId")) + '", which is not in the source library')
            continue
        red_seg = sent[seg_i]["text"]
        quote = f.get("quote")
        if not quote or not isinstance(quote, str) or quote not in red_seg or re.search(r"\[(CONFIDENTIAL|EMAIL|PHONE)\]", quote):
            why("quote does not appear in the sentence")
            continue
        idx = seg["text"].find(quote)
        if idx < 0:
            why("quote cannot be located in the original text")
            continue
        start = seg["start"] + idx
        end = start + len(quote)
        if any(l["start"] >= 0 and l["start"] < end and l["end"] > start and l["category"] != "readability" for l in local_findings):
            why("already caught by a fixed check")
            continue
        try:
            conf = float(f.get("confidence"))
            conf = 0.5 if math.isnan(conf) else max(0.0, min(1.0, conf))
        except (TypeError, ValueError):
            conf = 0.5
        n = len(findings) + 1
        sugg = [x for x in (f.get("suggestions") if isinstance(f.get("suggestions"), list) else [])[:3] if isinstance(x, str)]
        findings.append(
            {
                "id": "A" + str(n), "ruleId": f["sourceId"], "sourceId": f["sourceId"], "origin": "ai",
                "category": f.get("category") if f.get("category") in CATS else "messaging",
                "severity": f.get("severity") if f.get("severity") in SEVS else "medium",
                "start": start, "end": end, "quote": quote, "ctxStart": seg["start"], "ctxEnd": seg["end"],
                "title": str(f.get("title") or "AI-assisted finding")[:120], "explanation": str(f.get("explanation") or "")[:500],
                "confidence": conf,
                "fixes": [{"id": "A" + str(n) + "-" + str(i + 1), "label": "AI suggestion", "replacement": x} for i, x in enumerate(sugg)],
                "status": "open", "sourceLabel": E.source_label(sources, f["sourceId"]) or f["sourceId"],
                "key": f["sourceId"] + "|" + quote.lower(), "keep": E.keep_chips(seg["text"]),
            }
        )
    return {"findings": findings, "receipt": build_receipt("ai-assisted", provider.name, sent=sent, redactions=redactions, source_ids=source_ids, accepted=len(findings), blocked=blocked)}


# ---------- providers ----------
def parse_json_loose(t: Any) -> dict:
    if isinstance(t, dict):
        return t
    s = str(t or "").strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
    s = re.sub(r"```\s*$", "", s)
    a, b = s.find("{"), s.rfind("}")
    if a >= 0 and b > a:
        s = s[a : b + 1]
    return json.loads(s)


def _post_json(url: str, headers: dict, body: dict, timeout: float) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=dict({"Content-Type": "application/json", "User-Agent": "BrandSentinel/1.0"}, **headers), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError("AI endpoint answered " + str(e.code)) from None
    except urllib.error.URLError as e:
        raise RuntimeError("Could not reach the AI endpoint: " + str(e.reason)) from None


def openai_compatible(url: str, model: str, key: str = "", timeout: float = 60) -> Provider:
    """Any OpenAI-style chat endpoint (OpenAI, Azure, Ollama, vLLM, LM Studio...)."""
    host = re.sub(r"^https?://", "", url).split("/")[0]

    async def call(prompt: str) -> dict:
        j = await asyncio.to_thread(
            _post_json, url, {"Authorization": "Bearer " + key} if key else {},
            {"model": model, "temperature": 0, "messages": [{"role": "user", "content": prompt}]}, timeout,
        )
        return parse_json_loose(j["choices"][0]["message"]["content"])

    return Provider(model + " via " + host, call)


def anthropic(key: str, model: str, base_url: str = "https://api.anthropic.com", timeout: float = 60) -> Provider:
    async def call(prompt: str) -> dict:
        j = await asyncio.to_thread(
            _post_json, base_url.rstrip("/") + "/v1/messages", {"x-api-key": key, "anthropic-version": "2023-06-01"},
            {"model": model, "max_tokens": 1500, "temperature": 0, "messages": [{"role": "user", "content": prompt}]}, timeout,
        )
        return parse_json_loose("".join(b.get("text", "") for b in j["content"] if b.get("type") == "text"))

    return Provider(model + " via Anthropic", call)
