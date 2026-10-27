import os
import sqlite3
import tempfile
import unittest

from fastapi.testclient import TestClient

os.environ["GROQ_API_KEY"] = ""  # tests never call the real AI
from app import accounts, auth, db, server  # noqa: E402

server.make_provider = lambda: None
CLAIM = "Our hydration drink is clinically proven to boost energy by 90%."
PROMPT = "SENTENCES:\n1. hello\nSOURCES:\n- none"


class AccountTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        os.environ["DATABASE_URL"] = ""      # tests never touch the real hosted database
        os.environ["POSTGRES_URL"] = ""
        os.environ["BS_SQLITE"] = os.path.join(cls.tmp, "accounts.db")
        os.environ["AUTH_SECRET"] = "test-secret-at-least-16-chars"
        os.environ["BS_PBKDF2_ROUNDS"] = "1000"  # fast hashing for tests only
        cls.c = TestClient(server.app)

    def setUp(self):
        for lim in (accounts.signup_limit, accounts.login_limit, accounts.account_limit):
            lim.clear()
        self.n = 0

    def h(self, token):
        return {"Authorization": "Bearer " + token}

    def signup(self, ws="Acme Foods", email="boss@acme.test", pw="correct horse"):
        r = self.c.post("/api/auth/signup", json={"workspace_name": ws, "name": "Boss", "email": email, "password": pw})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def member(self, admin_tok, role, email, pw="member-pass-1"):
        r = self.c.post("/api/workspace/members", headers=self.h(admin_tok), json={"name": role.title(), "email": email, "role": role, "password": pw})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def login(self, email, pw):
        return self.c.post("/api/auth/login", json={"email": email, "password": pw})

    def team(self, tag):
        """A fresh private workspace with an admin, a writer, Legal and a Brand manager. Returns their tokens."""
        s = self.signup("Team " + tag, "admin@%s.test" % tag)
        for role in ("writer", "legal", "brand_manager"):
            self.member(s["token"], role, "%s@%s.test" % (role, tag))
        toks = {"admin": s["token"]}
        for role in ("writer", "legal", "brand_manager"):
            r = self.login("%s@%s.test" % (role, tag), "member-pass-1")
            self.assertEqual(r.status_code, 200, r.text)
            toks[role] = r.json()["token"]
        return toks

    # ---- sign up and log in ----
    def test_signup_creates_private_workspace_and_admin(self):
        s = self.signup("Acme One", "one@acme.test")
        self.assertEqual(s["user"]["role"], "admin")
        self.assertEqual(s["workspace"]["name"], "Acme One")
        self.assertFalse(s["workspace"]["isDemo"])
        me = self.c.get("/api/me", headers=self.h(s["token"])).json()
        self.assertEqual(me["workspace"]["id"], s["workspace"]["id"])

    def test_signup_checks_input(self):
        base = {"workspace_name": "Acme", "name": "Boss", "email": "a@b.test", "password": "longenough"}
        for bad in ({"password": "short"}, {"email": "not-an-email"}, {"workspace_name": ""}, {"name": ""}):
            r = self.c.post("/api/auth/signup", json=dict(base, **bad))
            self.assertEqual(r.status_code, 400, bad)

    def test_duplicate_email_is_refused_whatever_the_case(self):
        self.signup("Dup", "dup@acme.test")
        r = self.c.post("/api/auth/signup", json={"workspace_name": "Other", "name": "x", "email": "DUP@acme.test", "password": "longenough"})
        self.assertEqual(r.status_code, 409)

    def test_password_is_stored_only_as_a_hash(self):
        self.signup("Hash", "hash@acme.test", "my secret pass")
        with db.connect() as c:
            row = c.one("SELECT pw_hash FROM users WHERE email = ?", ("hash@acme.test",))
        self.assertTrue(row["pw_hash"].startswith("pbkdf2_sha256$"))
        self.assertNotIn("my secret pass", row["pw_hash"])

    def test_login_right_and_wrong_password(self):
        self.signup("Login", "login@acme.test", "right password")
        ok = self.login("LOGIN@acme.test", "right password")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["user"]["role"], "admin")
        wrong, unknown = self.login("login@acme.test", "wrong password"), self.login("nobody@acme.test", "whatever1")
        self.assertEqual((wrong.status_code, unknown.status_code), (401, 401))
        self.assertEqual(wrong.json()["detail"], unknown.json()["detail"])  # same answer, so emails cannot be guessed

    def test_login_is_rate_limited(self):
        self.signup("Rate", "rate@acme.test", "right password")
        codes = [self.login("rate@acme.test", "wrong password").status_code for _ in range(11)]
        self.assertEqual(codes[:10], [401] * 10)
        self.assertEqual(codes[10], 429)

    def test_placeholder_secret_is_refused(self):
        old = os.environ["AUTH_SECRET"]
        os.environ["AUTH_SECRET"] = "change-me-to-a-long-random-text"
        try:
            self.assertEqual(self.c.post("/api/auth/demo", json={"role": "writer"}).status_code, 503)
        finally:
            os.environ["AUTH_SECRET"] = old

    # ---- team members and settings ----
    def test_admin_adds_members_who_can_log_in(self):
        t = self.team("members")
        me = self.c.get("/api/me", headers=self.h(t["legal"])).json()
        self.assertEqual(me["role"], "legal")
        listing = self.c.get("/api/workspace", headers=self.h(t["admin"])).json()
        self.assertEqual(sorted(m["role"] for m in listing["members"]), ["admin", "brand_manager", "legal", "writer"])
        self.assertNotIn("members", self.c.get("/api/workspace", headers=self.h(t["writer"])).json())

    def test_only_admin_manages_the_team(self):
        t = self.team("rules")
        r = self.c.post("/api/workspace/members", headers=self.h(t["writer"]), json={"name": "x", "email": "x@rules.test", "role": "writer", "password": "longenough"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.c.put("/api/workspace/settings", headers=self.h(t["writer"]), json={"ai_enabled": False}).status_code, 403)
        bad_role = self.c.post("/api/workspace/members", headers=self.h(t["admin"]), json={"name": "x", "email": "y@rules.test", "role": "boss", "password": "longenough"})
        self.assertEqual(bad_role.status_code, 400)
        dup = self.c.post("/api/workspace/members", headers=self.h(t["admin"]), json={"name": "x", "email": "writer@rules.test", "role": "writer", "password": "longenough"})
        self.assertEqual(dup.status_code, 409)

    def test_demo_workspace_cannot_be_changed(self):
        tok = self.c.post("/api/auth/demo", json={"role": "admin"}).json()["token"]
        self.assertEqual(self.c.put("/api/workspace/settings", headers=self.h(tok), json={"ai_enabled": False}).status_code, 403)
        add = self.c.post("/api/workspace/members", headers=self.h(tok), json={"name": "x", "email": "x@demo.test", "role": "writer", "password": "longenough"})
        self.assertEqual(add.status_code, 403)

    # ---- privacy between workspaces ----
    def test_workspaces_cannot_see_each_other(self):
        a, b = self.team("alpha"), self.team("bravo")
        sid = self.c.post("/api/submissions", headers=self.h(a["writer"]), json={"title": "Secret plan", "data": {"text": "x"}}).json()["id"]
        self.assertIn(sid, [x["id"] for x in self.c.get("/api/submissions", headers=self.h(a["legal"])).json()])
        self.assertNotIn(sid, [x["id"] for x in self.c.get("/api/submissions", headers=self.h(b["writer"])).json()])
        self.assertEqual(self.c.get("/api/submissions/%s/events" % sid, headers=self.h(b["writer"])).status_code, 404)
        self.assertEqual(self.c.put("/api/submissions/" + sid, headers=self.h(b["writer"]), json={"title": "x", "data": {}}).status_code, 404)
        self.assertEqual(self.c.post("/api/submissions/%s/transition" % sid, headers=self.h(b["brand_manager"]), json={"action": "approve"}).status_code, 404)

    def test_demo_and_private_workspaces_are_separate(self):
        t = self.team("apart")
        demo = self.c.post("/api/auth/demo", json={"role": "writer"}).json()["token"]
        sid = self.c.post("/api/submissions", headers=self.h(demo), json={"title": "Demo piece", "data": {}}).json()["id"]
        self.assertNotIn(sid, [x["id"] for x in self.c.get("/api/submissions", headers=self.h(t["writer"])).json()])

    # ---- Legal is enforced by the server ----
    def test_server_sends_unverified_claims_to_legal_even_if_the_browser_says_no(self):
        t = self.team("legal1")
        data = {"versions": [{"n": 1, "text": CLAIM}]}
        sid = self.c.post("/api/submissions", headers=self.h(t["writer"]), json={"title": "Claim", "data": data}).json()["id"]
        r = self.c.post("/api/submissions/%s/transition" % sid, headers=self.h(t["writer"]), json={"action": "submit", "route": "awaiting_manager"})
        self.assertEqual(r.json()["status"], "awaiting_specialist")
        self.assertTrue(r.json()["needsLegal"])
        self.assertEqual(self.c.post("/api/submissions/%s/transition" % sid, headers=self.h(t["brand_manager"]), json={"action": "approve"}).status_code, 409)
        self.assertEqual(self.c.post("/api/submissions/%s/transition" % sid, headers=self.h(t["brand_manager"]), json={"action": "signoff"}).status_code, 403)
        self.assertEqual(self.c.post("/api/submissions/%s/transition" % sid, headers=self.h(t["legal"]), json={"action": "signoff", "note": "claims ok"}).json()["status"], "awaiting_manager")
        self.assertEqual(self.c.post("/api/submissions/%s/transition" % sid, headers=self.h(t["brand_manager"]), json={"action": "approve"}).json()["status"], "approved")
        kinds = [e["kind"] for e in self.c.get("/api/submissions/%s/events" % sid, headers=self.h(t["writer"])).json()]
        self.assertEqual(kinds, ["created", "submit", "signoff", "approve"])

    def test_clean_text_goes_straight_to_the_brand_manager(self):
        t = self.team("legal2")
        data = {"versions": [{"n": 1, "text": "Thank you for reading."}]}
        sid = self.c.post("/api/submissions", headers=self.h(t["writer"]), json={"title": "Clean", "data": data}).json()["id"]
        r = self.c.post("/api/submissions/%s/transition" % sid, headers=self.h(t["writer"]), json={"action": "submit", "route": "awaiting_manager"})
        self.assertEqual(r.json()["status"], "awaiting_manager")

    # ---- the AI switch ----
    def test_admin_can_switch_the_ai_step_off_for_the_workspace(self):
        t, other = self.team("aioff"), self.team("aion")
        r = self.c.put("/api/workspace/settings", headers=self.h(t["admin"]), json={"ai_enabled": False})
        self.assertFalse(r.json()["aiEnabled"])
        self.assertFalse(self.c.get("/api/me", headers=self.h(t["writer"])).json()["workspace"]["aiEnabled"])
        self.assertEqual(self.c.post("/api/ai-complete", headers=self.h(t["writer"]), json={"prompt": PROMPT}).status_code, 403)
        self.assertEqual(self.c.post("/api/review", headers=self.h(t["writer"]), json={"text": "Hello.", "use_ai": True}).status_code, 403)
        self.assertEqual(self.c.post("/api/review", headers=self.h(t["writer"]), json={"text": "Hello.", "use_ai": False}).status_code, 200)
        self.assertNotEqual(self.c.post("/api/ai-complete", headers=self.h(other["writer"]), json={"prompt": PROMPT}).status_code, 403)
        self.assertNotEqual(self.c.post("/api/ai-complete", json={"prompt": PROMPT}).status_code, 403)  # no login: browser-only mode, no workspace
        self.c.put("/api/workspace/settings", headers=self.h(t["admin"]), json={"ai_enabled": True})
        self.assertNotEqual(self.c.post("/api/ai-complete", headers=self.h(t["writer"]), json={"prompt": PROMPT}).status_code, 403)

    # ---- an older database is upgraded in place ----
    def test_old_database_is_migrated_and_old_drafts_join_the_demo_workspace(self):
        path = os.path.join(self.tmp, "old.db")
        raw = sqlite3.connect(path)
        raw.executescript(
            "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);"
            "CREATE TABLE submissions (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, author_id TEXT NOT NULL, needs_legal INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"
            "CREATE TABLE events (id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, at TEXT NOT NULL, actor_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);"
            "INSERT INTO users VALUES ('u-asha', 'Asha Rao', 'writer');"
            "INSERT INTO submissions VALUES ('P-OLD001', 'Old draft', 'draft', 'u-asha', 0, '{}', '2026-10-24T00:00:00Z', '2026-10-24T00:00:00Z');"
        )
        raw.commit()
        raw.close()
        os.environ["BS_SQLITE"] = path
        try:
            tok = self.c.post("/api/auth/demo", json={"role": "writer"}).json()["token"]
            self.assertIn("P-OLD001", [x["id"] for x in self.c.get("/api/submissions", headers=self.h(tok)).json()])
        finally:
            os.environ["BS_SQLITE"] = os.path.join(self.tmp, "accounts.db")


if __name__ == "__main__":
    unittest.main()