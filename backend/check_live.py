"""Check the LIVE backend from your computer. No installs needed.
Run from the backend folder:
    python check_live.py                (it asks you to paste text)
    python check_live.py "your text"    (one-line text)
It prints: (1) is the backend locked to your frontend (CORS), (2) the full review of your text with the AI receipt."""
import json, os, sys, urllib.error, urllib.request

API = os.environ.get("BS_API", "https://brandsentinel-api.vercel.app").rstrip("/")
FRONT = os.environ.get("BS_FRONT", "https://brandsentinel-app.vercel.app")
OTHER = "https://some-other-site.example"


def call(path, data=None, origin=None):
    headers = {"User-Agent": "BrandSentinel-check/1.0"}
    if origin:
        headers["Origin"] = origin
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode("utf-8")
    except Exception as e:
        return 0, {}, str(e)


print("Backend:", API)
status, _, body = call("/api/health")
print("Health:", status, body[:120])
if status != 200:
    sys.exit("The backend did not answer. Stop here.")

print("\n== CORS (who may call the backend from a browser) ==")
for label, origin in (("your frontend", FRONT), ("another site", OTHER)):
    _, h, _ = call("/api/health", origin=origin)
    allowed = h.get("access-control-allow-origin")
    print(f"  {label:14} -> {'ALLOWED (' + allowed + ')' if allowed else 'blocked (no permission header)'}")
print("  Locked correctly = your frontend ALLOWED, another site blocked.")
print("  If another site shows (*), ALLOWED_ORIGINS is still '*'.")

if len(sys.argv) > 1:
    text = " ".join(sys.argv[1:])
else:
    print("\nPaste your text. Finish with an empty line:")
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if not line.strip():
            break
        lines.append(line)
    text = "\n".join(lines)
if not text.strip():
    sys.exit("No text given.")

print("\n== Review ==")
status, _, body = call("/api/review", {"text": text, "use_ai": True}, origin=FRONT)
if status != 200:
    sys.exit(f"Review failed: HTTP {status} {body[:300]}")
r = json.loads(body)
rc = r["receipt"]
print("Mode:", rc["mode"], "| Provider:", rc["provider"])
if rc.get("reason"):
    print("Reason:", rc["reason"])
print("Sent to AI:", len(rc["sent"]), "sentences,", rc["bytes"], "chars | Hidden:", rc["redactions"])
for s in rc["sent"]:
    print("   >", s["text"])
print("AI accepted:", rc["accepted"], "| blocked:", len(rc["blocked"]), "| error:", rc.get("error") or "none")
print(f"\nFindings ({len(r['findings'])}):")
for f in r["findings"]:
    print(f"  [{f['severity']:6}] {f['title']}   <- \"{f['quote']}\"")