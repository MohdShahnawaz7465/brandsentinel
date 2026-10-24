const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');
const D = require('../src/data.js');

const NOW = new Date('2026-10-22T08:00:00Z');
const S = D.sources;
const review = (t) => E.reviewText(t, S, { now: NOW });
const rules = (t) => review(t).findings.map((f) => f.ruleId);

test('splitSentences handles decimals, newlines and !!', () => {
  const s = E.splitSentences('Costs $3.50 today. Wow!! Next line\nAnother one?');
  assert.deepStrictEqual(s.map((x) => x.text), ['Costs $3.50 today.', 'Wow!!', 'Next line', 'Another one?']);
});

test('terminology: finds banned terms, preserves case in fix', () => {
  const r = review('Cheap powder for you.');
  const f = r.findings.filter((x) => x.category === 'terminology');
  assert.strictEqual(f.length, 2);
  assert.strictEqual(f.find((x) => x.quote === 'Cheap').fixes[0].replacement, 'Affordable');
});

test('number conflict against approved fact', () => {
  const r = review('Each serving packs 600 mg of sodium.');
  const f = r.findings.find((x) => x.ruleId === 'R-CLAIM-1');
  assert.ok(f, 'conflict found');
  assert.strictEqual(f.quote, '600 mg');
  assert.strictEqual(f.fixes[0].replacement, '500 mg');
  const ev = E.evaluateFixes(f, 'Each serving packs 600 mg of sodium.');
  assert.strictEqual(ev.ok.length, 1);
  assert.strictEqual(ev.ok[0].after, 'Each serving packs 500 mg of sodium.');
});

test('matching claim is verified, not flagged', () => {
  const r = review('Each serving contains 500 mg of sodium.');
  assert.strictEqual(r.findings.length, 0);
  assert.strictEqual(r.verified.length, 1);
  assert.strictEqual(r.verified[0].factId, 'F-01');
});

test('improvement 1: expired fact is flagged with date, current fact offered', () => {
  const r = review('Enjoy free shipping on every order over $40.');
  const f = r.findings.find((x) => x.ruleId === 'R-FACT-EXPIRED');
  assert.ok(f);
  assert.match(f.title, /2026-09-30/);
  assert.strictEqual(f.fixes[0].replacement, 'Shipping rates are calculated at checkout.');
  assert.strictEqual(E.evaluateFixes(f, 'Enjoy free shipping on every order over $40.').ok.length, 1);
});

test('improvement 1: same text is fine before the fact expired', () => {
  const r = E.reviewText('Enjoy free shipping on every order over $40.', S, { now: new Date('2026-08-01T00:00:00Z') });
  assert.strictEqual(r.findings.length, 0);
});

test('improvement 1: fact expiring soon gives a low warning', () => {
  const r = review('Orders ship within 2 days.');
  assert.deepStrictEqual(r.findings.map((f) => f.ruleId), ['R-FACT-EXPIRING']);
  assert.match(r.findings[0].title, /25 days/);
});

test('unsupported health claim is unverified, high, needs specialist', () => {
  const r = review('Clinically proven to reduce cramps and recover faster.');
  const f = r.findings[0];
  assert.strictEqual(f.ruleId, 'R-CLAIM-REG');
  assert.strictEqual(f.unverified, true);
  assert.strictEqual(f.needsSpecialist, true);
});

test('improvement 2: meaning check keeps intent, blocks rewrites that drop it', () => {
  const text = 'Clinically proven to reduce cramps and recover faster.';
  const f = review(text).findings[0];
  assert.ok(f.keep.includes('cramps') || f.keep.includes('cramp'));
  const ok = E.evaluateFixes(f, text);
  assert.ok(ok.ok.some((x) => /help with cramps/.test(x.after)), 'softened version kept');
  const bad = E.meaningCheck(text, 'Tidewell is made in Portland.', { mustKeep: ['cramps'] });
  assert.strictEqual(bad.ok, false);
  assert.deepStrictEqual(bad.missing, ['cramps']);
});

test('improvement 2: meaning check blocks rewrites that add numbers or claims', () => {
  const r = E.meaningCheck('Stay hydrated on long runs.', 'Stay hydrated on long runs with 900 mg of sodium, clinically proven.', { mustKeep: [] });
  assert.strictEqual(r.ok, false);
  assert.ok(r.added.includes('900 mg'));
  assert.ok(r.added.includes('clinical'));
});

