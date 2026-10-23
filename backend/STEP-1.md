# Step 1: the Python engine (no installs needed)

This step adds a Python copy of the checking engine, AI guardrails, workflow rules and file readers.
A test proves it gives the same answers as the JavaScript engine on 111 reviews (181 findings).

## Where the files go
Unzip `brandsentinel-backend-step1.zip` into your project folder, so that `backend/` and `tools/` sit
next to the existing `src/`, `test/` and `dist/` folders:

```
brandsentinel/
  src/  test/  dist/  build.js ...   (already there)
  backend/                           (new)
    app/      engine.py ai.py workflow.py files.py seed.json
    tests/    test_engine_parity.py test_ai.py test_workflow_files.py golden.json
  tools/                             (new)  export_seed.js  make_golden.js
```

## Run the tests (VS Code terminal, Ctrl + `)
```
cd backend
python -m unittest discover -s tests -t .
```
Expected last lines:
```
Ran 24 tests in ...
OK
```
No `pip install` is needed for this step. (Pillow is optional; one image test is skipped without it.)

## If something fails
Copy the whole terminal output and send it to me.

## Optional: regenerate the "golden" answers from the JavaScript engine
From the project folder (not `backend`):
```
node tools/export_seed.js
node tools/make_golden.js
```
Then run the Python tests again.

## What each file does
| File | Purpose |
|---|---|
| app/engine.py | Fixed checks: terms, tone, claims vs facts, expiring facts, meaning check, image checks, redaction |
| app/ai.py | AI step with source grounding, receipts, and providers for Anthropic and OpenAI-style endpoints |
| app/workflow.py | Roles, routing to Legal / Brand manager, version diff, insights |
| app/files.py | Reads .docx (with image alt text) and analyses image colours |
| app/seed.json | Demo brand "Tidewell", sample drafts, labelled test set (exported from src/data.js) |
