# Testing notes

## How to run

```bash
npm install
node --test test/                                          # JavaScript (engine, AI and workflow, files, matching)
node tools/measure_matching.js                             # claim matching, old versus new
cd backend && python -m unittest discover -s tests -t .    # Python (needs: pip install -r requirements.txt)
```

Set `BS_PBKDF2_ROUNDS=1000` to make the account tests faster. The browser test `test/e2e.js` runs the whole review flow in a real browser in browser-only mode (Playwright).

## What each group covers

| Group | Where | Tests | What it proves |
|---|---|---|---|
| Engine | `test/engine.test.js` | 31 | Sentence splitting, terminology, tone, reading level, numbers, claims against facts, expiring facts, meaning check, redaction, contrast, and an 18-case labelled set |
| AI and workflow | `test/ai-workflow.test.js` | 13 | The AI answer is validated (real source, exact quote), prompt building, receipts, role rules of the approval chain |
| Files | `test/files.test.js` | 6 | Word text and alt text, "not a Word file" error, image colours, PDF text to lines, OCR clean-up, page labels |
| Matching | `test/matching.test.js` | 8 | New matcher beats the old one on the measured set, never passes a wrong claim, synonyms, opposite meaning, different name, number words |
| Python parity | `backend/tests/test_engine_parity.py`, `test_matching.py` | 8 | The Python engine gives the same answers as the JavaScript engine on about 110 inputs and on the 52 matching cases |
| Server | `backend/tests/test_server.py`, `test_ai.py`, `test_store.py`, `test_workflow_files.py`, `test_accounts.py` | rest of 65 | Prompt guard, rate limits, redaction, login, workspace isolation (another workspace gets 404), only the author edits, Legal cannot be skipped, the server sends a draft with an unverified claim to Legal, the AI switch is enforced, password hashing, token expiry, sign-up limits |

## Results

| Run | Result | When and where |
|---|---|---|
| Python, all tests | 65 tests, OK | 28 Oct 2026, team machine (Windows) |
| `test/files.test.js` | 6 of 6 pass | 28 Oct 2026, team machine |
| Matching, old versus new | 38 of 52 versus 50 of 52 right verdicts | 28 Oct 2026, team machine |
| JavaScript engine, AI and workflow, matching tests | pass in our build environment | 28 Oct 2026; re-run `node --test test/` to confirm on your machine |
| `test/e2e.js` browser test | All pass (35+ checks, 9 screenshots generated in `shots/`) | 29 Oct 2026, Windows (Chrome headless) |
| Live site by hand | PDF upload with page labels, picture OCR, the three matching conflicts (opposite meaning, wrong place, number as words) | 27 to 29 Oct 2026 |

## Measured claim matching

The frozen set `test/matching_testset.json` has 52 claims and 12 approved facts. Each claim has a written answer: which fact it is about and whether it agrees with it.

| | Old (word overlap) | New (meaning-aware) |
|---|---|---|
| Right fact found (38 claims that have a fact) | 31 (81.6%) | 36 (94.7%) |
| Reworded true claims found (23) | 16 (69.6%) | 22 (95.7%) |
| Claims with no fact, wrongly matched (14) | 1 | 0 |
| Right verdict overall (52) | 38 (73.1%) | 50 (96.2%) |
| Wrong claims passed as "verified" | 7 | 0 |

The set was written before the matcher and was not changed afterwards. The first run scored 49 of 52; one real bug (the spelling "flavours") was fixed and the score became 50 of 52. The remaining misses are M16 and M37. We wrote the set ourselves and it is small. See [MATCHING.md](MATCHING.md).

## What the labelled set in the engine tests is

The 18-case set in `src/data.js` consists of our own planted mistakes. The engine catches all 18 with no false alarms. It is a smoke test, not proof of accuracy on real content.

## Manual flow tested on the live site

Writer review and submit, Legal sign-off, Brand manager approval, private workspace sign-up, members, AI switch, PDF and picture upload. Record anything you re-test before submission:

| Flow | Tested by | Date | Result |
|---|---|---|---|
| | | | |

## Not tested

Load or long-running use; screen readers; browsers other than Chrome; scanned PDFs longer than 5 pages; non-English text.