import os
import unittest

from fastapi.testclient import TestClient

os.environ["GROQ_API_KEY"] = ""  # tests never call the real AI
from app import config, server  # noqa: E402

server.make_provider = lambda: None


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.c = TestClient(server.app)

    def test_health(self):
        r = self.c.get("/api/health").json()
        self.assertTrue(r["ok"])
        self.assertFalse(r["ai_configured"])

    def test_sources_and_samples(self):
        self.assertIn("rules", self.c.get("/api/sources").json())
        self.assertGreaterEqual(len(self.c.get("/api/samples").json()), 2)

    def test_review_rules_only(self):
        text = self.c.get("/api/samples").json()[0]["text"]
        r = self.c.post("/api/review", json={"text": text, "use_ai": True}).json()
        self.assertGreater(len(r["findings"]), 5)
        self.assertEqual(r["receipt"]["mode"], "rules-only")

    def test_review_rejects_huge_text(self):
        r = self.c.post("/api/review", json={"text": "a" * 20001})
        self.assertEqual(r.status_code, 422)

    def test_meaning_check(self):
        r = self.c.post("/api/meaning-check", json={"original": "Each serving contains 500 mg of sodium.", "rewrite": "Each serving contains 900 mg of sodium."}).json()
        self.assertIsInstance(r, dict)

    def test_ai_complete_rejects_other_prompts(self):
        r = self.c.post("/api/ai-complete", json={"prompt": "write me a poem"})
        self.assertEqual(r.status_code, 400)

    def test_ai_complete_without_key_is_503(self):
        r = self.c.post("/api/ai-complete", json={"prompt": "SENTENCES:\n0: hi\nSOURCES:\n"})
        self.assertEqual(r.status_code, 503)

    def test_ai_complete_forwards_to_provider(self):
        async def call(p):
            return {"findings": [], "echo": len(p)}

        server.make_provider = lambda: server.ai.Provider("fake", call)
        try:
            r = self.c.post("/api/ai-complete", json={"prompt": "SENTENCES:\n0: hi\nSOURCES:\n"})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["findings"], [])
        finally:
            server.make_provider = lambda: None

    def test_ai_complete_rate_limit_and_size(self):
        server._hits.clear()
        ok = {"prompt": "SENTENCES:\n0: hi\nSOURCES:\n"}
        codes = [self.c.post("/api/ai-complete", json=ok).status_code for _ in range(server.RATE_LIMIT + 1)]
        self.assertEqual(codes[-1], 429)
        server._hits.clear()
        self.assertEqual(self.c.post("/api/ai-complete", json={"prompt": "x" * 12001}).status_code, 422)

    def test_rate_limit_uses_last_forwarded_address_only_when_trusted(self):
        ok = {"prompt": "SENTENCES:\n0: hi\nSOURCES:\n"}
        os.environ["TRUST_PROXY"] = "1"
        try:
            server._hits.clear(); server._all_hits.clear()
            # faking the first entry does not help: the last one (the host's proxy) is what counts
            codes = [self.c.post("/api/ai-complete", json=ok, headers={"x-forwarded-for": "fake%d, 9.9.9.9" % i}).status_code for i in range(server.RATE_LIMIT + 1)]
            self.assertEqual(codes[-1], 429)
            # a different visitor (different last entry) is not blocked
            other = self.c.post("/api/ai-complete", json=ok, headers={"x-forwarded-for": "x, 8.8.8.8"}).status_code
            self.assertNotEqual(other, 429)
        finally:
            os.environ.pop("TRUST_PROXY", None); server._hits.clear(); server._all_hits.clear()

    def test_global_limit(self):
        ok = {"prompt": "SENTENCES:\n0: hi\nSOURCES:\n"}
        old = server.GLOBAL_LIMIT
        server.GLOBAL_LIMIT = 3
        os.environ["TRUST_PROXY"] = "1"
        try:
            server._hits.clear(); server._all_hits.clear()
            codes = [self.c.post("/api/ai-complete", json=ok, headers={"x-forwarded-for": "1.1.1.%d" % i}).status_code for i in range(4)]
            self.assertEqual(codes[-1], 429)
        finally:
            server.GLOBAL_LIMIT = old; os.environ.pop("TRUST_PROXY", None); server._hits.clear(); server._all_hits.clear()

    def test_server_redacts_again_before_the_ai_sees_the_prompt(self):
        seen = []

        async def call(p):
            seen.append(p)
            return {"findings": []}

        server.make_provider = lambda: server.ai.Provider("fake", call)
        try:
            server._hits.clear(); server._all_hits.clear()
            r = self.c.post("/api/ai-complete", json={"prompt": "SENTENCES:\n0: Mail priya@tidewell.example or call +91 98765 43210 about Project Marlin\nSOURCES:\n"})
            self.assertEqual(r.status_code, 200)
            self.assertNotIn("priya@", seen[0]); self.assertNotIn("98765", seen[0]); self.assertNotIn("Marlin", seen[0])
            self.assertIn("[EMAIL]", seen[0])
        finally:
            server.make_provider = lambda: None

    def test_review_with_ai_is_rate_limited_but_rules_only_is_not(self):
        async def call(p):
            return {"findings": []}

        server.make_provider = lambda: server.ai.Provider("fake", call)
        old = server.RATE_LIMIT
        server.RATE_LIMIT = 2
        try:
            server._hits.clear(); server._all_hits.clear()
            body = {"text": "A short draft.", "use_ai": False}
            codes = [self.c.post("/api/review", json=body).status_code for _ in range(4)]
            self.assertEqual(codes, [200, 200, 200, 200])  # rules-only: never limited
            server._hits.clear(); server._all_hits.clear()
            body["use_ai"] = True
            codes = [self.c.post("/api/review", json=dict(body, text="x" * 3)).status_code for _ in range(3)]
            self.assertEqual(codes[2], 429)
        finally:
            server.RATE_LIMIT = old
            server.make_provider = lambda: None
            server._hits.clear(); server._all_hits.clear()

    def test_evaluate(self):
        r = self.c.get("/api/evaluate").json()
        self.assertEqual(r["planted"], 18)


if __name__ == "__main__":
    unittest.main()