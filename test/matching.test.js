const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');
const T = require('./matching_testset.json');

function score(matcher, stanceOf) {
  const rows = T.cases.map((c) => {
    const m = matcher(c.claim, T.facts);
    const got = m ? m.fact.id : null, stance = m ? stanceOf(c.claim, m) : 'none';
    return { c, got, stance, rightFact: got === c.expectedFactId, rightVerdict: got === c.expectedFactId && stance === c.expectedStance };
  });
  return {
    rows,
    verdict: rows.filter((r) => r.rightVerdict).length,
    falselyVerified: rows.filter((r) => r.c.expectedStance !== 'supported' && r.stance === 'supported').length,
    wronglyMatched: rows.filter((r) => !r.c.expectedFactId && r.got).length,
    paraphrases: rows.filter((r) => r.c.group === 'paraphrase' && r.rightFact).length,
  };
}
const oldStance = (s, m) => { const fn = E.numbersOf(m.fact.text); return E.numbersOf(s).some((n) => fn.some((x) => x.unit === n.unit && x.unit !== '' && x.value !== n.value)) ? 'conflict' : 'supported'; };
const O = score(E.matchFactLegacy, oldStance);
const N = score(E.matchFact, (s, m) => E.claimStance(s, m).stance);

test('test set is the frozen 52-case set', () => { assert.strictEqual(T.cases.length, 52); });
test('new matcher beats the old one on the measured set', () => {
  assert.ok(N.verdict > O.verdict, 'new ' + N.verdict + ' vs old ' + O.verdict);
  assert.ok(N.paraphrases > O.paraphrases);
});
test('new matcher: at least 94% right verdicts, never passes a wrong claim as verified, never matches a claim that has no fact', () => {
  assert.ok(N.verdict / T.cases.length >= 0.94, 'right verdicts: ' + N.verdict + '/' + T.cases.length);
  assert.strictEqual(N.falselyVerified, 0);
  assert.strictEqual(N.wronglyMatched, 0);
});
test('synonyms and number words find the same fact', () => {
  const id = (s) => { const m = E.matchFact(s, T.facts); return m && m.fact.id; };
  assert.strictEqual(id('We dispatch orders in two days.'), 'F-05');
  assert.strictEqual(id('You can return items within 30 days.'), 'F-06');
  assert.strictEqual(id('Tidewell is available in four flavors.'), 'F-08');
});
test('opposite meaning is a conflict, not a match', () => {
  const m = E.matchFact('Returns are not accepted within 30 days.', T.facts);
  assert.strictEqual(m.fact.id, 'F-06');
  assert.strictEqual(E.claimStance('Returns are not accepted within 30 days.', m).kind, 'negation');
  const g = E.matchFact('Gift cards do not have an expiry date.', T.facts);
  assert.strictEqual(E.claimStance('Gift cards do not have an expiry date.', g).stance, 'supported');
});
test('a different place is a conflict', () => {
  const m = E.matchFact('Tidewell is made in Portland, Maine.', T.facts);
  const st = E.claimStance('Tidewell is made in Portland, Maine.', m);
  assert.deepStrictEqual([st.kind, st.have, st.want], ['name', 'Maine', 'Oregon']);
});
test('a number written as words is compared with the approved number', () => {
  const m = E.matchFact('Orders ship within five days.', T.facts);
  const st = E.claimStance('Orders ship within five days.', m);
  assert.strictEqual(st.kind, 'number');
  assert.strictEqual(st.number.raw, 'five days');
  assert.strictEqual(E.allNumbers('Take 500 milligrams twice')[0].unit, 'mg');
});
test('reviewText turns the new conflicts into findings with a safe fix', () => {
  const S = { rules: [{ id: 'R-CLAIM-1', enabled: true, text: 'Claims need approved facts.' }], facts: T.facts, terms: [], confidential: [] };
  const NOW = new Date('2026-10-22T08:00:00Z');
  const r = E.reviewText('Returns are not accepted within 30 days.', S, { now: NOW });
  assert.strictEqual(r.findings.length, 1);
  assert.match(r.findings[0].title, /opposite of approved fact F-06/);
  const ev = E.evaluateFixes(r.findings[0], 'Returns are not accepted within 30 days.');
  assert.strictEqual(ev.ok[0].after, 'Returns are accepted within 30 days.');
  const ok = E.reviewText('We dispatch orders in two days.', S, { now: NOW });
  assert.strictEqual(ok.verified[0].factId, 'F-05');
});