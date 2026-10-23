import asyncio
import json
import pathlib
import threading
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer

from app import ai as A
from app import engine as E

SEED = json.loads((pathlib.Path(__file__).parent.parent / "app" / "seed.json").read_text(encoding="utf-8"))
S = SEED["sources"]
NOW = datetime(2026, 10, 22, 8, 0, tzinfo=timezone.utc)
TEXT = ("Our community of runners trusts Tidewell to keep every long weekend run fun. Project Marlin lead is priya@tidewell.example today. "
        "We beat every other hydration brand without breaking a sweat.")


def mock(fn):
    calls = []

    async def call(prompt):
        calls.append(prompt)
        return fn(prompt)

    p = A.Provider("mock-model", call)
    p.calls = calls
    return p


class AiTests(unittest.IsolatedAsyncioTestCase):
    async def test_off_sends_nothing(self):
        p = mock(lambda _: {"findings": []})
        r = await A.ai_review(TEXT, S, [], p, False)
        self.assertEqual(r["receipt"]["mode"], "rules-only")
        self.assertEqual(len(p.calls), 0)
        self.assertEqual(r["receipt"]["bytes"], 0)

    async def test_no_provider(self):
        r = await A.ai_review(TEXT, S, [], None, True)
        self.assertEqual(r["receipt"]["mode"], "rules-only")

    async def test_prompt_is_redacted_and_receipt_lists_what_was_sent(self):
        p = mock(lambda _: {"findings": []})
        r = await A.ai_review(TEXT, S, [], p, True)
        self.assertEqual(len(p.calls), 1)
        self.assertNotRegex(p.calls[0], r"Marlin|priya@")
        self.assertIn("[CONFIDENTIAL]", p.calls[0])
        self.assertEqual(r["receipt"]["mode"], "ai-assisted")
        self.assertTrue(all(s["text"] in p.calls[0] for s in r["receipt"]["sent"]))
        self.assertGreaterEqual(len(r["receipt"]["redactions"]), 1)
        self.assertGreater(len(r["receipt"]["sourceIds"]), 0)

    async def test_grounding_blocks_invented_sources_and_fake_quotes(self):
        good = {"segment": 2, "quote": "We beat every other hydration brand", "sourceId": "G-2", "category": "messaging", "severity": "high",
                "title": "Compares to competitors", "explanation": "G-2 forbids comparisons.", "confidence": 0.8, "suggestions": ["We make hydration simple"]}
        bad = [dict(good, sourceId="G-99", title="Invented source"), dict(good, quote="text that is not there", title="Fake quote"), dict(good, segment=9, title="Bad segment"),
               dict(good, segment="0", title="String segment")]
        p = mock(lambda _: {"findings": [good] + bad})
        r = await A.ai_review(TEXT, S, [], p, True)
        self.assertEqual(len(r["findings"]), 1)
        f = r["findings"][0]
        self.assertEqual(f["origin"], "ai")
        self.assertEqual(TEXT[f["start"]:f["end"]], f["quote"])
        self.assertEqual(len(r["receipt"]["blocked"]), 4)
        self.assertIn("not in the source library", r["receipt"]["blocked"][0]["reason"])
        ev = E.evaluate_fixes(f, TEXT, f["keep"])
        self.assertEqual(len(ev["ok"]) + len(ev["blocked"]), 1)

    async def test_provider_failure_is_reported_not_raised(self):
        async def boom(_):
            raise RuntimeError("rate_limited")

        r = await A.ai_review(TEXT, S, [], A.Provider("bad", boom), True)
        self.assertEqual(r["findings"], [])
        self.assertEqual(r["receipt"]["error"], "rate_limited")

    def test_flagged_sentences_are_not_sent(self):
        text = TEXT + " Our cheap mix is great for runners every day."
        local = E.review_text(text, S, NOW)["findings"]
        self.assertFalse(any("cheap" in s["text"] for s in A.pick_segments(text, local)))

    def test_parse_json_loose(self):
        self.assertEqual(A.parse_json_loose('```json\n{"findings": []}\n```'), {"findings": []})
        self.assertEqual(A.parse_json_loose('Sure! {"findings": []} Done.'), {"findings": []})


class _Handler(BaseHTTPRequestHandler):
    seen = {}

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        _Handler.seen = {"path": self.path, "auth": self.headers.get("Authorization"), "xkey": self.headers.get("x-api-key"), "body": body}
        reply = '```json\n{"findings":[{"segment":2,"quote":"We beat every other hydration brand","sourceId":"G-2","title":"Comparison","explanation":"G-2","suggestions":[]}]}\n```'
        if self.path.endswith("/messages"):
            out = {"content": [{"type": "text", "text": reply}]}
        else:
            out = {"choices": [{"message": {"content": reply}}]}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


class ProviderTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.srv = HTTPServer(("127.0.0.1", 0), _Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()

    async def test_openai_compatible_over_real_http(self):
        prov = A.openai_compatible(self.base + "/v1/chat/completions", "test-model", "k123")
        r = await A.ai_review(TEXT, S, [], prov, True)
        self.assertEqual(_Handler.seen["auth"], "Bearer k123")
        self.assertNotIn("Marlin", _Handler.seen["body"]["messages"][0]["content"])
        self.assertEqual(len(r["findings"]), 1)

    async def test_anthropic_over_real_http(self):
        prov = A.anthropic("sk-test", "claude-test", self.base)
        r = await A.ai_review(TEXT, S, [], prov, True)
        self.assertEqual(_Handler.seen["xkey"], "sk-test")
        self.assertTrue(_Handler.seen["path"].endswith("/v1/messages"))
        self.assertEqual(len(r["findings"]), 1)

    async def test_unreachable_endpoint_gives_clear_error(self):
        prov = A.openai_compatible("http://127.0.0.1:9/v1/chat/completions", "m")
        r = await A.ai_review(TEXT, S, [], prov, True)
        self.assertIn("Could not reach", r["receipt"]["error"])


if __name__ == "__main__":
    unittest.main()
