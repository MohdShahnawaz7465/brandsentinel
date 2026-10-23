/* AI adapter: sends a few redacted sentences plus retrieved rules to a swappable provider, then
   keeps only findings that cite a real source and quote real text. Also builds the data-out receipt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.BSAI = factory(root.BSEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const CATS = ['tone', 'messaging', 'terminology', 'claim'];
  const SEVS = ['low', 'medium', 'high'];
  const MAX_SEGMENTS = 10, MAX_CHARS = 1800;

  function pickSegments(text, localFindings) {
    const sents = E.splitSentences(text);
    const covered = (s) => localFindings.some((f) => f.start >= 0 && f.start < s.end && f.end > s.start && f.category !== 'readability');
    const out = [];
    let chars = 0;
    for (const s of sents) {
      if (E.wordCount(s.text) < 6 || covered(s)) continue;
      if (out.length >= MAX_SEGMENTS || chars + s.text.length > MAX_CHARS) break;
      out.push(s); chars += s.text.length;
    }
    return out;
  }

  function buildPrompt(brand, segments, items) {
    return [
      'You are a careful brand reviewer for ' + brand + '. Review ONLY the numbered sentences below.',
      'Report a problem only when it breaks one of the SOURCES. Never invent a source. Copy "quote" exactly from the sentence.',
      'Each suggestion rewrites only the quoted text and must keep the writer\'s meaning. At most 3 suggestions.',
      'Return JSON only, in this shape: {"findings":[{"segment":0,"quote":"...","sourceId":"G-1","category":"tone|messaging|terminology|claim","severity":"low|medium|high","title":"short title","explanation":"why, in plain words","confidence":0.0,"suggestions":["..."]}]}',
      'If nothing is wrong return {"findings":[]}.',
      '',
      'SENTENCES:',
      segments.map((s, i) => i + ': ' + s.text).join('\n'),
      '',
      'SOURCES:',
      items.map((it) => '[' + it.id + '] (' + it.type + ') ' + it.text).join('\n'),
    ].join('\n');
  }

  function buildReceipt(r) {
    const sent = r.sent || [];
    return {
      id: 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(),
      mode: r.mode, provider: r.provider || '', reason: r.reason || '',
      sent, redactions: r.redactions || [], sourceIds: r.sourceIds || [],
      bytes: sent.reduce((a, s) => a + s.text.length, 0),
      accepted: r.accepted || 0, blocked: r.blocked || [], error: r.error || '',
    };
  }

  /* provider: { name, call(prompt) -> Promise<object> } or null */
  async function aiReview(opts) {
    const { text, sources, localFindings, provider, enabled } = opts;
    if (!enabled) return { findings: [], receipt: buildReceipt({ mode: 'rules-only', reason: 'AI review is switched off by an admin. Nothing left this page.' }) };
    if (!provider) return { findings: [], receipt: buildReceipt({ mode: 'rules-only', reason: 'No AI provider is available in this view. Nothing left this page.' }) };
    const segs = pickSegments(text, localFindings);
    if (!segs.length) return { findings: [], receipt: buildReceipt({ mode: 'rules-only', provider: provider.name, reason: 'Every sentence was already handled by the fixed checks, so nothing was sent.' }) };

    const redactions = [];
    const sent = segs.map((s, i) => {
      const r = E.redact(s.text, sources.confidential);
      r.redactions.forEach((x) => redactions.push(x));
      return { index: i, text: r.text };
    });
    const seen = new Map();
    sent.forEach((s) => E.retrieve(s.text, sources, 5).forEach((it) => seen.set(it.id, it)));
    const items = [...seen.values()].slice(0, 12);
    const sourceIds = items.map((i) => i.id);
    const prompt = buildPrompt(sources.name || 'the brand', sent, items);

    let raw;
    try {
      raw = await provider.call(prompt);
    } catch (e) {
      return { findings: [], receipt: buildReceipt({ mode: 'ai-assisted', provider: provider.name, sent, redactions, sourceIds, error: (e && (e.message || e.code)) || 'AI request failed' }) };
    }
    const list = raw && Array.isArray(raw.findings) ? raw.findings : [];
    const blocked = [], findings = [];
    const valid = new Set(sourceIds);
    list.forEach((f) => {
      const seg = segs[f && f.segment];
      const why = (reason) => blocked.push({ reason, title: (f && f.title) || '(untitled)' });
      if (!f || !seg) return why('refers to a sentence that was not sent');
      if (!valid.has(f.sourceId)) return why('cites "' + f.sourceId + '", which is not in the source library');
      const redSeg = sent[f.segment].text;
      if (!f.quote || !redSeg.includes(f.quote) || /\[(CONFIDENTIAL|EMAIL|PHONE)\]/.test(f.quote)) return why('quote does not appear in the sentence');
      const idx = seg.text.indexOf(f.quote);
      if (idx < 0) return why('quote cannot be located in the original text');
      const start = seg.start + idx, end = start + f.quote.length;
      if (opts.localFindings.some((l) => l.start >= 0 && l.start < end && l.end > start && l.category !== 'readability')) return why('already caught by a fixed check');
      const cat = CATS.includes(f.category) ? f.category : 'messaging';
      const conf = Math.max(0, Math.min(1, Number(f.confidence)));
      findings.push({
        id: 'A' + (findings.length + 1), ruleId: f.sourceId, sourceId: f.sourceId, origin: 'ai', category: cat,
        severity: SEVS.includes(f.severity) ? f.severity : 'medium', start, end, quote: f.quote,
        ctxStart: seg.start, ctxEnd: seg.end, title: String(f.title || 'AI-assisted finding').slice(0, 120),
        explanation: String(f.explanation || '').slice(0, 500), confidence: isNaN(conf) ? 0.5 : conf,
        fixes: (Array.isArray(f.suggestions) ? f.suggestions : []).slice(0, 3).filter((x) => typeof x === 'string').map((x, i) => ({ id: 'A' + (findings.length + 1) + '-' + (i + 1), label: 'AI suggestion', replacement: x })),
        status: 'open', sourceLabel: E.sourceLabel(sources, f.sourceId) || f.sourceId, key: f.sourceId + '|' + f.quote.toLowerCase(),
        keep: E.keepChips(seg.text),
      });
    });
    return { findings, receipt: buildReceipt({ mode: 'ai-assisted', provider: provider.name, sent, redactions, sourceIds, accepted: findings.length, blocked }) };
  }

  function parseJsonLoose(t) {
    if (t && typeof t === 'object') return t;
    let s = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    return JSON.parse(s);
  }
  /* Works with any OpenAI-compatible chat endpoint (OpenAI, Azure, Ollama, vLLM, LM Studio...). */
  function openAICompatible(cfg, fetchImpl) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    return {
      name: (cfg.model || 'model') + ' via ' + (function () { try { return new URL(cfg.url).host; } catch (e) { return cfg.url; } })(),
      call: async (prompt) => {
        const res = await f(cfg.url, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}),
          body: JSON.stringify({ model: cfg.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!res.ok) throw new Error('AI endpoint answered ' + res.status);
        const j = await res.json();
        return parseJsonLoose(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
      },
    };
  }
   /* Sends the (already redacted) prompt to the BrandSentinel server, which holds the API key. */
  function serverProvider(cfg, fetchImpl) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    const base = String(cfg.url || '').replace(/\/+$/, '');
    return {
      name: (cfg.model || 'AI model') + ' via BrandSentinel server',
      call: async (prompt) => {
        const res = await f(base + '/api/ai-complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
        if (!res.ok) throw new Error('AI server answered ' + res.status);
        return await res.json();
      },
    };
  }
  return { openAICompatible, serverProvider, parseJsonLoose, aiReview, pickSegments, buildPrompt, buildReceipt };
});
