"""BrandSentinel review engine: a line-by-line Python port of src/engine.js.

Finding dictionaries keep the same camelCase keys as the JavaScript engine so the web page
can use the server's answers directly. Offsets are Python string indexes (code points); use
`to_utf16_offsets` before sending findings to a browser if the text may contain emoji.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone

STOP = set(
    "a an the and or of to in on for with is are was were be been it its this that these those at by from as we you "
    "your our their they he she i not no do does did can will would should could may might have has had than then so "
    "if but into over per up out about more most all any each every just also very every enjoy get got".split()
)
CLAIM_TRIGGERS = {
    "clinical", "clinically", "proven", "guarantee", "guarantees", "guaranteed", "certified", "cure", "cures", "cured",
    "treat", "treats", "prevent", "prevents", "reduce", "reduces", "lower", "lowers", "boost", "boosts", "best", "only",
    "first", "doctor", "doctors", "scientifically", "award", "winning",
}
SEV = {"high": 0, "medium": 1, "low": 2}


def _rx(pattern: str, flags: int = 0):
    # re.ASCII makes \w \d \b behave like JavaScript's.
    return re.compile(pattern, flags | re.ASCII)


CLAIM_RE = _rx(
    r"\b\d[\d,.]*\s?(%|percent|mg|kg|g|ml|oz|days?|years?|hours?|calories?|flavou?rs?|servings?)\b|"
    r"\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety|hundred)\s"
    r"(?:percent|milligrams?|kilograms?|grams?|mg|kg|ml|oz|days?|years?|hours?|calories?|flavou?rs?|servings?)\b|\$\d|"
    r"\b(clinically|proven|guarantee[sd]?|certified|award[- ]winning|number one|best|only|first|free shipping|made in|"
    r"since \d{4}|cures?|treats?|prevents?|reduces?|lowers?|boosts?|doctors?|dermatologists?|scientifically|returns?)\b|#1",
    re.I,
)
REGULATED_RE = _rx(r"clinically|clinical|\bcures?\b|\btreats?\b|\bprevents?\b|diagnos|doctor|dermatolog|scientifically|medical|disease", re.I)
NUM_RE = _rx(r"(\$)?(\d[\d,]*(?:\.\d+)?)\s?(%|percent|milligrams?|kilograms?|milliliters?|millilitres?|ounces?|grams?|mg|kg|ml|oz|g|days?|years?|hours?|minutes?|calories?|flavou?rs?|servings?)?(?![A-Za-z])", re.I)
WORD_RE = _rx(r"[A-Za-z0-9$%][\w'$%.,-]*")


def stem(w: str) -> str:
    w = w.lower()
    if len(w) > 5 and w.endswith("ing"):
        return w[:-3]
    if len(w) > 4 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 4 and w.endswith("ly"):
        return w[:-2]
    if len(w) > 4 and w.endswith("es"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s"):
        return w[:-1]
    return w


_NUMSTRIP = _rx(r"\d[\d,.]*")
_WORDS = _rx(r"[a-z][a-z'-]*")


def content_stems(s: str) -> list[str]:
    ws = [w for w in _WORDS.findall(_NUMSTRIP.sub(" ", s.lower())) if len(w) >= 3 and w not in STOP]
    return [stem(w) for w in ws]


def word_count(s: str) -> int:
    return len(WORD_RE.findall(s))


def escape_re(s: str) -> str:
    return re.escape(s)


# ---------- numbers ----------
def _norm_unit(u, cur, value, has_comma):
    if cur:
        return "$"
    if not u:
        return "yr" if (1900 <= value <= 2100 and not has_comma) else ""
    u = u.lower()
    if u == "percent":
        return "%"
    if u in ("flavour", "flavours"):
        return "flavor"
    base = re.sub(r"s$", "", u) or u
    return UNIT_ALIASES.get(base, base)


UNIT_ALIASES = {"milligram": "mg", "kilogram": "kg", "milliliter": "ml", "millilitre": "ml", "gram": "g", "ounce": "oz"}


def numbers_of(s: str) -> list[dict]:
    out = []
    for m in NUM_RE.finditer(s):
        try:
            value = float(m.group(2).replace(",", ""))
        except ValueError:
            continue
        raw = m.group(0).strip()
        out.append(
            {
                "raw": raw,
                "value": value,
                "unit": _norm_unit(m.group(3), m.group(1), value, "," in m.group(2)),
                "index": m.start(),
                "end": m.start() + len(m.group(0).rstrip()),
            }
        )
    return out


# ---------- sentences ----------
def split_sentences(text: str) -> list[dict]:
    out: list[dict] = []
    n = len(text)
    start = 0

    def push(e: int):
        s = start
        while s < e and text[s].isspace():
            s += 1
        t = e
        while t > s and text[t - 1].isspace():
            t -= 1
        if t > s:
            out.append({"start": s, "end": t, "text": text[s:t]})

    i = 0
    while i < n:
        c = text[i]
        if c == "\n":
            push(i)
            start = i + 1
        elif c in ".!?":
            j = i
            while j + 1 < n and text[j + 1] in ".!?":
                j += 1
            if j + 1 >= n or text[j + 1].isspace():
                push(j + 1)
                start = j + 1
            i = j
        i += 1
    push(n)
    return out


def sentence_at(sents: list[dict], pos: int):
    for s in sents:
        if s["start"] <= pos < s["end"]:
            return s
    for s in sents:
        if pos == s["end"]:
            return s
    return None


# ---------- readability ----------
def syllables(word: str) -> int:
    word = re.sub(r"[^a-z]", "", word.lower())
    if not word:
        return 0
    if len(word) <= 3:
        return 1
    word = _rx(r"(?:[^laeiouy]es|ed|[^laeiouy]e)$").sub("", word, count=1)
    word = re.sub(r"^y", "", word)
    m = re.findall(r"[aeiouy]{1,2}", word)
    return max(1, len(m) if m else 1)


def fk_grade(text: str) -> float:
    sents = [s for s in split_sentences(text) if word_count(s["text"]) > 0]
    words = _rx(r"[A-Za-z][A-Za-z'-]*").findall(text)
    if not sents or not words:
        return 0.0
    syl = sum(syllables(w) for w in words)
    return max(0.0, 0.39 * (len(words) / len(sents)) + 11.8 * (syl / len(words)) - 15.59)


# ---------- colour ----------
def hex_to_rgb(hex_: str):
    h = str(hex_).strip().replace("#", "")
    if len(h) == 3:
        h = "".join(c + c for c in h)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        return None
    return [int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]


def luminance(rgb) -> float:
    vals = []
    for v in rgb:
        v = v / 255
        vals.append(v / 12.92 if v <= 0.03928 else math.pow((v + 0.055) / 1.055, 2.4))
    return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2]


def contrast_ratio(a: str, b: str):
    A, B = hex_to_rgb(a), hex_to_rgb(b)
    if not A or not B:
        return None
    la, lb = luminance(A), luminance(B)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def colour_distance(a, b) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def nearest_palette(rgb, palette):
    best = None
    for p in palette:
        prgb = hex_to_rgb(p["hex"])
        if not prgb:
            continue
        d = colour_distance(rgb, prgb)
        if best is None or d < best["distance"]:
            best = {"name": p["name"], "hex": p["hex"], "distance": d}
    return best


# ---------- facts ----------
def _as_utc(now):
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now


def fact_status(fact: dict, now=None) -> dict:
    now = _as_utc(now)
    until = fact.get("validUntil")
    if until:
        end = datetime.fromisoformat(until + "T23:59:59+00:00")
        days = math.ceil((end - now).total_seconds() / 86400)
        if end < now:
            return {"state": "expired", "days": days, "until": until}
        if days <= 30:
            return {"state": "expiring", "days": days, "until": until}
        return {"state": "valid", "days": days, "until": until}
    return {"state": "valid", "days": None, "until": None}


def match_fact_legacy(sentence: str, facts: list[dict]):
    sw = set(content_stems(sentence))
    best = None
    for f in facts:
        if f.get("enabled") is False:
            continue
        fw = list(dict.fromkeys(content_stems(f["text"])))
        if not fw:
            continue
        overlap = len([w for w in fw if w in sw])
        score = overlap / len(fw)
        ok = (overlap >= 2 and score >= 0.5) or (len(fw) <= 2 and overlap == len(fw))
        if ok and (best is None or score > best["score"] or (score == best["score"] and overlap > best["overlap"])):
            best = {"fact": f, "score": score, "overlap": overlap}
    return best


# ---------- meaning-aware matching (Round 3, improvement 2) ----------
# Port of the JavaScript matcher; see src/engine.js for the explanation.
NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "hundred": 100,
}
_NUMBER_WORD_ALT = "|".join(NUMBER_WORDS.keys())
NUMBER_WORD_RE = _rx(r"\b(?:" + _NUMBER_WORD_ALT + r")\b")
SPELLED_RE = _rx(
    r"\b(" + _NUMBER_WORD_ALT + r")\s+(percent|milligrams?|kilograms?|milliliters?|millilitres?|ounces?|grams?|mg|kg|ml|oz|g|days?|years?|hours?|minutes?|calories?|flavou?rs?|servings?)(?![A-Za-z])",
    re.I,
)
MATCH_STOP = STOP | set("there when where which while after before because".split())
NEG_WORDS = set("not no never none nothing cannot without neither nor".split())
NEG_RE = _rx(r"\b(?:not|no|never|none|nothing|cannot|without|neither|nor)\b|n['’]t\b")
PHRASES = [
    (_rx(r"n['’]t\b"), " not"),
    (_rx(r"\bcheck[- ]?out\b"), "checkout"),
    (_rx(r"\bworked out\b"), "calculated"),
    (_rx(r"\b(?:send|sending|sent) back\b"), "return"),
    (_rx(r"\bplant[- ]based\b"), "vegan"),
    (_rx(r"\bfree (?:of|from) ([a-z]+)"), r"\1 free"),
    (_rx(r"\b(?:expiry|expiration) dates?\b"), "expire"),
    (_rx(r"\bmonday (?:to|through|thru|-) friday\b|\bweekdays?\b"), "weekday"),
]
CONCEPTS = [
    ["ship", "shipping", "shipped", "dispatch", "dispatched", "dispatching", "deliver", "delivers", "delivered", "delivery", "send", "sent"],
    ["return", "returns", "returned", "refund", "refunds"],
    ["accept", "accepted", "allow", "allowed", "permit", "permitted", "honor", "honored"],
    ["make", "made", "makes", "manufacture", "manufactured", "manufactures", "produce", "produced", "produces", "craft", "crafted"],
    ["contain", "contains", "contained", "include", "includes", "included", "hold", "holds", "held"],
    ["serving", "servings", "scoop", "scoops", "portion", "portions"],
    ["rate", "rates", "fee", "fees", "cost", "costs", "price", "prices", "charge", "charges"],
    ["calculate", "calculated", "calculates", "compute", "computed"],
    ["certify", "certified", "certification", "certifications"],
    ["corp", "corporation"],
    ["available", "offer", "offered", "offers", "open", "here", "come", "comes"],
    ["support", "service", "help"],
    ["box", "boxes", "pack", "packs"],
    ["within", "inside"],
    ["free", "complimentary"],
    ["expire", "expires", "expired", "expiry"],
]
_MWORD = _rx(r"[a-z]+")
_CAPWORD = _rx(r"[A-Za-z][A-Za-z'-]*")
_CAPSHAPE = _rx(r"[A-Z][a-z]{2,}")


def mstem(w: str) -> str:
    w = stem(w.lower())
    if len(w) > 5 and w.endswith("our"):
        w = w[:-3] + "or"
    return w[:-1] if len(w) > 3 and w.endswith("e") else w


CONCEPT_OF: dict[str, str] = {}
for _g in CONCEPTS:
    _head = mstem(_g[0])
    for _w in _g:
        CONCEPT_OF[mstem(_w)] = _head


def _canon(w: str) -> str:
    k = mstem(w)
    return CONCEPT_OF.get(k, k)


def match_tokens(text) -> list[str]:
    t = str(text).lower()
    for rx, to in PHRASES:
        t = rx.sub(to, t)
    t = _NUMSTRIP.sub(" ", NUMBER_WORD_RE.sub(" ", t))
    out: list[str] = []
    for w in _MWORD.findall(t):
        if len(w) < 3 or w in MATCH_STOP or w in NEG_WORDS:
            continue
        c = _canon(w)
        if c not in out:
            out.append(c)
    return out


def negates(text) -> bool:
    return bool(NEG_RE.search(str(text).lower()))


def cap_words(text) -> list[dict]:
    out = []
    for i, w in enumerate(_CAPWORD.findall(str(text))):
        if i == 0 or not _CAPSHAPE.fullmatch(w):
            continue
        lw = w.lower()
        if lw in MATCH_STOP or lw in NEG_WORDS:
            continue
        out.append({"raw": w, "lower": lw, "c": _canon(w)})
    return out


def name_conflict(sentence, fact_text):
    s_tok, f_tok = set(match_tokens(sentence)), set(match_tokens(fact_text))
    s_raw, f_raw = set(_MWORD.findall(str(sentence).lower())), set(_MWORD.findall(str(fact_text).lower()))
    left = [w for w in cap_words(fact_text) if w["c"] not in s_tok and w["lower"] not in s_raw]
    extra = [w for w in cap_words(sentence) if w["c"] not in f_tok and w["lower"] not in f_raw]
    return {"have": extra[0]["raw"], "want": left[0]["raw"]} if left and extra else None


def spelled_numbers(s: str) -> list[dict]:
    out = []
    for m in SPELLED_RE.finditer(s):
        out.append({"raw": m.group(0), "value": NUMBER_WORDS[m.group(1).lower()], "unit": _norm_unit(m.group(2), "", 0, False), "index": m.start(), "end": m.end()})
    return out


def all_numbers(s: str) -> list[dict]:
    return sorted(numbers_of(s) + spelled_numbers(s), key=lambda n: n["index"])


def match_fact(sentence: str, facts: list[dict]):
    live = [f for f in facts if f.get("enabled") is not False]
    toks = [match_tokens(f["text"]) for f in live]
    df: dict[str, int] = {}
    for ts in toks:
        for t in ts:
            df[t] = df.get(t, 0) + 1
    st = set(match_tokens(sentence))
    best = None
    for f, ft in zip(live, toks):
        if not ft:
            continue
        total = got = 0.0
        hit = 0
        for t in ft:
            w = 1 / df[t]
            total += w
            if t in st:
                got += w
                hit += 1
        score = got / total
        ok = (hit >= 2 and score >= 0.6) or (len(ft) <= 2 and hit == len(ft))
        if ok and (best is None or score > best["score"] or (score == best["score"] and hit > best["overlap"])):
            best = {"fact": f, "score": score, "overlap": hit}
    if best:
        best["negated"] = negates(sentence) != negates(best["fact"]["text"])
        best["nameConflict"] = name_conflict(sentence, best["fact"]["text"])
    return best


def claim_stance(sentence: str, m: dict) -> dict:
    fnums = all_numbers(m["fact"]["text"])
    c = next((n for n in all_numbers(sentence) if any(x["unit"] == n["unit"] and x["unit"] != "" and x["value"] != n["value"] for x in fnums)), None)
    if c:
        return {"stance": "conflict", "kind": "number", "number": c, "factNumber": next(x for x in fnums if x["unit"] == c["unit"])}
    if m.get("negated"):
        return {"stance": "conflict", "kind": "negation"}
    if m.get("nameConflict"):
        return {"stance": "conflict", "kind": "name", "have": m["nameConflict"]["have"], "want": m["nameConflict"]["want"]}
    return {"stance": "supported"}


def weak_fact(sentence: str, facts: list[dict]):
    sw = set(content_stems(sentence))
    best = None
    for f in facts:
        if f.get("enabled") is False:
            continue
        overlap = len([w for w in dict.fromkeys(content_stems(f["text"])) if w in sw])
        if overlap >= 1 and (best is None or overlap > best["overlap"]):
            best = {"fact": f, "overlap": overlap}
    return best


# ---------- meaning check ----------
_CAPS = _rx(r"(?<=[a-z,;:)]\s)[A-Z][a-zA-Z]{2,}")


def keep_chips(sentence: str, drop_numbers=None) -> list[str]:
    drop = {x.lower() for x in (drop_numbers or [])}
    chips: list[str] = []
    for n in numbers_of(sentence):
        if n["raw"].lower() not in drop:
            chips.append(n["raw"])
    for c in _CAPS.findall(sentence):
        if c not in chips:
            chips.append(c)
    content = [w for w in content_stems(sentence) if w not in CLAIM_TRIGGERS and (w + "s") not in CLAIM_TRIGGERS]
    seen = {stem(c) for c in chips}
    for w in sorted(dict.fromkeys(content), key=lambda x: -len(x))[:3]:
        if w not in seen and not re.match(r"^\d", w):
            chips.append(w)
            seen.add(w)
    return chips


def meaning_check(original: str, rewrite: str, must_keep=None, allowed_new=None) -> dict:
    rw_stems = set(content_stems(rewrite))
    rw_nums = numbers_of(rewrite)
    missing = []
    for k in [str(x).strip() for x in (must_keep or [])]:
        if not k:
            continue
        if re.search(r"\d", k):
            kns = numbers_of(k)
            kn = kns[0] if kns else None
            found = any(n["value"] == kn["value"] and n["unit"] == kn["unit"] for n in rw_nums) if kn else (k in rewrite)
            if not found:
                missing.append(k)
        else:
            ks = content_stems(k)
            ok = all(w in rw_stems for w in ks) if ks else (k.lower() in rewrite.lower())
            if not ok:
                missing.append(k)
    added = []
    orig_nums = numbers_of(original)
    allowed = [n for t in (allowed_new or []) for n in numbers_of(t)]
    for n in rw_nums:
        in_orig = any(o["value"] == n["value"] and o["unit"] == n["unit"] for o in orig_nums)
        in_allowed = any(o["value"] == n["value"] and o["unit"] == n["unit"] for o in allowed)
        if not in_orig and not in_allowed:
            added.append(n["raw"])
    orig_stems = set(content_stems(original))
    allow_stems = {w for t in (allowed_new or []) for w in content_stems(t)}
    for w in dict.fromkeys(content_stems(rewrite)):  # keep first-seen order, like a JavaScript Set
        if w in CLAIM_TRIGGERS and w not in orig_stems and w not in allow_stems:
            added.append(w)
    os_ = list(orig_stems)
    retained = (len([w for w in os_ if w in rw_stems]) / len(os_)) if os_ else 1
    return {"ok": not missing and not added, "missing": missing, "added": added, "retained": retained}


_DOUBLE_WORD = _rx(r"\b([A-Za-z]{3,}) \1\b", re.I)


def tidy(s: str) -> str:
    s = _DOUBLE_WORD.sub(r"\1", s)
    s = re.sub(r" {2,}", " ", s)
    s = re.sub(r" ([,.;:!?])", r"\1", s)
    s = s.replace("( ", "(")
    return s


def apply_fix(text: str, finding: dict, fix: dict) -> str:
    # scope "sentence" replaces the whole sentence the finding sits in, not just the quoted words
    a, b = (finding["ctxStart"], finding["ctxEnd"]) if fix.get("scope") == "sentence" else (finding["start"], finding["end"])
    out = tidy(text[:a] + fix["replacement"] + text[b:])
    return out.lstrip(" ")


def context_after(text: str, finding: dict, fix: dict):
    cs, ce = finding["ctxStart"], finding["ctxEnd"]
    before = text[cs:ce]
    if fix.get("scope") == "sentence":
        after = tidy(fix["replacement"])
    else:
        after = tidy(text[cs : finding["start"]] + fix["replacement"] + text[finding["end"] : ce])
    return before, after


def evaluate_fixes(finding: dict, text: str, must_keep=None) -> dict:
    keep = must_keep if must_keep is not None else (finding.get("keep") or [])
    ok, blocked = [], []
    for fx in finding.get("fixes") or []:
        before, after = context_after(text, finding, fx)
        check = meaning_check(before, after, keep, finding.get("allowedNew") or [])
        item = dict(fx, before=before, after=after, check=check)
        (ok if check["ok"] else blocked).append(item)
    return {"ok": ok, "blocked": blocked}


# ---------- fix helpers ----------
def match_case(found: str, repl: str) -> str:
    if not repl:
        return repl
    if found == found.upper() and len(found) > 1:
        return repl.upper()
    if found[0] == found[0].upper():
        return repl[0].upper() + repl[1:]
    return repl


_SPLIT_RE = re.compile(r"(, and |, but |; |, so )")


def split_long(sentence: str):
    mid = len(sentence) / 2
    cands = [{"i": m.start(), "len": len(m.group(0)), "kind": m.group(0)} for m in _SPLIT_RE.finditer(sentence)]
    if not cands:
        return None
    cands.sort(key=lambda c: abs(c["i"] - mid))
    c = cands[0]
    left = re.sub(r"[.!?]+$", "", sentence[: c["i"]])
    right = sentence[c["i"] + c["len"] :]
    joiner = re.sub(r"^[,;]\s*", "", c["kind"].strip())
    if joiner in ("but", "so"):
        right = joiner[0].upper() + joiner[1:] + ", " + right
    else:
        right = right[0].upper() + right[1:]
    return left + ". " + right


SOFTEN = [
    (re.compile(r"clinically proven to reduce", re.I), "made to help with"),
    (re.compile(r"clinically proven to", re.I), "made to"),
    (re.compile(r"clinically proven", re.I), "formulated"),
    (re.compile(r"guarantees?", re.I), "aims to deliver"),
    (re.compile(r"\bcures?\b", re.I), "may help with"),
    (re.compile(r"\bprevents?\b", re.I), "may help limit"),
    (re.compile(r"\bthe best\b", re.I), "a great"),
]


def soften(sentence: str):
    out = sentence
    for rx, rep in SOFTEN:
        if rx.search(out):
            out = rx.sub(lambda m: match_case(m.group(0), rep), out, count=1)
            break
    return None if out == sentence else out


def source_label(sources: dict, id_: str) -> str:
    for k in ("rules", "terms", "facts"):
        for it in sources.get(k) or []:
            if it["id"] == id_:
                return (it.get("source") or sources.get("name") or "Source library") + " · " + it["id"]
    return id_


# ---------- main review ----------
def review_text(text: str, sources: dict, now=None) -> dict:
    now = _as_utc(now)
    rules = {r["id"]: r for r in sources.get("rules") or []}

    def on(id_):
        return id_ in rules and rules[id_].get("enabled") is not False

    sents = split_sentences(text)
    findings: list[dict] = []
    verified: list[dict] = []

    def add(f: dict):
        s = sentence_at(sents, max(0, f["start"] if f["start"] >= 0 else 0))
        if "ctxStart" not in f:
            f["ctxStart"] = s["start"] if s else f["start"]
        if "ctxEnd" not in f:
            f["ctxEnd"] = s["end"] if s else f["end"]
        f["key"] = f["ruleId"] + "|" + (f.get("quote") or "").lower()
        f["id"] = "F" + str(len(findings) + 1)
        f["status"] = "open"
        f.setdefault("origin", "rule")
        f.setdefault("confidence", 1)
        f["sourceLabel"] = source_label(sources, f.get("sourceId") or f["ruleId"])
        f["fixes"] = [dict({"id": f["id"] + "-" + str(i + 1)}, **fx) for i, fx in enumerate(f.get("fixes") or [])]
        if f["start"] >= 0 and "keep" not in f:
            f["keep"] = keep_chips(text[f["ctxStart"] : f["ctxEnd"]], f.get("dropNumbers"))
            if f["category"] != "claim" and f["end"] - f["start"] < f["ctxEnd"] - f["ctxStart"]:
                # A word-level fix is meant to change the quoted words, so they are not part of the meaning to preserve.
                q = set(content_stems(f["quote"]))
                ql = f["quote"].lower()

                def keep_it(c):
                    cs = content_stems(c)
                    return not (c.lower() in ql or (cs and all(w in q for w in cs)))

                f["keep"] = [c for c in f["keep"] if keep_it(c)]
        findings.append(f)

    # terminology
    for t in sources.get("terms") or []:
        if t.get("enabled") is False:
            continue
        rx = _rx(r"(?<![A-Za-z])" + escape_re(t["avoid"]) + r"(?![A-Za-z])", re.I)
        for m in rx.finditer(text):
            prefer = t.get("prefer")
            repl = match_case(m.group(0), prefer) if prefer else ""
            add(
                {
                    "ruleId": t["id"], "sourceId": t["id"], "category": "terminology", "severity": t.get("severity") or "medium",
                    "start": m.start(), "end": m.end(), "quote": m.group(0),
                    "title": ('Use "' + prefer + '" instead of "' + m.group(0) + '"') if prefer else ('Avoid "' + m.group(0) + '"'),
                    "explanation": t["reason"],
                    "fixes": [{"label": ('Change to "' + repl + '"') if prefer else ('Remove "' + m.group(0) + '"'), "replacement": repl}],
                }
            )

    # tone
    if on("R-TONE-EXCL"):
        mx = (rules["R-TONE-EXCL"].get("params") or {}).get("max")
        mx = 1 if mx is None else mx
        count = 0
        for m in _rx(r"!+(?!\[)").finditer(text):
            count += 1
            if count > mx:
                add(
                    {
                        "ruleId": "R-TONE-EXCL", "category": "tone", "severity": "low", "start": m.start(), "end": m.end(), "quote": m.group(0),
                        "title": "Too many exclamation marks", "explanation": rules["R-TONE-EXCL"]["text"],
                        "fixes": [{"label": "End the sentence with a full stop", "replacement": "."}],
                    }
                )
    if on("R-TONE-HYPE"):
        for h in (rules["R-TONE-HYPE"].get("params") or {}).get("words") or []:
            rx = _rx(r"(?<![A-Za-z])" + escape_re(h["word"]) + r"(?![A-Za-z])\s?", re.I)
            for m in rx.finditer(text):
                found = m.group(0).rstrip()
                alt = h.get("alt")
                add(
                    {
                        "ruleId": "R-TONE-HYPE", "category": "tone", "severity": "medium", "start": m.start(), "end": m.start() + len(found), "quote": found,
                        "title": '"' + found + '" sounds like hype', "explanation": h.get("why") or rules["R-TONE-HYPE"]["text"],
                        "fixes": [{"label": ('Change to "' + alt + '"') if alt else ('Remove "' + found + '"'), "replacement": match_case(found, alt) if alt else ""}],
                    }
                )
    if on("R-TONE-CAPS"):
        allow = {x.upper() for x in (rules["R-TONE-CAPS"].get("params") or {}).get("allow") or []}
        for m in _rx(r"\b[A-Z]{4,}\b").finditer(text):
            if m.group(0) in allow:
                continue
            low = m.group(0)[0] + m.group(0)[1:].lower()
            add(
                {
                    "ruleId": "R-TONE-CAPS", "category": "tone", "severity": "low", "start": m.start(), "end": m.end(), "quote": m.group(0),
                    "title": "Shouting in capitals", "explanation": rules["R-TONE-CAPS"]["text"],
                    "fixes": [{"label": 'Use normal case: "' + low + '"', "replacement": low}],
                }
            )

    # readability
    if on("R-READ-LEN"):
        mx = (rules["R-READ-LEN"].get("params") or {}).get("maxWords") or 28
        for s in sents:
            wc = word_count(s["text"])
            if wc > mx:
                sp = split_long(s["text"])
                add(
                    {
                        "ruleId": "R-READ-LEN", "category": "readability", "severity": "low", "start": s["start"], "end": s["end"], "quote": s["text"],
                        "title": "Sentence has " + str(wc) + " words (limit " + str(mx) + ")", "explanation": rules["R-READ-LEN"]["text"],
                        "fixes": [{"label": "Split into two sentences", "replacement": sp}] if sp else [],
                    }
                )
    grade = fk_grade(text)
    if on("R-READ-GRADE") and word_count(text) >= 40 and grade > ((rules["R-READ-GRADE"].get("params") or {}).get("maxGrade") or 10):
        add(
            {
                "ruleId": "R-READ-GRADE", "category": "readability", "severity": "low", "start": -1, "end": -1, "quote": "",
                "title": "Reading level is grade " + ("%.1f" % grade), "explanation": rules["R-READ-GRADE"]["text"], "fixes": [],
            }
        )

    # accessibility in text
    if on("R-A11Y-ALT"):
        for m in _rx(r"!\[\s*\]\([^)]*\)").finditer(text):
            add({"ruleId": "R-A11Y-ALT", "category": "accessibility", "severity": "high", "start": m.start(), "end": m.end(), "quote": m.group(0), "title": "Image has no alt text", "explanation": rules["R-A11Y-ALT"]["text"], "fixes": [], "keep": []})
        for m in _rx(r'<img\b(?![^>]*\balt\s*=\s*"[^"]+")[^>]*>', re.I).finditer(text):
            add({"ruleId": "R-A11Y-ALT", "category": "accessibility", "severity": "high", "start": m.start(), "end": m.end(), "quote": m.group(0), "title": "Image has no alt text", "explanation": rules["R-A11Y-ALT"]["text"], "fixes": [], "keep": []})
    if on("R-A11Y-LINK"):
        for m in _rx(r"\[(click here|here|read more|link)\]\([^)]*\)|\bclick here\b", re.I).finditer(text):
            add({"ruleId": "R-A11Y-LINK", "category": "accessibility", "severity": "low", "start": m.start(), "end": m.end(), "quote": m.group(0), "title": "Link text does not say where it goes", "explanation": rules["R-A11Y-LINK"]["text"], "fixes": [], "keep": []})

    # confidentiality
    if on("R-CONF-1"):
        for term in sources.get("confidential") or []:
            if not term.strip():
                continue
            rx = _rx(r"(?<![A-Za-z])" + escape_re(term.strip()) + r"(?![A-Za-z])", re.I)
            for m in rx.finditer(text):
                add(
                    {
                        "ruleId": "R-CONF-1", "category": "confidentiality", "severity": "high", "start": m.start(), "end": m.end(), "quote": m.group(0),
                        "title": '"' + m.group(0) + '" is a confidential name', "explanation": rules["R-CONF-1"]["text"],
                        "needsSpecialist": True, "fixes": [{"label": 'Remove "' + m.group(0) + '"', "replacement": ""}, {"label": "Remove this sentence", "replacement": "", "scope": "sentence"}],
                    }
                )

    # claims, one clause at a time
    units = []
    split_re = _rx(r",\s+and\s+|;\s+|,\s+but\s+")
    for s in sents:
        parts, last = [], 0
        for m in split_re.finditer(s["text"]):
            parts.append((last, m.start()))
            last = m.end()
        parts.append((last, len(s["text"])))
        for a, b in parts:
            units.append({"start": s["start"] + a, "end": s["start"] + b, "text": s["text"][a:b]})

    facts = [f for f in sources.get("facts") or [] if f.get("enabled") is not False]
    if on("R-CLAIM-1"):
        for s in units:
            if not CLAIM_RE.search(s["text"]):
                continue
            m = match_fact(s["text"], facts)
            regulated = bool(REGULATED_RE.search(s["text"]))
            if not m:
                weak = weak_fact(s["text"], facts)
                fixes = []
                soft = soften(s["text"])
                if soft:
                    fixes.append({"label": "Soften the wording (still needs legal review)", "replacement": soft})
                if weak:
                    fixes.append({"label": 'Use approved wording: "' + weak["fact"]["text"] + '"', "replacement": re.sub(r"[.]*$", ".", weak["fact"]["text"], count=1)})
                fixes.append({"label": "Remove this claim", "replacement": ""})
                add(
                    {
                        "ruleId": "R-CLAIM-REG" if regulated else "R-CLAIM-1",
                        "sourceId": "R-CLAIM-REG" if (regulated and on("R-CLAIM-REG")) else "R-CLAIM-1",
                        "category": "claim", "severity": "high" if regulated else "medium", "start": s["start"], "end": s["end"], "quote": s["text"],
                        "title": "Unverified claim: no approved fact supports this",
                        "explanation": "No approved fact in the library backs this statement. "
                        + ("It sounds like a health or scientific claim, so it needs legal sign-off with evidence. " if regulated else "")
                        + "Add evidence to the fact library, reword it, or send it for human review.",
                        "unverified": True, "needsSpecialist": True, "fixes": fixes, "confidence": 0.9,
                    }
                )
                continue
            f = m["fact"]
            st = fact_status(f, now)
            fnums = all_numbers(f["text"])
            conflicts = [n for n in all_numbers(s["text"]) if any(x["unit"] == n["unit"] and x["unit"] != "" and x["value"] != n["value"] for x in fnums)]
            if conflicts:
                c = conflicts[0]
                fn = next(x for x in fnums if x["unit"] == c["unit"])
                add(
                    {
                        "ruleId": "R-CLAIM-1", "sourceId": f["id"], "category": "claim", "severity": "high", "start": s["start"] + c["index"], "end": s["start"] + c["end"], "quote": c["raw"],
                        "ctxStart": s["start"], "ctxEnd": s["end"], "dropNumbers": [c["raw"]],
                        "title": "Says " + c["raw"] + ", approved fact says " + fn["raw"],
                        "explanation": "Approved fact " + f["id"] + ': "' + f["text"] + '". The draft number does not match.',
                        "needsSpecialist": True, "allowedNew": [fn["raw"]], "fixes": [{"label": 'Change to "' + fn["raw"] + '"', "replacement": fn["raw"]}],
                        "confidence": 0.95, "factId": f["id"],
                    }
                )
            elif m["negated"]:
                add(
                    {
                        "ruleId": "R-CLAIM-1", "sourceId": f["id"], "category": "claim", "severity": "high", "start": s["start"], "end": s["end"], "quote": s["text"],
                        "title": "Says the opposite of approved fact " + f["id"],
                        "explanation": "Approved fact " + f["id"] + ': "' + f["text"] + '". This sentence says the opposite, so it cannot go out as written.',
                        "needsSpecialist": True, "factId": f["id"], "confidence": 0.85, "keep": [],
                        "fixes": [{"label": 'Use approved wording: "' + f["text"] + '"', "replacement": re.sub(r"[.]*$", ".", f["text"], count=1)}, {"label": "Remove this claim", "replacement": ""}],
                    }
                )
            elif m["nameConflict"]:
                nc = m["nameConflict"]
                add(
                    {
                        "ruleId": "R-CLAIM-1", "sourceId": f["id"], "category": "claim", "severity": "high", "start": s["start"], "end": s["end"], "quote": s["text"],
                        "title": 'Says "' + nc["have"] + '", approved fact says "' + nc["want"] + '"',
                        "explanation": "Approved fact " + f["id"] + ': "' + f["text"] + '". The name in this sentence does not match.',
                        "needsSpecialist": True, "factId": f["id"], "confidence": 0.8, "keep": [],
                        "fixes": [{"label": 'Use approved wording: "' + f["text"] + '"', "replacement": re.sub(r"[.]*$", ".", f["text"], count=1)}, {"label": "Remove this claim", "replacement": ""}],
                    }
                )
            elif st["state"] == "expired":
                alt = next((x for x in facts if x["id"] != f["id"] and x.get("replaces") == f["id"] and fact_status(x, now)["state"] != "expired"), None)
                add(
                    {
                        "ruleId": "R-FACT-EXPIRED", "sourceId": f["id"], "category": "claim", "severity": "high", "start": s["start"], "end": s["end"], "quote": s["text"],
                        "title": "Outdated: approved fact expired on " + st["until"],
                        "explanation": 'This statement matches "' + f["text"] + '", which was only valid until ' + st["until"] + ". Ask the brand manager to renew the fact, or remove the claim.",
                        "needsSpecialist": True, "factId": f["id"], "confidence": 0.95, "keep": [],
                        "fixes": [{"label": 'Use current fact: "' + alt["text"] + '"', "replacement": re.sub(r"[.]*$", ".", alt["text"], count=1)}] if alt else [],
                    }
                )
            elif st["state"] == "expiring":
                add(
                    {
                        "ruleId": "R-FACT-EXPIRING", "sourceId": f["id"], "category": "claim", "severity": "low", "start": s["start"], "end": s["end"], "quote": s["text"],
                        "title": "Fact expires in " + str(st["days"]) + " day" + ("" if st["days"] == 1 else "s"),
                        "explanation": 'This statement relies on "' + f["text"] + '", valid until ' + st["until"] + ". Check the publish date is before then.",
                        "factId": f["id"], "confidence": 0.95, "fixes": [],
                    }
                )
            else:
                verified.append({"sentence": s["text"], "factId": f["id"], "factText": f["text"], "until": st["until"]})

    findings.sort(key=lambda f: (SEV[f["severity"]], f["start"]))
    for i, f in enumerate(findings):
        f["id"] = "F" + str(i + 1)
        for j, fx in enumerate(f["fixes"]):
            fx["id"] = f["id"] + "-" + str(j + 1)
    return {"findings": findings, "verified": verified, "stats": {"sentences": len(sents), "words": word_count(text), "grade": grade}}


# ---------- image / visual checks ----------
def check_visual(inp: dict, sources: dict) -> list[dict]:
    rules = {r["id"]: r for r in sources.get("rules") or []}

    def on(id_):
        return id_ in rules and rules[id_].get("enabled") is not False

    out: list[dict] = []

    def push(f):
        f.update({"id": "V" + str(len(out) + 1), "status": "open", "origin": "rule", "confidence": 1, "start": -1, "end": -1, "fixes": [], "sourceLabel": source_label(sources, f["ruleId"])})
        out.append(f)

    if on("R-A11Y-ALT") and not (inp.get("alt") or "").strip():
        push({"ruleId": "R-A11Y-ALT", "category": "accessibility", "severity": "high", "quote": "", "title": "Image has no alt text", "explanation": rules["R-A11Y-ALT"]["text"]})
    if inp.get("fg") and inp.get("bg") and on("R-A11Y-CONTRAST"):
        r = contrast_ratio(inp["fg"], inp["bg"])
        mn = (rules["R-A11Y-CONTRAST"].get("params") or {}).get("min") or 4.5
        if r is not None and r < mn:
            push({"ruleId": "R-A11Y-CONTRAST", "category": "accessibility", "severity": "high", "quote": "", "title": "Text contrast is %.2f:1 (needs %s:1)" % (r, mn), "explanation": rules["R-A11Y-CONTRAST"]["text"]})
    if on("R-VIS-PALETTE"):
        tol = (rules["R-VIS-PALETTE"].get("params") or {}).get("tolerance") or 60
        for d in inp.get("dominant") or []:
            if d["share"] < 0.1:
                continue
            rgb = hex_to_rgb(d["hex"])
            if not rgb:
                continue
            np_ = nearest_palette(rgb, sources.get("palette") or [])
            if np_ and np_["distance"] > tol:
                push(
                    {
                        "ruleId": "R-VIS-PALETTE", "category": "visual", "severity": "medium", "quote": d["hex"],
                        "title": "%d%% of the image is %s, which is not a brand colour" % (round(d["share"] * 100), d["hex"]),
                        "explanation": rules["R-VIS-PALETTE"]["text"] + " Closest brand colour: " + np_["name"] + " " + np_["hex"] + ".",
                    }
                )
    if inp.get("isLogo") and on("R-VIS-LOGO"):
        mn = (rules["R-VIS-LOGO"].get("params") or {}).get("minWidth") or 120
        if inp.get("width") and inp["width"] < mn:
            push({"ruleId": "R-VIS-LOGO", "category": "visual", "severity": "medium", "quote": "", "title": "Logo is %dpx wide (minimum %dpx)" % (inp["width"], mn), "explanation": rules["R-VIS-LOGO"]["text"]})
    return out


# ---------- privacy: redaction and retrieval ----------
def redact(text: str, confidential=None) -> dict:
    out, log = text, {}

    def bump(k, c=1):
        log[k] = log.get(k, 0) + c

    for term in confidential or []:
        if not term.strip():
            continue

        def sub_conf(_m):
            bump("confidential term")
            return "[CONFIDENTIAL]"

        out = re.sub(re.escape(term.strip()), sub_conf, out, flags=re.I)

    def sub_email(_m):
        bump("email")
        return "[EMAIL]"

    out = _rx(r"[\w.+-]+@[\w-]+\.[\w.-]+").sub(sub_email, out)

    def sub_phone(m):
        if "." in m.group(0) or re.fullmatch(r"\d{4}-\d{2}-\d{2}", m.group(0).strip()):
            return m.group(0)  # decimals and ISO dates (2026-09-30) are not phone numbers
        bump("phone")
        return "[PHONE]"

    out = _rx(r"(?<![\w$])\+?\d[\d\s-]{8,}\d(?!\w)").sub(sub_phone, out)
    return {"text": out, "redactions": [{"kind": k, "count": c} for k, c in log.items()]}


def retrieve(segment: str, sources: dict, k: int = 6) -> list[dict]:
    sw = set(content_stems(segment))
    items = []
    for r in sources.get("rules") or []:
        if r.get("enabled") is not False:
            items.append({"id": r["id"], "type": "rule", "text": r["title"] + ". " + r["text"]})
    for t in sources.get("terms") or []:
        if t.get("enabled") is not False:
            items.append({"id": t["id"], "type": "term", "text": 'Avoid "' + t["avoid"] + '"' + (', prefer "' + t["prefer"] + '"' if t.get("prefer") else "") + ". " + t["reason"]})
    for f in sources.get("facts") or []:
        if f.get("enabled") is not False:
            items.append({"id": f["id"], "type": "fact", "text": f["text"]})
    for g in sources.get("guidelines") or []:
        items.append({"id": g["id"], "type": "guideline", "text": g["text"]})
    scored = [(len([w for w in content_stems(it["text"]) if w in sw]) + (0.5 if it["type"] == "guideline" else 0), it) for it in items]
    scored.sort(key=lambda x: -x[0])
    return [it for _, it in scored[:k]]


# ---------- evaluation on a labelled set ----------
def evaluate_set(cases: list[dict], sources: dict, now=None) -> dict:
    planted = caught = flagged = tp = 0
    misses, false_pos = [], []
    for c in cases:
        res = review_text(c["text"], sources, now)
        used: set[int] = set()
        for p in c.get("planted") or []:
            planted += 1
            hit = -1
            for i, f in enumerate(res["findings"]):
                ctx = c["text"][f["ctxStart"] : f["ctxEnd"]] if f["start"] >= 0 else ""
                if i not in used and f["ruleId"] == p["ruleId"] and p["contains"].lower() in (f["quote"] + " " + ctx).lower():
                    hit = i
                    break
            if hit >= 0:
                caught += 1
                used.add(hit)
            else:
                misses.append({"case": c["id"], "ruleId": p["ruleId"], "contains": p["contains"]})
        for i, f in enumerate(res["findings"]):
            if f["ruleId"] in ("R-READ-GRADE", "R-FACT-EXPIRING") and not any(p["ruleId"] == f["ruleId"] for p in c.get("planted") or []):
                continue
            flagged += 1
            if i in used:
                tp += 1
            else:
                false_pos.append({"case": c["id"], "ruleId": f["ruleId"], "quote": f["quote"]})
    return {
        "planted": planted, "caught": caught, "recall": caught / planted if planted else 1, "flagged": flagged,
        "precision": tp / flagged if flagged else 1, "misses": misses, "falsePos": false_pos, "cases": len(cases),
    }


# ---------- browser offsets ----------
def _u16(text: str, idx: int) -> int:
    return len(text[:idx].encode("utf-16-le")) // 2


def to_utf16_offsets(text: str, findings: list[dict]) -> list[dict]:
    """Browsers index strings in UTF-16 units. Convert offsets so emoji and other non-BMP characters line up."""
    if all(ord(c) < 0x10000 for c in text):
        return findings
    out = []
    for f in findings:
        g = dict(f)
        for k in ("start", "end", "ctxStart", "ctxEnd"):
            if k in g and g[k] is not None and g[k] >= 0:
                g[k] = _u16(text, g[k])
        out.append(g)
    return out