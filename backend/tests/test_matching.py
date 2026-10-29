"""The claim-to-fact matcher in Python must give the same answers as the JavaScript one on the measured test set."""
import json
import math
import pathlib
import unittest

from app import engine as E

HERE = pathlib.Path(__file__).parent
SET = HERE.parents[1] / "test" / "matching_testset.json"  # lives at the project root, next to the JavaScript tests
GOLD = json.loads((HERE / "matching_golden.json").read_text(encoding="utf-8"))


@unittest.skipUnless(SET.exists(), "matching_testset.json is not next to the backend folder")
class Matching(unittest.TestCase):
    def setUp(self):
        self.t = json.loads(SET.read_text(encoding="utf-8"))

    def answers(self):
        for c in self.t["cases"]:
            m = E.match_fact(c["claim"], self.t["facts"])
            st = E.claim_stance(c["claim"], m) if m else {"stance": "none"}
            yield c, m, st

    def test_same_answers_as_javascript(self):
        gold = {g["id"]: g for g in GOLD}
        self.assertEqual(len(gold), len(self.t["cases"]))
        for c, m, st in self.answers():
            g = gold[c["id"]]
            self.assertEqual(m["fact"]["id"] if m else None, g["factId"], c["id"])
            self.assertEqual(st["stance"], g["stance"], c["id"])
            self.assertEqual(st.get("kind"), g["kind"], c["id"])
            if m:
                self.assertTrue(math.isclose(m["score"], g["score"], rel_tol=1e-12), c["id"])

    def test_quality_on_the_measured_set(self):
        right = falsely = wrong = 0
        for c, m, st in self.answers():
            got = m["fact"]["id"] if m else None
            right += got == c["expectedFactId"] and st["stance"] == c["expectedStance"]
            falsely += c["expectedStance"] != "supported" and st["stance"] == "supported"
            wrong += (not c["expectedFactId"]) and got is not None
        self.assertGreaterEqual(right / len(self.t["cases"]), 0.94)
        self.assertEqual(falsely, 0)
        self.assertEqual(wrong, 0)

    def test_server_review_sees_opposite_meaning(self):
        src = {"rules": [{"id": "R-CLAIM-1", "enabled": True, "text": "Claims need approved facts."}], "facts": self.t["facts"], "terms": [], "confidential": []}
        r = E.review_text("Returns are not accepted within 30 days.", src)
        self.assertEqual(len(r["findings"]), 1)
        self.assertTrue(r["findings"][0]["needsSpecialist"])


if __name__ == "__main__":
    unittest.main()