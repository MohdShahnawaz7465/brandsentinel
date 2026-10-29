# Limitations

We list what does not work, or works only partly, so nobody is surprised. If something on the live site looks broken, check this page first.

## Accounts and data

- **Demo logins have no password**, and the **Demo workspace is shared by everyone**. Never type private text while signed in to the Demo workspace; anyone can see it.
- Real workspaces are private to their members, but there is **no password reset and no invitation by email**. An Admin creates each member's account and sets the first password.
- **Source library is per browser.** Edits to rules, facts, terms, colours and confidential names are kept in that browser's own storage. The server holds only the built-in seed sources, which is what it uses when it re-checks a draft for Legal review.
- The database has **no separate encryption layer** and there is **no audit-log export**. Events are logged, but only as rows in the database. (We had listed these in the Round 2 text; they are not built.)
- Passwords are stored as salted hashes. There is no two-factor sign-in.

## AI step

- The AI model sometimes gives a **weak or wrong finding**. Our guardrail only checks that a finding cites a real source and quotes real text. It cannot check that the finding is right. People decide, and writers can dispute any finding.
- The **admin switch for the AI step is enforced by the server only for signed-in users.** In "Continue in this browser only" mode there is no workspace, so the switch does not apply there.
- The AI proxy is rate limited (20 requests per minute per visitor and 120 per minute in total), but the counters live in each server instance's memory. On a serverless host that is a guard against abuse, not an exact global limit.

## Files, PDF and OCR

- PDF and OCR libraries (pdf.js, tesseract.js and its English language data) are **loaded from a public CDN the first time**, so they do not work offline. The first OCR run can take 10 to 20 seconds.
- OCR is **English only**, and accuracy depends on the picture. Blurred, tiny or stylised text can be read wrongly.
- Text PDFs are read up to **30 pages**; scanned PDFs only the **first 5 pages**; the file limit is **15 MB**.
- **PowerPoint and slide files are not supported.**
- Word files are read as plain text; formatting is ignored.

## Matching claims to facts

- The matcher works on **English only** and on a **hand-written list of synonyms** (16 groups). A new way of saying something may not be recognised.
- It is rule-based, not a neural model. Our Round 2 text promised embeddings; we replaced them on purpose (see [MATCHING.md](MATCHING.md)).
- On our own test set it still misses two cases: "There are 4 flavours to choose from" and "Tidewell is not vegan".
- Numbers and dates are compared by exact rules. A claim that mixes several facts in one sentence may be matched to only one of them.

## Hosting and speed

- On the free Vercel and Neon plans the **first request, and the first login, can take 5 to 20 seconds** while the servers wake up. After that it is fast.
- Free plans have usage limits. If the site is used heavily, the AI step may be slow or refuse.

## Testing

- Our test sets (18 planted-mistake drafts and 52 matching cases) were **written by the team**. They are regression checks, not proof of accuracy on real company content.
- The product **checks other people's content for accessibility** (alt text, contrast, vague links), but **we have not audited our own interface** with a screen reader or an accessibility tool. It is built with labelled controls and keyboard-focusable highlights, which is not the same as a formal audit.
- Our PDF and OCR tests use a small set of sample files. We have not tried a wide range of real documents.