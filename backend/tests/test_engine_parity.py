"""The Python engine must give the same answers as the JavaScript engine (golden.json is produced by tools/make_golden.js)."""
import copy
import json
import math
import pathlib
import unittest
from datetime import datetime, timezone

from app import engine as E

HERE = pathlib.Path(__file__).parent
G = json.loads((HERE / "golden.json").read_text(encoding="utf-8"))
SEED = json.loads((HERE.parent / "app" / "seed.json").read_text(encoding="utf-8"))
NOW = datetime.fromisoformat(G["now"].replace("Z", "+00:00"))


def variants():
    base = SEED["sources"]
    renewed = copy.deepcopy(base)
    next(f for f in renewed["facts"] if f["id"] == "F-04")["validUntil"] = "2026-12-31"
    nohype = copy.deepcopy(base)
    next(r for r in nohype["rules"] if r["id"] == "R-TONE-HYPE")["enabled"] = False
    nohype["terms"][0]["enabled"] = False
    return {"base": base, "renewed": renewed, "nohype": nohype}


V = variants()
KEYS = ["id", "ruleId", "sourceId", "category", "severity", "start", "end", "quote", "title", "explanation", "ctxStart", "ctxEnd", "key", "status",
        "origin", "confidence", "sourceLabel", "keep", "unverified", "needsSpecialist", "allowedNew", "factId"]


def pick(f):
    d = {k: f.get(k) for k in KEYS}
    if d["keep"] is None:
        d["keep"] = None
    d["unverified"] = d["unverified"] or None
    d["needsSpecialist"] = d["needsSpecialist"] or None
    d["sourceId"] = d["sourceId"] or None
    d["factId"] = d["factId"] or None
    d["fixes"] = [{"id": x["id"], "label": x["label"], "replacement": x["replacement"]} for x in f["fixes"]]
    return d


def close(a, b):
    if isinstance(a, float) or isinstance(b, float):
        return a is not None and b is not None and math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)
    return a == b


class Parity(unittest.TestCase):
    def test_reviews_match_javascript(self):
        for case in G["reviews"]:
            with self.subTest(variant=case["variant"], text=case["text"][:50]):
                r = E.review_text(case["text"], V[case["variant"]], NOW)
                self.assertEqual([pick(f) for f in r["findings"]], case["findings"])
                self.assertEqual(r["verified"], case["verified"])
                self.assertEqual(r["stats"]["sentences"], case["stats"]["sentences"])
                self.assertEqual(r["stats"]["words"], case["stats"]["words"])
                self.assertTrue(close(r["stats"]["grade"], case["stats"]["grade"]))

    def test_fix_evaluation_matches_javascript(self):
        for case in G["reviews"]:
            r = E.review_text(case["text"], V[case["variant"]], NOW)
            for f, exp in zip(r["findings"], case["fixes"]):
                with self.subTest(variant=case["variant"], finding=f["id"], text=case["text"][:40]):
                    ev = E.evaluate_fixes(f, case["text"])
                    self.assertEqual([[x["id"], x["after"], x["check"]["ok"]] for x in ev["ok"]], exp["ok"])
                    self.assertEqual([[x["id"], x["after"], x["check"]["missing"], x["check"]["added"]] for x in ev["blocked"]], exp["blocked"])

    def test_labelled_set_matches_javascript(self):
        for name, exp in G["evals"].items():
            with self.subTest(variant=name):
                r = E.evaluate_set(SEED["evalSet"], V[name], NOW)
                for k in ("planted", "caught", "flagged", "cases", "misses", "falsePos"):
                    self.assertEqual(r[k], exp[k], k)
                self.assertTrue(close(r["recall"], exp["recall"]))
                self.assertTrue(close(r["precision"], exp["precision"]))

    def test_units(self):
        U = G["units"]
        for s, exp in U["numbers"]:
            self.assertEqual([{k: n[k] for k in ("raw", "value", "unit", "index", "end")} for n in E.numbers_of(s)], exp, s)
        for s, exp in U["chips"]:
            self.assertEqual(E.keep_chips(s), exp, s)
        for a, b, k, n, exp in U["meaning"]:
            r = E.meaning_check(a, b, k, n)
            self.assertEqual({"ok": r["ok"], "missing": r["missing"], "added": r["added"]}, {x: exp[x] for x in ("ok", "missing", "added")})
            self.assertTrue(close(r["retained"], exp["retained"]))
        for t, exp in U["grade"]:
            self.assertTrue(close(E.fk_grade(t), exp), t)
        for a, b, exp in U["contrast"]:
            got = E.contrast_ratio(a, b)
            self.assertTrue(got is None and exp is None or close(got, exp), (a, b))
        for s, exp in U["redact"]:
            self.assertEqual(E.redact(s, SEED["sources"]["confidential"]), exp, s)
        for s, exp in U["retrieve"]:
            self.assertEqual([x["id"] for x in E.retrieve(s, SEED["sources"], 5)], exp, s)
        for s, exp in U["sentences"]:
            self.assertEqual(E.split_sentences(s), exp, s)
        for inp, exp in U["visual"]:
            got = [{k: f[k] for k in ("ruleId", "title", "severity", "category")} for f in E.check_visual(inp, SEED["sources"])]
            self.assertEqual(got, exp)
        for u, exp in U["factStatus"]:
            self.assertEqual(E.fact_status({"validUntil": u}, NOW), exp)

    def test_utf16_offsets_for_emoji(self):
        text = "Hey \U0001F600 guys!"
        r = E.review_text(text, SEED["sources"], NOW)
        f = next(x for x in r["findings"] if x["ruleId"] == "T-02")
        self.assertEqual(text[f["start"]:f["end"]], "guys")
        g = E.to_utf16_offsets(text, [f])[0]
        self.assertEqual((g["start"], g["end"]), (f["start"] + 1, f["end"] + 1))  # the emoji is two UTF-16 units


if __name__ == "__main__":
    unittest.main()
