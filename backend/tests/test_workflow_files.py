import io
import json
import pathlib
import unittest
import zipfile

from app import files as F
from app import workflow as W

SEED = json.loads((pathlib.Path(__file__).parent.parent / "app" / "seed.json").read_text(encoding="utf-8"))


class WorkflowTests(unittest.TestCase):
    def test_submit_blocked_until_triaged_then_routes(self):
        sub = {"versions": [{}], "status": "draft"}
        self.assertFalse(W.validate_submit(sub, [{"status": "open"}])["ok"])
        self.assertFalse(W.validate_submit(sub, [{"status": "disputed", "reason": ""}])["ok"])
        self.assertEqual(W.validate_submit(sub, [{"status": "fixed"}])["route"], "awaiting_manager")
        self.assertEqual(W.validate_submit(sub, [{"status": "disputed", "reason": "ok", "needsSpecialist": True}])["route"], "awaiting_specialist")

    def test_reworded_unverified_claim_still_goes_to_legal(self):
        self.assertEqual(W.validate_submit({"versions": [{}], "needsLegal": True}, [{"status": "fixed"}])["route"], "awaiting_specialist")

    def test_only_the_right_role_can_move_a_piece(self):
        sub = {"status": "awaiting_specialist"}
        self.assertFalse(W.transition(sub, "brand_manager", "approve")["ok"])
        self.assertFalse(W.transition(sub, "writer", "signoff")["ok"])
        self.assertEqual(W.transition(sub, "legal", "signoff")["to"], "awaiting_manager")
        self.assertEqual(W.transition({"status": "awaiting_manager"}, "brand_manager", "approve")["to"], "approved")
        self.assertEqual(W.transition({"status": "awaiting_manager"}, "brand_manager", "request_changes")["to"], "changes_requested")
        self.assertFalse(W.transition({"status": "draft"}, "brand_manager", "approve")["ok"])

    def test_diff_words(self):
        d = W.diff_words("Our cheap mix is great", "Our affordable mix is great")
        self.assertEqual([(x["type"], x["t"]) for x in d if x["type"] != "same"], [("del", "cheap"), ("add", "affordable")])

    def test_insights(self):
        mk = lambda a, first, final: {"author": a, "status": "approved", "firstCheck": [{"ruleId": r} for r in first], "final": final, "feedback": []}
        subs = [
            mk("Asha", ["T-03", "R-READ-LEN"], [{"ruleId": "R-READ-LEN", "status": "disputed", "reason": "must stay whole"}]),
            mk("Asha", ["T-03", "R-READ-LEN"], [{"ruleId": "R-READ-LEN", "status": "disputed", "reason": "reads fine"}]),
            mk("Ravi", ["T-03"], []),
        ]
        i = W.insights(subs)
        self.assertEqual(i["topRules"][0]["ruleId"], "T-03")
        self.assertEqual(i["topRules"][0]["count"], 3)
        self.assertTrue(any(u["ruleId"] == "R-READ-LEN" for u in i["unclearRules"]))
        self.assertTrue(any(r["author"] == "Asha" and r["ruleId"] == "T-03" for r in i["repeats"]))
        self.assertIsNone(i["clarity"]["pct"])


def make_docx(paragraphs, with_picture=True):
    body = "".join("<w:p><w:r><w:t>%s</w:t></w:r></w:p>" % p for p in paragraphs)
    if with_picture:
        body += '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1"/></wp:inline></w:drawing></w:r></w:p>'
    xml = '<?xml version="1.0"?><w:document xmlns:w="w" xmlns:wp="wp"><w:body>' + body + "</w:body></w:document>"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


class FileTests(unittest.TestCase):
    def test_docx_text_and_missing_alt(self):
        text = F.read_docx(make_docx(["Hey guys! Tidewell is cheap &amp; cheerful.", "Second line with 600 mg of sodium."]))
        self.assertIn("Hey guys! Tidewell is cheap & cheerful.", text)
        self.assertIn("600 mg of sodium", text)
        self.assertIn("![](image)", text)

    def test_not_a_docx(self):
        with self.assertRaisesRegex(ValueError, r"Word \(\.docx\)"):
            F.read_docx(b"hello")

    def test_dominant_colours(self):
        px = bytearray()
        for i in range(100):
            px += bytes([20, 33, 61, 255] if i < 70 else [255, 0, 255, 255])
        d = F.dominant_colours(bytes(px), 2)
        self.assertEqual(d[0]["hex"], "#14213D")
        self.assertAlmostEqual(d[0]["share"], 0.7)
        self.assertEqual(d[1]["hex"], "#FF00FF")

    def test_analyse_image(self):
        try:
            from PIL import Image
        except ImportError:
            self.skipTest("Pillow not installed")
        im = Image.new("RGB", (200, 100), (20, 33, 61))
        for x in range(100, 200):
            for y in range(100):
                im.putpixel((x, y), (255, 0, 255))
        buf = io.BytesIO()
        im.save(buf, "PNG")
        r = F.analyse_image(buf.getvalue())
        self.assertEqual((r["width"], r["height"]), (200, 100))
        from app import engine as E

        def near(hex_, target):
            return E.colour_distance(E.hex_to_rgb(hex_), E.hex_to_rgb(target)) < 8

        got = [d["hex"] for d in r["dominant"][:2]]
        self.assertTrue(any(near(h, "#14213D") for h in got) and any(near(h, "#FF00FF") for h in got), got)


if __name__ == "__main__":
    unittest.main()
