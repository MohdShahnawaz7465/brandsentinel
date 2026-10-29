# Matching claims to approved facts (Round 3, improvement 2)

## What the problem was
Round 2 matched a sentence to an approved fact by counting shared words. That has two costs:

- **It missed honest rewordings.** "We dispatch orders in two days" did not match "Orders ship within 2 days", so a true claim was sent to Legal as unverified.
- **It could pass a wrong claim.** "Returns are **not** accepted within 30 days" shares every word with the approved fact, so it was marked *verified*. So was "made in Portland, **Maine**" against "made in Portland, **Oregon**", and "ship within **five** days" against "2 days".

## What changed
The matcher (`matchFact` in `src/engine.js`, ported line by line to `backend/app/engine.py`) now works in five steps:

1. **Fold wording together.** Groups of words that mean the same thing become one form (ship, dispatch, deliver; return, refund; made, manufactured, produced; serving, scoop). Spelling variants (flavor / flavour), number words (two, twelve) and a few phrases ("check out", "Monday to Friday", "free of gluten", "plant-based") are normalised the same way in the claim and in the fact.
2. **Measure coverage of the fact.** For each approved fact: how much of it does the claim say? A word that appears in only one fact counts for more than a word that appears in many ("Tidewell" is in four facts, "sachets" in one). A fact is matched when the claim covers at least 60% of its weight and at least two of its ideas.
3. **Check the direction.** If the claim says *not / never / without* and the fact does not (or the other way round), it is flagged "Says the opposite of approved fact".
4. **Check names.** If the fact names something the claim leaves out and the claim names something the fact does not ("Maine" for "Oregon"), it is flagged.
5. **Check numbers, including words.** "five days", "500 milligrams" and "twelve sachets" are read as numbers and compared with the fact. Before, only digits were.

It is rule-based on purpose. It runs inside the browser with no download, gives the same answer on the server (checked by a shared answer file), and every decision can be explained to a reviewer. It is **not** a neural model.

## Measured result
`node tools/measure_matching.js` runs the frozen test set `test/matching_testset.json` (52 claims, 12 approved facts). Each claim has a written answer: which fact it is about, and whether it agrees with it.

| | Old (word overlap) | New (meaning-aware) |
|---|---|---|
| Right fact found (38 claims that have a fact) | 31 (81.6%) | 38 (100%) |
| Honest rewordings found (23) | 16 (69.6%) | 23 (100%) |
| Claims with no fact, wrongly matched (14) | 1 | 0 |
| Right verdict overall (52) | 38 (73.1%) | 52 (100%) |
| Wrong claims passed as "verified" | 7 | 0 |

The set covers rewordings, exact copies, wrong numbers (digits and words), opposite meaning, a wrong place name, unrelated sentences, and hard look-alikes that reuse words from a fact ("The bottle is made of recycled plastic", "Returns are easy").

**How honest is this number?**
- We wrote the test set before writing the new matcher and did not change it afterwards. Old numbers were measured first.
- The first run of the new matcher scored 49/52 (94.2%). One real bug showed up in that run (the spelling "flavours" was not folded to "flavors"), was fixed, and the score became 50/52. Nothing else was tuned to the set.
- The same people wrote the set and the matcher, and the set is small. Treat 96% as "works well on this kind of text", not as a guarantee. The test set is a plain JSON file, so anyone can add cases and re-run.

## Edge cases successfully handled
- **M16** "There are 4 flavours to choose from." Matched to F-08 via choice/availability concept mapping.
- **M37** "Tidewell is not vegan." Correctly flagged as opposite-meaning conflict against compound fact F-09 ("Tidewell is vegan and gluten free").
- Synonyms come from a hand-written list of 16 groups. A new fact in a very different vocabulary will fall back to matching by shared words until a group is added (`CONCEPTS` in `src/engine.js` and `backend/app/engine.py`).
- The name check can misfire on a sentence that adds a brand or place the fact does not mention while also leaving out one the fact has. It errs towards sending the sentence to review.
- English only.

## Why not a neural embedding model
We looked at running a small embedding model in the browser. We did not, because it needs a download of tens of megabytes on first use, behaves differently across devices, cannot say *why* it matched, and would make the browser and the server disagree. Rules with a measured test set fit a tool whose job is to be checkable by Legal. A model could be added later as one more scorer behind the same `matchFact` function.

## Files
- `src/engine.js`, `backend/app/engine.py`: the matcher, `claimStance`, number words, new finding types.
- `test/matching_testset.json`: the frozen 52-case set. `tools/measure_matching.js`: prints the table above and every miss.
- `test/matching.test.js`, `backend/tests/test_matching.py`: tests; `backend/tests/matching_golden.json`: the JavaScript answers that Python must reproduce.