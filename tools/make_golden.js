// Runs the JavaScript engine on many inputs and stores its answers. The Python tests must reproduce them exactly.
const fs = require('fs'), E = require('../src/engine.js'), D = require('../src/data.js'), AI = require('../src/ai.js');
const NOW = new Date('2026-10-22T08:00:00Z');
const clone = (o) => JSON.parse(JSON.stringify(o));
const variants = {
  base: D.sources,
  renewed: (() => { const s = clone(D.sources); s.facts.find((f) => f.id === 'F-04').validUntil = '2026-12-31'; return s; })(),
  nohype: (() => { const s = clone(D.sources); s.rules.find((r) => r.id === 'R-TONE-HYPE').enabled = false; s.terms[0].enabled = false; return s; })(),
};
const extra = [
  '', 'Hello.', 'Hello! Wow! Great!', 'Costs $3.50 today. Wow!! Next line\nAnother one?',
  'Tidewell makes it easy to stay hydrated. Stir one scoop into water and go.',
  'The mix is AMAZING for hot days. Cheap and cheerful, guys!', 'Our electrolyte powder is great.',
  'Hello. ![Runner](a.png) Great!', '<img src="a.png"> and <img src="b.png" alt="Runner drinking"> click here',
  'Each serving contains 500 mg of sodium. Orders ship within 2 days. Returns are accepted within 30 days. Tidewell is made in Portland, Oregon.',
  'Free shipping on orders over $50. Tidewell comes in 4 flavours and 5 flavours.',
  'Tidewell was created by a small team of athletes in Portland who wanted a better way to stay hydrated on long trail runs, and they spent years testing every recipe with real runners before they felt ready to share it with the world.',
  'Clinically proven to cure cramps; best-in-class and a miracle for everyone!!!', 'Project Marlin and the Q4 pricing plan are secret. Email priya@tidewell.example or +91 98765 43210.',
  'It is the best. Only Tidewell. Guaranteed to prevent cramps. 100% natural, since 2019, award-winning, #1 choice.',
  'Short. Sentences. Here. Again. And again. Over and over for a very long and complicated unreadable document that keeps going and going with extraordinarily complicated terminology and multisyllabic pronunciations throughout.',
];
const texts = [...D.samples.map((s) => s.text), ...D.evalSet.map((c) => c.text), ...extra];
const pick = (f) => ({ id: f.id, ruleId: f.ruleId, sourceId: f.sourceId || null, category: f.category, severity: f.severity, start: f.start, end: f.end, quote: f.quote, title: f.title, explanation: f.explanation, ctxStart: f.ctxStart, ctxEnd: f.ctxEnd, key: f.key, status: f.status, origin: f.origin, confidence: f.confidence, sourceLabel: f.sourceLabel, keep: f.keep || null, unverified: f.unverified || null, needsSpecialist: f.needsSpecialist || null, allowedNew: f.allowedNew || null, factId: f.factId || null, fixes: f.fixes.map((x) => ({ id: x.id, label: x.label, replacement: x.replacement })) });
const out = { now: NOW.toISOString(), reviews: [], evals: {}, units: {} };
for (const [vn, src] of Object.entries(variants)) {
  for (const t of texts) {
    const r = E.reviewText(t, src, { now: NOW });
    const fixes = r.findings.map((f) => { const ev = E.evaluateFixes(f, t); return { id: f.id, ok: ev.ok.map((x) => [x.id, x.after, x.check.ok]), blocked: ev.blocked.map((x) => [x.id, x.after, x.check.missing, x.check.added]) }; });
    out.reviews.push({ variant: vn, text: t, findings: r.findings.map(pick), verified: r.verified, stats: r.stats, fixes });
  }
  out.evals[vn] = E.evaluateSet(D.evalSet, src, { now: NOW });
}
const U = out.units;
U.numbers = ['600 mg of sodium for $40 since 2022, 5 flavours, 1,200 people, 3.5%', 'Over 50 percent. 30 days', 'no numbers here'].map((s) => [s, E.numbersOf(s).map((n) => ({ raw: n.raw, value: n.value, unit: n.unit, index: n.index, end: n.end }))]);
U.chips = ['Each serving packs 600 mg of sodium.', 'Clinically proven to reduce cramps and recover faster.', 'Stir one scoop of Tidewell into cold water, then enjoy Portland style.'].map((s) => [s, E.keepChips(s)]);
U.meaning = [['Stay hydrated on long runs.', 'Stay hydrated on long runs with 900 mg of sodium, clinically proven.', []], ['Clinically proven to reduce cramps.', 'Tidewell is made in Portland.', ['cramps']], ['Each serving packs 600 mg of sodium.', 'Each serving packs 500 mg of sodium.', ['sodium'], ['500 mg']]].map(([a, b, k, n]) => [a, b, k, n || [], (({ ok, missing, added, retained }) => ({ ok, missing, added, retained }))(E.meaningCheck(a, b, { mustKeep: k, allowedNew: n || [] }))]);
U.grade = texts.slice(0, 8).map((t) => [t, E.fkGrade(t)]);
U.contrast = [['#000000', '#FFFFFF'], ['#777777', '#FFFFFF'], ['#999', '#fff'], ['#14213D', '#FBFBF8'], ['zzz', '#fff']].map(([a, b]) => [a, b, E.contrastRatio(a, b)]);
U.redact = ['Project Marlin: mail priya@tidewell.example or +91 98765 43210. Price $3.50. The q4 PRICING PLAN is ready.', 'Nothing secret here.'].map((s) => [s, E.redact(s, D.sources.confidential)]);
U.retrieve = ['Each serving has sodium for runners', 'We beat every other hydration brand', 'Free shipping on all orders'].map((s) => [s, E.retrieve(s, { ...D.sources, guidelines: D.sources.guidelines }, 5).map((x) => x.id)]);
U.sentences = ['Costs $3.50 today. Wow!! Next line\nAnother one?', '  Leading space. Trailing  ', 'One', '', 'A.B. C? D!!! E'].map((s) => [s, E.splitSentences(s)]);
U.visual = [{ alt: '', fg: '#999999', bg: '#FFFFFF', dominant: [{ hex: '#FF00FF', share: 0.4 }, { hex: '#14213D', share: 0.5 }], isLogo: true, width: 80 }, { alt: 'A runner', dominant: [{ hex: '#0F766E', share: 0.9 }], isLogo: true, width: 400 }].map((i) => [i, E.checkVisual(i, D.sources).map((f) => ({ ruleId: f.ruleId, title: f.title, severity: f.severity, category: f.category }))]);
U.factStatus = [['2026-09-30'], ['2026-11-15'], ['2027-06-30'], ['']].map(([u]) => [u, E.factStatus({ validUntil: u }, NOW)]);
fs.writeFileSync(__dirname + '/../backend/tests/golden.json', JSON.stringify(out));
console.log('golden: ' + out.reviews.length + ' reviews, ' + out.reviews.reduce((a, r) => a + r.findings.length, 0) + ' findings');

// Answers of the claim-to-fact matcher on the measured test set. The Python tests must reproduce them.
{
  const T = require('../test/matching_testset.json');
  const rows = T.cases.map((c) => {
    const m = E.matchFact(c.claim, T.facts);
    const st = m ? E.claimStance(c.claim, m) : { stance: 'none' };
    return { id: c.id, factId: m ? m.fact.id : null, score: m ? m.score : null, stance: st.stance, kind: st.kind || null };
  });
  fs.writeFileSync(__dirname + '/../backend/tests/matching_golden.json', JSON.stringify(rows));
  console.log('matching golden: ' + rows.length + ' cases');
}