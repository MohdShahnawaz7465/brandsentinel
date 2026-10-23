"""Roles, routing, version diff and insights. Port of src/workflow.js."""
from __future__ import annotations

STATUS = {
    "draft": "Draft", "awaiting_specialist": "Waiting for Legal", "awaiting_manager": "Waiting for Brand manager",
    "changes_requested": "Changes requested", "approved": "Approved",
}
PERMS = {
    "writer": ["create", "submit", "revise", "comment"],
    "brand_manager": ["approve", "request_changes", "edit_sources", "edit_facts", "comment"],
    "legal": ["signoff", "request_changes", "edit_facts", "comment"],
    "admin": ["settings", "edit_sources", "edit_facts", "comment"],
}


def can(role: str, action: str) -> bool:
    return action in PERMS.get(role, [])


def open_count(findings) -> int:
    return len([f for f in findings if f.get("status") == "open"])


def needs_specialist(findings) -> bool:
    return any(f.get("status") != "fixed" and f.get("needsSpecialist") for f in findings)


def validate_submit(sub: dict, findings: list[dict]) -> dict:
    if not findings and not sub.get("versions"):
        return {"ok": False, "reason": "Run a check first."}
    n = open_count(findings)
    if n:
        return {"ok": False, "reason": "%d finding%s still open. Apply a fix, edit the text, or dispute it with a reason." % (n, " is" if n == 1 else "s are")}
    if any(f.get("status") == "disputed" and not (f.get("reason") or "").strip() for f in findings):
        return {"ok": False, "reason": "A disputed finding needs a reason."}
    return {"ok": True, "route": "awaiting_specialist" if (needs_specialist(findings) or sub.get("needsLegal")) else "awaiting_manager"}


def transition(sub: dict, role: str, action: str) -> dict:
    s = sub["status"]
    if action == "signoff":
        if not can(role, "signoff"):
            return {"ok": False, "reason": "Only a Legal reviewer can sign off."}
        if s != "awaiting_specialist":
            return {"ok": False, "reason": "Nothing is waiting for Legal."}
        return {"ok": True, "to": "awaiting_manager"}
    if action == "approve":
        if not can(role, "approve"):
            return {"ok": False, "reason": "Only a Brand manager can approve."}
        if s == "awaiting_specialist":
            return {"ok": False, "reason": "Legal must sign off first."}
        if s != "awaiting_manager":
            return {"ok": False, "reason": "This piece is not waiting for approval."}
        return {"ok": True, "to": "approved"}
    if action == "request_changes":
        if not can(role, "request_changes"):
            return {"ok": False, "reason": "Your role cannot request changes."}
        if s not in ("awaiting_specialist", "awaiting_manager"):
            return {"ok": False, "reason": "This piece is not in review."}
        return {"ok": True, "to": "changes_requested"}
    return {"ok": False, "reason": "Unknown action."}


def diff_words(a: str, b: str) -> list[dict]:
    import re

    A = [x for x in re.split(r"(\s+)", a) if x]
    B = [x for x in re.split(r"(\s+)", b) if x]
    n, m = len(A), len(B)
    L = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            L[i][j] = L[i + 1][j + 1] + 1 if A[i] == B[j] else max(L[i + 1][j], L[i][j + 1])
    out: list[dict] = []

    def push(t, typ):
        if out and out[-1]["type"] == typ:
            out[-1]["t"] += t
        else:
            out.append({"t": t, "type": typ})

    i = j = 0
    while i < n and j < m:
        if A[i] == B[j]:
            push(A[i], "same"); i += 1; j += 1
        elif L[i + 1][j] >= L[i][j + 1]:
            push(A[i], "del"); i += 1
        else:
            push(B[j], "add"); j += 1
    while i < n:
        push(A[i], "del"); i += 1
    while j < m:
        push(B[j], "add"); j += 1
    return out


def insights(subs: list[dict], rule_title=lambda x: x) -> dict:
    first: dict[str, int] = {}
    disputed: dict[str, dict] = {}
    by_author: dict[str, dict[str, int]] = {}
    clear = unclear = 0
    for s in subs:
        rule_set = []
        for f in s.get("firstCheck") or []:
            first[f["ruleId"]] = first.get(f["ruleId"], 0) + 1
            if f["ruleId"] not in rule_set:
                rule_set.append(f["ruleId"])
        for r in rule_set:
            by_author.setdefault(s["author"], {})
            by_author[s["author"]][r] = by_author[s["author"]].get(r, 0) + 1
        for f in s.get("final") or []:
            if f.get("status") == "disputed":
                d = disputed.setdefault(f["ruleId"], {"n": 0, "reasons": []})
                d["n"] += 1
                if f.get("reason"):
                    d["reasons"].append(f["reason"])
        for f in s.get("feedback") or []:
            if f.get("clear"):
                clear += 1
            else:
                unclear += 1
    top = sorted(({"ruleId": r, "title": rule_title(r), "count": c} for r, c in first.items()), key=lambda x: -x["count"])
    disputes = []
    for r, total in first.items():
        d = disputed.get(r, {"n": 0, "reasons": []})
        if d["n"] > 0:
            disputes.append({"ruleId": r, "title": rule_title(r), "total": total, "disputed": d["n"], "rate": d["n"] / total, "reasons": list(dict.fromkeys(d["reasons"]))})
    disputes.sort(key=lambda x: (-x["rate"], -x["disputed"]))
    unclear_rules = [d for d in disputes if d["rate"] >= 0.5 and d["total"] >= 2]
    repeats = [{"author": a, "ruleId": r, "title": rule_title(r), "count": n} for a, m in by_author.items() for r, n in m.items() if n >= 2]
    repeats.sort(key=lambda x: -x["count"])
    total = clear + unclear
    return {
        "topRules": top, "disputes": disputes, "unclearRules": unclear_rules, "repeats": repeats,
        "clarity": {"clear": clear, "unclear": unclear, "total": total, "pct": round(100 * clear / total) if total else None},
        "totals": {"submissions": len(subs), "approved": len([s for s in subs if s.get("status") == "approved"])},
    }