test('improvement 2: writer can add intent and fix is re-checked', () => {
  const text = 'Clinically proven to reduce cramps and recover faster.';
  const f = review(text).findings[0];
  const strict = E.evaluateFixes(f, text, ['cramps', 'Portland']);
  assert.strictEqual(strict.ok.length, 0);
  assert.ok(strict.blocked[0].check.missing.includes('Portland'));
});

test('tone: only the extra exclamation marks are flagged', () => {
  const f = review('Hello! Wow! Great!').findings.filter((x) => x.ruleId === 'R-TONE-EXCL');
  assert.strictEqual(f.length, 2);
});

test('hype word removal tidies spacing', () => {
  const t = 'Tidewell is the amazing new mix.';
  const f = review(t).findings.find((x) => x.ruleId === 'R-TONE-HYPE');
  assert.strictEqual(E.applyFix(t, f, f.fixes[0]), 'Tidewell is the new mix.');
});

test('long sentence split fix keeps all words', () => {
  const t = 'Tidewell was created by a small team of athletes in Portland who wanted a better way to stay hydrated on long trail runs, and they spent years testing every recipe with real runners before they felt ready to share it.';
  const f = review(t).findings.find((x) => x.ruleId === 'R-READ-LEN');
  assert.ok(f && f.fixes.length === 1);
  const ev = E.evaluateFixes(f, t, f.keep);
  assert.strictEqual(ev.ok.length, 1);
});

test('confidential name in copy is flagged', () => {
  assert.ok(rules('Project Marlin launches soon.').includes('R-CONF-1'));
});

test('alt text and link text', () => {
  const r = rules('![](a.png) and <img src="b.png"> and <img src="c.png" alt="Runner drinking"> click here');
  assert.strictEqual(r.filter((x) => x === 'R-A11Y-ALT').length, 2);
  assert.ok(r.includes('R-A11Y-LINK'));
});

test('disabled rule is skipped', () => {
  const s2 = JSON.parse(JSON.stringify(S));
  s2.rules.find((r) => r.id === 'R-TONE-HYPE').enabled = false;
  assert.ok(!E.reviewText('An amazing mix.', s2, { now: NOW }).findings.some((f) => f.ruleId === 'R-TONE-HYPE'));
});

test('contrast ratio matches WCAG reference values', () => {
  assert.ok(Math.abs(E.contrastRatio('#000000', '#FFFFFF') - 21) < 0.01);
  assert.ok(Math.abs(E.contrastRatio('#777777', '#FFFFFF') - 4.48) < 0.02);
});

test('visual checks: alt, contrast, off-palette, logo size', () => {
  const f = E.checkVisual({ alt: '', fg: '#999999', bg: '#FFFFFF', dominant: [{ hex: '#FF00FF', share: 0.4 }, { hex: '#14213D', share: 0.5 }], isLogo: true, width: 80 }, S);
  const ids = f.map((x) => x.ruleId).sort();
  assert.deepStrictEqual(ids, ['R-A11Y-ALT', 'R-A11Y-CONTRAST', 'R-VIS-LOGO', 'R-VIS-PALETTE']);
});

test('redaction removes confidential terms, emails, phones', () => {
  const r = E.redact('Project Marlin: mail priya@tidewell.example or +91 98765 43210. Price $3.50.', S.confidential);
  assert.ok(!/Marlin|priya|98765/.test(r.text));
  assert.match(r.text, /\$3\.50/);
  assert.strictEqual(r.redactions.length, 3);
});

test('retrieve returns relevant sources first', () => {
  const ids = E.retrieve('Each serving has sodium for runners', S, 3).map((x) => x.id);
  assert.ok(ids.includes('F-01'));
});

test('labelled test set: recall and precision', () => {
  const r = E.evaluateSet(D.evalSet, S, { now: NOW });
  console.log('EVAL', JSON.stringify({ planted: r.planted, caught: r.caught, recall: r.recall, flagged: r.flagged, precision: r.precision, misses: r.misses, falsePos: r.falsePos }));
  assert.ok(r.recall >= 0.8, 'recall ' + r.recall);
  assert.ok(r.precision >= 0.8, 'precision ' + r.precision);
});

