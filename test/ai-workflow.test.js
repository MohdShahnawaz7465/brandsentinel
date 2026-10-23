const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');
const D = require('../src/data.js');
const A = require('../src/ai.js');
const W = require('../src/workflow.js');

const NOW = new Date('2026-10-22T08:00:00Z');
const S = D.sources;
const TEXT = 'Our community of runners trusts Tidewell to keep every long weekend run fun. Project Marlin lead is priya@tidewell.example today. We beat every other hydration brand without breaking a sweat.';

function mock(findingsFn) {
  const calls = [];
  return { name: 'mock-model', calls, call: async (prompt) => { calls.push(prompt); return findingsFn(prompt); } };
}

test('AI off: nothing is sent and the receipt says so', async () => {
  const p = mock(() => ({ findings: [] }));
  const r = await A.aiReview({ text: TEXT, sources: S, localFindings: [], provider: p, enabled: false });
  assert.strictEqual(r.receipt.mode, 'rules-only');
  assert.strictEqual(p.calls.length, 0);
  assert.strictEqual(r.receipt.bytes, 0);
});

test('no provider: rules-only receipt', async () => {
  const r = await A.aiReview({ text: TEXT, sources: S, localFindings: [], provider: null, enabled: true });
  assert.strictEqual(r.receipt.mode, 'rules-only');
});

test('prompt carries redacted text only, receipt lists exactly what was sent', async () => {
  const p = mock(() => ({ findings: [] }));
  const r = await A.aiReview({ text: TEXT, sources: S, localFindings: [], provider: p, enabled: true });
  assert.strictEqual(p.calls.length, 1);
  assert.ok(!/Marlin|priya@/.test(p.calls[0]), 'confidential data must not reach provider');
  assert.match(p.calls[0], /\[CONFIDENTIAL\]/);
  assert.strictEqual(r.receipt.mode, 'ai-assisted');
  assert.ok(r.receipt.sent.every((s) => p.calls[0].includes(s.text)));
  assert.ok(r.receipt.redactions.length >= 1);
  assert.ok(r.receipt.sourceIds.length > 0);
});

test('grounding: keeps valid findings, blocks invented sources and fake quotes', async () => {
  const p = mock(() => ({
    findings: [
      { segment: 2, quote: 'We beat every other hydration brand', sourceId: 'G-2', category: 'messaging', severity: 'high', title: 'Compares to competitors', explanation: 'Guideline G-2 forbids comparisons.', confidence: 0.8, suggestions: ['We make hydration simple'] },
      { segment: 2, quote: 'We beat every other hydration brand', sourceId: 'G-99', title: 'Invented source' },
      { segment: 2, quote: 'text that is not there', sourceId: 'G-2', title: 'Fake quote' },
      { segment: 9, quote: 'x', sourceId: 'G-2', title: 'Bad segment' },
    ],
  }));
  const r = await A.aiReview({ text: TEXT, sources: S, localFindings: [], provider: p, enabled: true });
  assert.strictEqual(r.findings.length, 1);
  const f = r.findings[0];
  assert.strictEqual(f.origin, 'ai');
  assert.strictEqual(TEXT.slice(f.start, f.end), f.quote);
  assert.strictEqual(r.receipt.blocked.length, 3);
  assert.match(r.receipt.blocked[0].reason, /not in the source library/);
  const ev = E.evaluateFixes(f, TEXT, f.keep);
  assert.ok(ev.ok.length + ev.blocked.length === 1);
});

test('provider failure is reported in the receipt, not thrown', async () => {
  const p = { name: 'bad', call: async () => { throw new Error('rate_limited'); } };
  const r = await A.aiReview({ text: TEXT, sources: S, localFindings: [], provider: p, enabled: true });
  assert.strictEqual(r.findings.length, 0);
  assert.strictEqual(r.receipt.error, 'rate_limited');
});

