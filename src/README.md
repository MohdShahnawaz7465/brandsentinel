# BrandSentinel

BrandSentinel checks marketing copy against a brand's approved wording and facts before it goes out. Fixed rules run first. An AI step judges only the sentences the rules could not. Legal sees only what needs sign-off, and a receipt shows exactly what left the system.

Built by team **BLUE STAR** for the We Code Coders hackathon (problem statement: Inkloom AI brand governance).

- **Live app:** https://brandsentinel-app.vercel.app
- **Live API:** https://brandsentinel-api.vercel.app (`/api/health`)
- **Repository:** https://github.com/MohdShahnawaz7465/brandsentinel

## Try it in two minutes

1. Open the live app. On the first screen press **Writer** under "try the demo" (the first sign-in after a quiet period can take up to 20 seconds while the free server wakes up).
2. In **Review**, choose a sample draft and press **Run check**. Apply a fix, or **Dispute** a finding with a reason.
3. Press **Submit for approval**. Log out, sign in as **Legal** to sign off claims, then as **Brand manager** to approve.
4. Paste your own text, or upload a Word file, a PDF or a picture with text on it. PDFs and pictures are read inside your browser and are not uploaded.
5. To work privately, choose **Create account** on the first screen. You get your own workspace and add your team.

If the server is not reachable, press **Continue in this browser only**. Everything except the shared approval chain still works from your browser.

## What it does

- **Fixed brand checks:** banned and preferred terms, tone, reading level, confidential names, accessibility (alt text, link text, contrast), brand colours.
- **Claims against approved facts**, including facts that expire. Wrong numbers, wrong names, opposite meanings and numbers written as words are caught. See [docs/MATCHING.md](docs/MATCHING.md).
- **Meaning check on every fix:** a rewrite that drops a point of the sentence or adds a new claim is blocked.
- **AI step with guardrails:** only unresolved sentences are sent, after redaction. Every AI finding must cite a real source and quote the text exactly.
- **"What left our system" receipt** after every run.
- **Word, PDF and image input**, including OCR for scanned pages and pictures with text.
- **Workflow:** Writer, Legal, Brand manager. Legal sign-off is decided and enforced on the server.
- **Accounts:** email and password, a private workspace per team, admin adds members and can switch the AI step off.
- **Insights:** what the team gets wrong most, disputed rules, repeat issues.

## Round 3 improvements

| Promised | Status |
|---|---|
| Read PDFs and text inside images | Done: in-browser PDF text and OCR, page labels on findings |
| Meaning-based matching with a measured, larger test set | Done: rule-based, 52 cases, 73.1% to 96.2% right verdicts |
| Private workspaces, real login, server-enforced Legal sign-off | Done, and the admin can switch the AI step off per workspace |

Details and honest limits: [docs/SUBMISSION_ROUND3.md](docs/SUBMISSION_ROUND3.md) and [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Run it yourself

Requirements: Node 20+, Python 3.12.

```bash
npm install                      # installs jszip for the tests

# backend (uses a local SQLite file when DATABASE_URL is not set)
cd backend
pip install -r requirements.txt
python -m uvicorn app.server:app --port 8000

# frontend (second terminal, project root)
BS_API_URL=http://127.0.0.1:8000 node build.js     # PowerShell: $env:BS_API_URL = "http://127.0.0.1:8000"; node build.js
# open dist/index.html (or serve the dist folder)
```

Without `BS_API_URL` the app runs entirely in the browser.

The AI step needs `GROQ_API_KEY` in `backend/.env` (never commit it). Without a key the fixed checks still run. Environment variables used by the hosted backend: `GROQ_API_KEY`, `GROQ_MODEL`, `DATABASE_URL`, `AUTH_SECRET`, `ALLOWED_ORIGINS`, `TRUST_PROXY`.

## Tests

```bash
node --test test/                                   # JavaScript
node tools/measure_matching.js                      # matching table, old vs new
cd backend && python -m unittest discover -s tests -t .   # Python
```

See [docs/TESTING.md](docs/TESTING.md).

## Documents

[ARCHITECTURE](docs/ARCHITECTURE.md) · [MATCHING](docs/MATCHING.md) · [TESTING](docs/TESTING.md) · [LIMITATIONS](docs/LIMITATIONS.md) · [PRIVACY AND ACCESSIBILITY](docs/PRIVACY_AND_ACCESSIBILITY.md) · [THIRD PARTY](docs/THIRD_PARTY.md) · [USER TESTING](docs/USER_TESTING.md) · [TEAM](docs/TEAM_CONTRIBUTIONS.md) · [ROUND 3 SUBMISSION](docs/SUBMISSION_ROUND3.md)

The Tidewell brand and all demo data are made up.