test('sample draft 1 finds every planted problem', () => {
  const r = review(D.samples[0].text);
  const got = new Set(r.findings.map((f) => f.ruleId));
  for (const id of ['T-01', 'T-02', 'T-03', 'T-04', 'R-TONE-HYPE', 'R-TONE-CAPS', 'R-TONE-EXCL', 'R-CLAIM-1', 'R-CLAIM-REG', 'R-FACT-EXPIRED', 'R-CONF-1', 'R-A11Y-ALT', 'R-A11Y-LINK']) assert.ok(got.has(id), 'missing ' + id);
  assert.ok(r.verified.length >= 2);
});

test('sample draft 2 is clean except the expiring fact', () => {
  assert.deepStrictEqual(rules(D.samples[1].text), ['R-FACT-EXPIRING']);
});

test('word-level fixes are not blocked by their own quoted words', () => {
  const t1 = 'A sugar-free way to hydrate.';
  const f1 = review(t1).findings.find((f) => f.ruleId === 'T-03');
  assert.ok(!f1.keep.includes('sugar-free'));
  assert.strictEqual(E.evaluateFixes(f1, t1, f1.keep).ok.length, 1);
  const t2 = 'Tidewell is the AMAZING new mix for runners.';
  const f2 = review(t2).findings.find((f) => f.ruleId === 'R-TONE-HYPE');
  assert.strictEqual(E.evaluateFixes(f2, t2, f2.keep).ok.length, 1);
  assert.ok(f2.keep.includes('tidewell'), 'other names are still protected');
});

test('every fix the engine offers on the sample drafts passes its own default meaning check, except deliberate blocks', () => {
  for (const sm of D.samples) {
    const r = review(sm.text);
    for (const f of r.findings) {
      if (!f.fixes.length) continue;
      const ev = E.evaluateFixes(f, sm.text, f.keep);
      if (f.category === 'claim' && f.unverified) continue; // unsupported claims may be blocked on purpose
      const bad = ev.blocked.filter((b) => b.scope !== 'sentence'); // dropping a whole sentence is blocked on purpose until the writer drops that point
      assert.strictEqual(bad.length, 0, sm.id + ' ' + f.ruleId + ' ' + f.quote + ' blocked: ' + JSON.stringify(bad.map((b) => b.check)));
    }
  }
});

test('unsupported claim: removing it is blocked until the writer drops that point from the intent', () => {
  const text = 'Clinically proven to reduce cramps and recover faster.';
  const f = review(text).findings[0];
  const remove = (ev) => [...ev.ok, ...ev.blocked].find((x) => x.label === 'Remove this claim');
  const strict = E.evaluateFixes(f, text, f.keep);
  assert.strictEqual(strict.blocked.some((x) => x.label === 'Remove this claim'), true);
  const relaxed = E.evaluateFixes(f, text, []);
  assert.strictEqual(remove(relaxed).check.ok, true);
});

test('markdown image bang is not an exclamation mark', () => {
  assert.ok(!review('Hello. ![Runner](a.png) Great!').findings.some((f) => f.ruleId === 'R-TONE-EXCL'));
});

test('replacement does not double a neighbouring word', () => {
  const t = 'Our electrolyte powder is great.';
  const f = review(t).findings.find((x) => x.ruleId === 'T-04');
  assert.strictEqual(E.applyFix(t, f, f.fixes[0]), 'Our electrolyte mix is great.');
});

test('confidential name: both "remove name" and "remove sentence" are offered', () => {
  const t = 'Hello there. Project Marlin launches soon. Bye now.';
  const f = review(t).findings.find((x) => x.ruleId === 'R-CONF-1');
  assert.deepStrictEqual(f.fixes.map((x) => x.label), ['Remove "Project Marlin"', 'Remove this sentence']);
  assert.strictEqual(E.applyFix(t, f, f.fixes[1]), 'Hello there. Bye now.');
  assert.strictEqual(E.applyFix(t, f, f.fixes[0]), 'Hello there. launches soon. Bye now.');
  const ev = E.evaluateFixes(f, t, f.keep);
  assert.ok(ev.blocked.some((x) => x.label === 'Remove this sentence'), 'blocked while the point is still required');
  assert.ok(E.evaluateFixes(f, t, []).ok.some((x) => x.label === 'Remove this sentence'), 'allowed once the writer drops the point');
});