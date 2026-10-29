# BrandSentinel: Round 3 submission

**Team:** BLUE STAR (Mohd Shahanawaz, Om Maurya, Saba Nikhat)

## Links

- **Working project:** https://brandsentinel-app.vercel.app (press **Writer** under "try the demo", no password; the first sign-in can take up to 20 seconds while the free server wakes up)
- **API health check:** https://brandsentinel-api.vercel.app/api/health
- **Source code:** https://github.com/MohdShahnawaz7465/brandsentinel
- **Updated project PDF:** *(add the file or link)*
- **Demo video:** *(add the link)*

## Completed improvements

### 1. Read PDFs and text inside images (done)
- Upload a Word file, a PDF or a picture. A PDF with text is read page by page; a scanned PDF and a picture go through OCR. All of it runs **inside the browser**; the files are not uploaded.
- The recognised text is shown for correction before the check. Each finding says which page or "Image" it came from.
- Limits: English OCR; text PDFs up to 30 pages, scanned PDFs first 5 pages, 15 MB; the libraries load from public CDNs the first time.

### 2. Meaning-based matching of claims to approved facts, with a measured test set (done)
- The matcher understands rewording (ship / dispatch / deliver), numbers written as words ("five days"), spelling variants, opposite meaning ("not accepted" versus "accepted") and a different name ("Maine" versus "Oregon").
- Measured on a frozen set of **52 claims**: right verdicts **38 to 52 of 52 (73.1% to 100%)**, reworded true claims found **16 to 23 of 23 (100%)**, wrong claims wrongly passed as "verified" **7 to 0**.
- It is rule-based, not a neural model (see "What changed from the plan"). Two known misses are listed in [MATCHING.md](MATCHING.md).

### 3. Private workspaces, real login, server-enforced Legal sign-off (done)
- Create an account with email and password and get a **private workspace**. The admin adds Writer, Legal, Brand manager and Admin members. Other workspaces cannot see your drafts (they get "not found").
- **Legal sign-off is enforced on the server.** At submit the server re-checks the final text; a draft with an unverified or regulated claim goes to Legal whatever the browser asked for, and the Brand manager can approve only after Legal.
- The admin can **switch the AI step off** for the workspace; the server enforces it.
- Passwords are salted PBKDF2 hashes; sessions are signed tokens that expire after 12 hours; sign-up and log-in are rate limited.
- A new sign-in screen offers Demo login, Log in, Create account, or continuing in the browser only.

## What changed from the original plan

| Plan said | What we built | Why |
|---|---|---|
| Meaning-based retrieval with embeddings and pgvector | A rule-based matcher (synonym groups, number words, negation and name checks) with a measured test set. No embeddings, no pgvector. | An embedding model means a large download on first use, results that can differ between browser and server, and no way to say why something matched. A rule-based matcher runs in the browser with no download, gives the same answer on the server, and each decision can be explained to Legal. We measured it instead of assuming. |
| PDF, slide and image-text checking with OCR in a container service | PDF and image OCR **in the browser**, no slides | Serverless hosting cannot run OCR, and reading in the browser also means files are never uploaded. Slides were not built. |
| Real accounts, workspaces, **encrypted storage and an exportable audit log** | Accounts, private workspaces, members, roles, AI switch, server-checked Legal | Encryption beyond the database host's own, and the audit export, were not built. |
| Round 2 had demo logins only | Demo login kept for judges, next to real accounts | So anyone can try the full flow in one click. |

## Technical details

- **Frontend:** plain JavaScript, no framework; one built page. State in `localStorage`; sign-in token in `sessionStorage`.
- **Backend:** FastAPI (Python 3.12) as a Vercel serverless function; Neon Postgres (SQLite locally and in tests).
- **Two engines:** the checking logic exists in JavaScript (browser) and Python (server). A shared answer file ("golden file") makes the Python tests fail if they differ.
- **AI:** Groq `openai/gpt-oss-20b` behind a server proxy with a prompt guard, rate limits and redaction. Only sentences the fixed rules cannot judge are sent. Every AI finding must cite a real source and quote the text exactly.
- **Files:** JSZip (Word), pdf.js (PDF text), tesseract.js (OCR), all in the browser.
- Full description: [ARCHITECTURE.md](ARCHITECTURE.md). Software used: [THIRD_PARTY.md](THIRD_PARTY.md).

## Testing notes

- Python: **65 tests, all pass** (including parity with the JavaScript engine, account and workspace isolation, Legal enforcement, AI switch).
- JavaScript: engine (31), AI and workflow (13), files (6), matching (8).
- Matching measured on a 52-case frozen set; table above and in [TESTING.md](TESTING.md).
- Checked by hand on the live site: PDF upload with page labels, picture OCR, opposite-meaning, wrong-name and number-as-words findings, sign-in screen.
- Re-run and verified after Round 3 changes: the browser end-to-end script `test/e2e.js` passes all checks and exports 9 desktop, mobile, and theme screenshots to `shots/`.
- Details and gaps: [TESTING.md](TESTING.md).

## Usability and real-world practicality

- A first screen with Demo login, Log in and Create account; a one-click demo for judges.
- The writer sees what each sentence must keep (meaning check) and gets only safe rewrites.
- Input from Word, PDF and pictures, the formats marketing teams actually hold.
- A downloadable receipt of what left the system, for Legal and privacy reviews.
- User testing: see [USER_TESTING.md](USER_TESTING.md).

## Known limits

Demo data is shared; the first sign-in can be slow on free hosting; OCR is English only and needs public CDNs; no encryption beyond the host's, no audit export, no password reset; the matcher is rule-based and small-set measured. Full list: [LIMITATIONS.md](LIMITATIONS.md).

## Team contributions

See [TEAM_CONTRIBUTIONS.md](TEAM_CONTRIBUTIONS.md).