test('sentences already flagged by fixed checks are not sent', () => {
  const local = E.reviewText(TEXT + ' Our cheap mix is great for runners every day.', S, { now: NOW }).findings;
  const segs = A.pickSegments(TEXT + ' Our cheap mix is great for runners every day.', local);
  assert.ok(!segs.some((s) => /cheap/.test(s.text)));
});

test('workflow: submit is blocked until findings are triaged, then routes', () => {
  const sub = { versions: [{}], status: 'draft' };
  assert.strictEqual(W.validateSubmit(sub, [{ status: 'open' }]).ok, false);
  assert.strictEqual(W.validateSubmit(sub, [{ status: 'disputed', reason: '' }]).ok, false);
  assert.strictEqual(W.validateSubmit(sub, [{ status: 'fixed' }]).route, 'awaiting_manager');
  assert.strictEqual(W.validateSubmit(sub, [{ status: 'disputed', reason: 'ok', needsSpecialist: true }]).route, 'awaiting_specialist');
});

test('workflow: only the right role can move a piece', () => {
  const sub = { status: 'awaiting_specialist' };
  assert.strictEqual(W.transition(sub, 'brand_manager', 'approve').ok, false);
  assert.strictEqual(W.transition(sub, 'writer', 'signoff').ok, false);
  assert.strictEqual(W.transition(sub, 'legal', 'signoff').to, 'awaiting_manager');
  assert.strictEqual(W.transition({ status: 'awaiting_manager' }, 'brand_manager', 'approve').to, 'approved');
  assert.strictEqual(W.transition({ status: 'awaiting_manager' }, 'brand_manager', 'request_changes').to, 'changes_requested');
  assert.strictEqual(W.transition({ status: 'draft' }, 'brand_manager', 'approve').ok, false);
});

test('insights: top rules, disputes, unclear rules, repeats', () => {
  const i = W.insights(D.seedHistory(), (id) => id);
  assert.strictEqual(i.topRules[0].ruleId, 'T-03');
  const len = i.disputes.find((d) => d.ruleId === 'R-READ-LEN');
  assert.ok(len.rate >= 0.5);
  assert.ok(i.unclearRules.some((u) => u.ruleId === 'R-READ-LEN'));
  assert.ok(i.repeats.some((r) => r.author === 'Asha Rao' && r.ruleId === 'T-03'));
  assert.strictEqual(i.clarity.pct, null);
});

test('diffWords marks added and removed words', () => {
  const d = W.diffWords('Our cheap mix is great', 'Our affordable mix is great');
  assert.deepStrictEqual(d.filter((x) => x.type !== 'same').map((x) => [x.type, x.t]), [['del', 'cheap'], ['add', 'affordable']]);
});

test('OpenAI-compatible adapter talks to a real local HTTP endpoint', async () => {
  const http = require('node:http');
  let seen;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen = { auth: req.headers.authorization, body: JSON.parse(b) };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '```json\n{"findings":[{"segment":2,"quote":"We beat every other hydration brand","sourceId":"G-2","title":"Comparison","explanation":"G-2","suggestions":[]}]}\n```' } }] }));
    });
  });
  await new Promise((r) => srv.listen(0, r));
  const url = 'http://127.0.0.1:' + srv.address().port + '/v1/chat/completions';
  const prov = A.openAICompatible({ url, model: 'test-model', key: 'k123' });
  const r = await A.aiReview({ text: TEXT, sources: S, localFindings: [], provider: prov, enabled: true });
  srv.close();
  assert.strictEqual(seen.auth, 'Bearer k123');
  assert.ok(!/Marlin/.test(seen.body.messages[0].content));
  assert.strictEqual(r.findings.length, 1);
});

test('reworded unverified claim still routes to Legal', () => {
  assert.strictEqual(W.validateSubmit({ versions: [{}], needsLegal: true }, [{ status: 'fixed' }]).route, 'awaiting_specialist');
});
