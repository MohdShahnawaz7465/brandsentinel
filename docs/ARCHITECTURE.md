# Architecture

## Overview

```
 Browser (static page, plain JavaScript)              Vercel serverless (FastAPI, Python 3.12)
 ┌─────────────────────────────────────┐              ┌────────────────────────────────────┐
 │ engine.js    fixed checks + matching │              │ engine.py    same checks (port)    │
 │ workflow.js  roles and approval chain│   HTTPS      │ workflow.py  same approval rules   │
 │ ai.js        prompt, redaction,      │ ───────────► │ ai.py        AI proxy, prompt guard│
 │              validation of AI answer │              │ accounts.py  signup, login, members│
 │ files.js     .docx, PDF, OCR helpers │              │ store.py     drafts, approvals     │
 │ app.js       screens and actions     │              │ auth.py      password + token      │
 │ localStorage drafts, sources, history│              │ db.py        Postgres / SQLite     │
 └─────────────────────────────────────┘              └──────────────┬─────────────────────┘
                                                                     │
                                                         Neon Postgres (users, workspaces,
                                                         submissions, events)
```

Two Vercel projects deploy from one repository: the frontend (folder `dist`, built by `build.js`) and the backend (folder `backend`, entry `backend/index.py`).

## The engine exists twice

The checking logic is written in JavaScript (runs in the browser) and ported line by line to Python (runs on the server). `tools/make_golden.js` runs the JavaScript engine over about 110 inputs and stores its answers in `backend/tests/golden.json`. The Python tests must reproduce them exactly, including text positions. A change to one engine without the other fails the tests. The matcher has its own answer file, `backend/tests/matching_golden.json`.

Why twice: the browser needs the checks to work with no server, and the server must be able to decide on its own whether Legal is required, so that a modified browser cannot skip Legal.

## What runs where

**In the browser:** fixed checks, claim matching, meaning check on fixes, retrieval of sources (word overlap), redaction, building of the AI prompt, validation of the AI answer, the receipt, Word, PDF and image reading (JSZip, pdf.js, tesseract.js, loaded on first use), the approval chain when working in browser-only mode.

**On the server:** the AI proxy (holds the AI key), the second redaction, rate limits, accounts and workspaces, saved drafts, approval chain with role checks, and the Legal decision at submit.

## Data flow of an AI check

1. The browser runs the fixed checks and finds the sentences they could not judge.
2. It redacts emails, phone numbers and confidential names from those sentences and attaches the best-matching approved sources.
3. Only that redacted prompt goes to `POST /api/ai-complete`.
4. The server rejects anything that is not a BrandSentinel review prompt, applies rate limits (20 per minute per visitor, 120 per minute in total), redacts again, and calls the model (Groq, `openai/gpt-oss-20b`). If the caller is signed in to a workspace whose admin switched the AI step off, the server refuses.
5. The browser keeps only findings that cite a real source and quote the text exactly, and writes the receipt.

## Reading PDFs and images

All of it happens in the browser. A PDF with text is read page by page with pdf.js (up to 30 pages, 15 MB). A scanned PDF (pages with no text) is drawn to a canvas and read by tesseract.js (first 5 pages). A picture is read the same way. The text is joined with a page map, so each finding can say "Page 2" or "Image". The files are never uploaded.

## Matching claims to approved facts

See [MATCHING.md](MATCHING.md). Short version: both texts are turned into normalised "ideas" (synonym groups, number words, spelling variants), a fact is matched when the claim covers enough of its weighted ideas, and opposite meaning, a different name and a different number are reported as conflicts.

## Accounts and workspaces

- Tables: `workspaces` (name, `ai_enabled`, `is_demo`), `users` (email, password hash, role, workspace), `submissions` (workspace, author, status, needs-Legal flag, draft as JSON), `events` (history log).
- Passwords: PBKDF2-HMAC-SHA256, 200,000 rounds, random salt. Same work for unknown emails, so timing does not reveal which emails exist.
- Session token: HMAC-signed, 12 hours, carries user id, name, role and workspace. Kept in the browser tab's session storage only.
- Every query on drafts filters by the caller's workspace. A draft of another workspace answers 404, the same as a missing one.
- The shared demo workspace (`ws-demo`) holds the five seeded demo users, who sign in without a password.
- Roles are checked on every request: only the author edits a draft, a draft in review is locked, Legal must sign off before the Brand manager can approve.

## Legal sign-off is decided on the server

At submit, the server reruns the Python engine on the final text with its built-in sources. If any finding needs a specialist (an unverified or regulated claim, an expired fact, a conflict), the draft goes to Legal whatever the browser asked for. The server can only add Legal, never remove it, because the browser's source library may differ from the built-in one.

## Safeguards

Prompt guard and size limit on the AI proxy; rate limits on AI, sign-up and log-in; redaction in two places; CORS locked to the BrandSentinel frontend; client address taken from the proxy header only on trusted hosts; data from the server is sanitised before the page shows it; draft size limit; a placeholder signing secret is refused.

## Without a server

If `BS_API_URL` is not set, the server cannot be reached, or the visitor chooses "Continue in this browser only", everything runs from the browser: checks, matching, files, AI step (with a user-supplied provider), workflow, history. State lives in `localStorage`.

## Hosting

Frontend and backend deploy automatically from GitHub. The AI key, database address and signing secret exist only as Vercel environment variables. The database is Neon Postgres through the Vercel integration; tests and local runs use a SQLite file with the same code.