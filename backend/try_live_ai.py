"""Live AI smoke test. Run from the backend folder:  python try_live_ai.py"""
import asyncio, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from app import engine as E, ai
from app.config import load_env

load_env()

key = os.environ.get("GROQ_API_KEY", "")
if not key:
    sys.exit("GROQ_API_KEY is not set. See the steps.")

seed = json.load(open(os.path.join(HERE, "app", "seed.json"), encoding="utf-8"))
sources = seed["sources"]
text = seed["samples"][0]["text"]

local = E.review_text(text, sources)["findings"]
provider = ai.openai_compatible(
    "https://api.groq.com/openai/v1/chat/completions",
    os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
    key,
)
out = asyncio.run(ai.ai_review(text, sources, local, provider, True))

r = out["receipt"]
print("MODE:", r["mode"], "| PROVIDER:", r["provider"])
print("SENT:", len(r["sent"]), "sentences,", r["bytes"], "chars | REDACTED:", len(r["redactions"]))
print("ACCEPTED:", r["accepted"], "| BLOCKED:", len(r["blocked"]))
if r.get("error"):
    print("ERROR:", r["error"])
for f in out["findings"]:
    print("-", f["severity"], f["sourceId"], f["title"], "|", f["quote"])
for b in r["blocked"]:
    print("  blocked:", b["reason"])