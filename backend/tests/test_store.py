import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from app import server  # noqa: F401  (loads backend/.env first; the settings below then win for this test)
from app import auth


class StoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        os.environ["DATABASE_URL"] = ""      # tests never touch the real hosted database
        os.environ["POSTGRES_URL"] = ""
        os.environ["BS_SQLITE"] = os.path.join(cls.tmp, "test.db")
        os.environ["AUTH_SECRET"] = "test-secret-at-least-16-chars"
        cls.c = TestClient(server.app)

    def login(self, role):
        r = self.c.post("/api/auth/demo", json={"role": role})
        self.assertEqual(r.status_code, 200)
        return {"Authorization": "Bearer " + r.json()["token"]}

    def create(self, h, **data):
        r = self.c.post("/api/submissions", headers=h, json={"title": "Draft", "data": data})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_login_and_me(self):
        for role in ("writer", "legal", "brand_manager"):
            self.assertEqual(self.c.get("/api/me", headers=self.login(role)).json()["role"], role)
        self.assertEqual(self.c.post("/api/auth/demo", json={"role": "nobody"}).status_code, 400)

    def test_no_token_or_tampered_token(self):
        self.assertEqual(self.c.get("/api/submissions").status_code, 401)
        tok = self.login("writer")["Authorization"][7:]
        self.assertEqual(self.c.get("/api/me", headers={"Authorization": "Bearer " + tok[:-3] + "abc"}).status_code, 401)

    def test_only_writers_create(self):
        r = self.c.post("/api/submissions", headers=self.login("legal"), json={"title": "x", "data": {}})
        self.assertEqual(r.status_code, 403)

    def test_full_journey_with_legal(self):
        w, l, m = self.login("writer"), self.login("legal"), self.login("brand_manager")
        s = self.create(w)
        self.assertTrue(s["id"].startswith("P-"))
        self.assertEqual(s["status"], "draft")
        sid = s["id"]
        r = self.c.post(f"/api/submissions/{sid}/transition", headers=w, json={"action": "submit", "route": "awaiting_specialist"})
        self.assertEqual(r.json()["status"], "awaiting_specialist")
        self.assertEqual(self.c.post(f"/api/submissions/{sid}/transition", headers=m, json={"action": "approve"}).status_code, 409)  # Legal first
        self.assertEqual(self.c.post(f"/api/submissions/{sid}/transition", headers=w, json={"action": "signoff"}).status_code, 403)
        self.assertEqual(self.c.post(f"/api/submissions/{sid}/transition", headers=l, json={"action": "signoff"}).json()["status"], "awaiting_manager")
        self.assertEqual(self.c.post(f"/api/submissions/{sid}/transition", headers=m, json={"action": "approve"}).json()["status"], "approved")
        ev = self.c.get(f"/api/submissions/{sid}/events", headers=w).json()
        self.assertEqual([e["kind"] for e in ev], ["created", "submit", "signoff", "approve"])

    def test_needs_legal_cannot_skip_legal(self):
        w = self.login("writer")
        sid = self.create(w, needsLegal=True)["id"]
        r = self.c.post(f"/api/submissions/{sid}/transition", headers=w, json={"action": "submit", "route": "awaiting_manager"})
        self.assertEqual(r.json()["status"], "awaiting_specialist")

    def test_other_writer_cannot_touch_it(self):
        w = self.login("writer")
        sid = self.create(w)["id"]
        other = {"Authorization": "Bearer " + auth.make_token({"id": "u-ravi", "name": "Ravi Nair", "role": "writer"})}
        self.assertEqual(self.c.put(f"/api/submissions/{sid}", headers=other, json={"title": "x", "data": {}}).status_code, 403)
        self.assertEqual(self.c.post(f"/api/submissions/{sid}/transition", headers=other, json={"action": "submit"}).status_code, 403)

    def test_locked_in_review_then_editable_after_changes_requested(self):
        w, m = self.login("writer"), self.login("brand_manager")
        sid = self.create(w)["id"]
        self.c.post(f"/api/submissions/{sid}/transition", headers=w, json={"action": "submit", "route": "awaiting_manager"})
        self.assertEqual(self.c.put(f"/api/submissions/{sid}", headers=w, json={"title": "new", "data": {}}).status_code, 409)
        self.assertEqual(self.c.post(f"/api/submissions/{sid}/transition", headers=m, json={"action": "request_changes", "note": "Soften it"}).json()["status"], "changes_requested")
        r = self.c.put(f"/api/submissions/{sid}", headers=w, json={"title": "new", "data": {"text": "v2"}})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"]["text"], "v2")
        self.assertEqual(self.c.post(f"/api/submissions/{sid}/transition", headers=w, json={"action": "submit", "route": "awaiting_manager"}).json()["status"], "awaiting_manager")

    def test_list_returns_saved_drafts_and_rejects_huge_ones(self):
        w = self.login("writer")
        sid = self.create(w, text="hello")["id"]
        listed = self.c.get("/api/submissions", headers=w).json()
        self.assertIn(sid, [x["id"] for x in listed])
        r = self.c.post("/api/submissions", headers=w, json={"title": "big", "data": {"x": "a" * 300001}})
        self.assertEqual(r.status_code, 413)


if __name__ == "__main__":
    unittest.main()