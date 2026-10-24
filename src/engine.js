/* BrandSentinel review engine. Pure functions, no DOM, no network. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BSEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STOP = new Set(('a an the and or of to in on for with is are was were be been it its this that these those at by from as we you your our their they he she i not no do does did can will would should could may might have has had than then so if but into over per up out about more most all any each every just also very every enjoy get got').split(' '));
  const CLAIM_TRIGGERS = new Set(['clinical', 'clinically', 'proven', 'guarantee', 'guarantees', 'guaranteed', 'certified', 'cure', 'cures', 'cured', 'treat', 'treats', 'prevent', 'prevents', 'reduce', 'reduces', 'lower', 'lowers', 'boost', 'boosts', 'best', 'only', 'first', 'doctor', 'doctors', 'scientifically', 'award', 'winning']);
  const CLAIM_RE = /\b\d[\d,.]*\s?(%|percent|mg|kg|g|ml|oz|days?|years?|hours?|calories?|flavou?rs?|servings?)\b|\$\d|\b(clinically|proven|guarantee[sd]?|certified|award[- ]winning|number one|best|only|first|free shipping|made in|since \d{4}|cures?|treats?|prevents?|reduces?|lowers?|boosts?|doctors?|dermatologists?|scientifically|returns?)\b|#1/i;
  const REGULATED_RE = /clinically|clinical|\bcures?\b|\btreats?\b|\bprevents?\b|diagnos|doctor|dermatolog|scientifically|medical|disease/i;
  const SEV = { high: 0, medium: 1, low: 2 };

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function stem(w) {
    w = w.toLowerCase();
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('ly')) return w.slice(0, -2);
    if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
    return w;
  }
  function contentStems(s) {
    const ws = (s.toLowerCase().replace(/\d[\d,.]*/g, ' ').match(/[a-z][a-z'-]*/g) || []).filter((w) => w.length >= 3 && !STOP.has(w));
    return ws.map(stem);
  }
  function wordCount(s) { return (s.match(/[A-Za-z0-9$%][\w'$%.,-]*/g) || []).length; }

  /* ---------- numbers ---------- */
  const NUM_RE = /(\$)?(\d[\d,]*(?:\.\d+)?)\s?(%|percent|mg|kg|ml|oz|g|days?|years?|hours?|minutes?|calories?|flavou?rs?|servings?)?(?![A-Za-z])/gi;
  function normUnit(u, cur, value, hasComma) {
    if (cur) return '$';
    if (!u) return value >= 1900 && value <= 2100 && !hasComma ? 'yr' : '';
    u = u.toLowerCase();
    if (u === 'percent') return '%';
    if (u === 'flavour' || u === 'flavours') return 'flavor';
    return u.replace(/s$/, '') || u;
  }
  function numbersOf(s) {
    const out = [];
    let m;
    NUM_RE.lastIndex = 0;
    while ((m = NUM_RE.exec(s))) {
      const value = parseFloat(m[2].replace(/,/g, ''));
      if (isNaN(value)) continue;
      out.push({ raw: m[0].trim(), value, unit: normUnit(m[3], m[1], value, m[2].includes(',')), index: m.index, end: m.index + m[0].trimEnd().length });
    }
    return out;
  }

  /* ---------- sentences ---------- */
  function splitSentences(text) {
    const out = [];
    let start = 0;
    const n = text.length;
    const push = (e) => {
      let s = start; while (s < e && /\s/.test(text[s])) s++;
      let t = e; while (t > s && /\s/.test(text[t - 1])) t--;
      if (t > s) out.push({ start: s, end: t, text: text.slice(s, t) });
    };
    for (let i = 0; i < n; i++) {
      const c = text[i];
      if (c === '\n') { push(i); start = i + 1; continue; }
      if (c === '.' || c === '!' || c === '?') {
        let j = i;
        while (j + 1 < n && /[.!?]/.test(text[j + 1])) j++;
        if (j + 1 >= n || /\s/.test(text[j + 1])) { push(j + 1); start = j + 1; }
        i = j;
      }
    }
    push(n);
    return out;
  }
  function sentenceAt(sents, pos) { return sents.find((s) => pos >= s.start && pos < s.end) || sents.find((s) => pos === s.end) || null; }

  /* ---------- readability ---------- */
  function syllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!word) return 0;
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const m = word.match(/[aeiouy]{1,2}/g);
    return Math.max(1, m ? m.length : 1);
  }
  function fkGrade(text) {
    const sents = splitSentences(text).filter((s) => wordCount(s.text) > 0);
    const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    if (!sents.length || !words.length) return 0;
    const syl = words.reduce((a, w) => a + syllables(w), 0);
    return Math.max(0, 0.39 * (words.length / sents.length) + 11.8 * (syl / words.length) - 15.59);
  }

  /* ---------- colour ---------- */
  function hexToRgb(hex) {
    let h = String(hex).trim().replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase(); }
  function luminance(rgb) {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(a, b) {
    const A = hexToRgb(a), B = hexToRgb(b);
    if (!A || !B) return null;
    const la = luminance(A), lb = luminance(B);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function colourDistance(a, b) { return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2); }
  function nearestPalette(rgb, palette) {
    let best = null;
    for (const p of palette) {
      const prgb = hexToRgb(p.hex); if (!prgb) continue;
      const d = colourDistance(rgb, prgb);
      if (!best || d < best.distance) best = { name: p.name, hex: p.hex, distance: d };
    }
    return best;
  }

  /* ---------- facts ---------- */
  function factStatus(fact, now) {
    now = now || new Date();
    if (fact.validUntil) {
      const end = new Date(fact.validUntil + 'T23:59:59Z');
      const days = Math.ceil((end - now) / 86400000);
      if (end < now) return { state: 'expired', days, until: fact.validUntil };
      if (days <= 30) return { state: 'expiring', days, until: fact.validUntil };
      return { state: 'valid', days, until: fact.validUntil };
    }
    return { state: 'valid', days: null, until: null };
  }
  function matchFact(sentence, facts) {
    const sw = new Set(contentStems(sentence));
    let best = null;
    for (const f of facts) {
      if (f.enabled === false) continue;
      const fw = [...new Set(contentStems(f.text))];
      if (!fw.length) continue;
      const overlap = fw.filter((w) => sw.has(w)).length;
      const score = overlap / fw.length;
      const ok = (overlap >= 2 && score >= 0.5) || (fw.length <= 2 && overlap === fw.length);
      if (ok && (!best || score > best.score || (score === best.score && overlap > best.overlap))) best = { fact: f, score, overlap };
    }
    return best;
  }
  function weakFact(sentence, facts) {
    const sw = new Set(contentStems(sentence));
    let best = null;
    for (const f of facts) {
      if (f.enabled === false) continue;
      const overlap = [...new Set(contentStems(f.text))].filter((w) => sw.has(w)).length;
      if (overlap >= 1 && (!best || overlap > best.overlap)) best = { fact: f, overlap };
    }
    return best;
  }

  /* ---------- meaning check (improvement 2) ---------- */
  function keepChips(sentence, opts) {
    opts = opts || {};
    const drop = new Set((opts.dropNumbers || []).map((x) => x.toLowerCase()));
    const chips = [];
    numbersOf(sentence).forEach((n) => { if (!drop.has(n.raw.toLowerCase())) chips.push(n.raw); });
    const caps = sentence.match(/(?<=[a-z,;:)]\s)[A-Z][a-zA-Z]{2,}/g) || [];
    caps.forEach((c) => { if (!chips.includes(c)) chips.push(c); });
    const content = contentStems(sentence).filter((w) => !CLAIM_TRIGGERS.has(w) && !CLAIM_TRIGGERS.has(w + 's'));
    const seen = new Set(chips.map((c) => stem(c)));
    [...new Set(content)].sort((a, b) => b.length - a.length).slice(0, 3).forEach((w) => {
      if (!seen.has(w) && !/^\d/.test(w)) { chips.push(w); seen.add(w); }
    });
    return chips;
  }
  function meaningCheck(original, rewrite, opts) {
    opts = opts || {};
    const rwStems = new Set(contentStems(rewrite));
    const rwNums = numbersOf(rewrite);
    const missing = [];
    for (const k of (opts.mustKeep || []).map((x) => String(x).trim()).filter(Boolean)) {
      if (/\d/.test(k)) {
        const kn = numbersOf(k)[0];
        const found = kn ? rwNums.some((n) => n.value === kn.value && n.unit === kn.unit) : rewrite.includes(k);
        if (!found) missing.push(k);
      } else {
        const ks = contentStems(k);
        const ok = ks.length ? ks.every((w) => rwStems.has(w)) : rewrite.toLowerCase().includes(k.toLowerCase());
        if (!ok) missing.push(k);
      }
    }
    const added = [];
    const origNums = numbersOf(original);
    const allowed = (opts.allowedNew || []).flatMap((t) => numbersOf(t));
    rwNums.forEach((n) => {
      const inOrig = origNums.some((o) => o.value === n.value && o.unit === n.unit);
      const inAllowed = allowed.some((o) => o.value === n.value && o.unit === n.unit);
      if (!inOrig && !inAllowed) added.push(n.raw);
    });
    const origStems = new Set(contentStems(original));
    const allowStems = new Set((opts.allowedNew || []).flatMap(contentStems));
    rwStems.forEach((w) => {
      if (CLAIM_TRIGGERS.has(w) && !origStems.has(w) && !allowStems.has(w)) added.push(w);
    });
    const os = [...origStems];
    const retained = os.length ? os.filter((w) => rwStems.has(w)).length / os.length : 1;
    return { ok: missing.length === 0 && added.length === 0, missing, added, retained };
  }

  function tidy(s) { return s.replace(/\b([A-Za-z]{3,}) \1\b/gi, '$1').replace(/ {2,}/g, ' ').replace(/ ([,.;:!?])/g, '$1').replace(/\( /g, '('); }
  function applyFix(text, finding, fix) {
    // scope 'sentence' replaces the whole sentence the finding sits in, not just the quoted words
    const a = fix.scope === 'sentence' ? finding.ctxStart : finding.start, b = fix.scope === 'sentence' ? finding.ctxEnd : finding.end;
    return tidy(text.slice(0, a) + fix.replacement + text.slice(b)).replace(/^ +/, '');
  }
  function contextAfter(text, finding, fix) {
    const cs = finding.ctxStart, ce = finding.ctxEnd;
    const before = text.slice(cs, ce);
    const after = fix.scope === 'sentence' ? tidy(fix.replacement) : tidy(text.slice(cs, finding.start) + fix.replacement + text.slice(finding.end, ce));
    return { before, after };
  }
  function evaluateFixes(finding, text, mustKeep) {
    const keep = mustKeep || finding.keep || [];
    const ok = [], blocked = [];
    for (const fx of finding.fixes || []) {
      const { before, after } = contextAfter(text, finding, fx);
      const check = meaningCheck(before, after, { mustKeep: keep, allowedNew: finding.allowedNew || [] });
      const item = Object.assign({}, fx, { before, after, check });
      (check.ok ? ok : blocked).push(item);
    }
    return { ok, blocked };
  }

  /* ---------- helpers for building findings ---------- */
  function matchCase(found, repl) {
    if (!repl) return repl;
    if (found === found.toUpperCase() && found.length > 1) return repl.toUpperCase();
    if (found[0] === found[0].toUpperCase()) return repl[0].toUpperCase() + repl.slice(1);
    return repl;
  }
  function splitLong(sentence) {
    const mid = sentence.length / 2;
    const cands = [];
    const re = /(, and |, but |; |, so )/g;
    let m;
    while ((m = re.exec(sentence))) cands.push({ i: m.index, len: m[0].length, kind: m[0] });
    if (!cands.length) return null;
    cands.sort((a, b) => Math.abs(a.i - mid) - Math.abs(b.i - mid));
    const c = cands[0];
    const left = sentence.slice(0, c.i).replace(/[.!?]+$/, '');
    let right = sentence.slice(c.i + c.len);
    const joiner = c.kind.trim().replace(/^[,;]\s*/, '');
    if (joiner === 'but' || joiner === 'so') right = joiner[0].toUpperCase() + joiner.slice(1) + ', ' + right;
    else right = right[0].toUpperCase() + right.slice(1);
    return left + '. ' + right;
  }
  const SOFTEN = [
    [/clinically proven to reduce/i, 'made to help with'], [/clinically proven to/i, 'made to'], [/clinically proven/i, 'formulated'],
    [/guarantees?/i, 'aims to deliver'], [/\bcures?\b/i, 'may help with'], [/\bprevents?\b/i, 'may help limit'], [/\bthe best\b/i, 'a great'],
  ];
  function soften(sentence) {
    let out = sentence;
    for (const [re, rep] of SOFTEN) if (re.test(out)) { out = out.replace(re, (m) => matchCase(m, rep)); break; }
    return out === sentence ? null : out;
  }

  function sourceLabel(sources, id) {
    for (const k of ['rules', 'terms', 'facts']) {
      const it = (sources[k] || []).find((x) => x.id === id);
      if (it) return (it.source || sources.name || 'Source library') + ' · ' + it.id;
    }
    return id;
  }

  /* ---------- main review ---------- */
  function reviewText(text, sources, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const rules = {};
    (sources.rules || []).forEach((r) => { rules[r.id] = r; });
    const on = (id) => rules[id] && rules[id].enabled !== false;
    const sents = splitSentences(text);
    const findings = [];
    const verified = [];
    const add = (f) => {
      const s = sentenceAt(sents, Math.max(0, f.start >= 0 ? f.start : 0));
      f.ctxStart = f.ctxStart !== undefined ? f.ctxStart : (s ? s.start : f.start);
      f.ctxEnd = f.ctxEnd !== undefined ? f.ctxEnd : (s ? s.end : f.end);
      f.key = f.ruleId + '|' + (f.quote || '').toLowerCase();
      f.id = 'F' + (findings.length + 1);
      f.status = 'open';
      f.origin = f.origin || 'rule';
      f.confidence = f.confidence !== undefined ? f.confidence : 1;
      f.sourceLabel = sourceLabel(sources, f.sourceId || f.ruleId);
      f.fixes = (f.fixes || []).map((fx, i) => Object.assign({ id: f.id + '-' + (i + 1) }, fx));
      if (f.start >= 0 && f.keep === undefined) {
        f.keep = keepChips(text.slice(f.ctxStart, f.ctxEnd), { dropNumbers: f.dropNumbers });
        if (f.category !== 'claim' && f.end - f.start < f.ctxEnd - f.ctxStart) {
          // A word-level fix is meant to change the quoted words, so they are not part of the meaning to preserve.
          const q = new Set(contentStems(f.quote)), ql = f.quote.toLowerCase();
          f.keep = f.keep.filter((c) => { const cs = contentStems(c); return !(ql.includes(c.toLowerCase()) || (cs.length && cs.every((w) => q.has(w)))); });
        }
      }
      findings.push(f);
    };

    /* terminology */
    for (const t of sources.terms || []) {
      if (t.enabled === false) continue;
      const re = new RegExp('(?<![A-Za-z])' + escapeRe(t.avoid) + '(?![A-Za-z])', 'gi');
      let m;
      while ((m = re.exec(text))) {
        const repl = t.prefer ? matchCase(m[0], t.prefer) : '';
        add({
          ruleId: t.id, sourceId: t.id, category: 'terminology', severity: t.severity || 'medium',
          start: m.index, end: m.index + m[0].length, quote: m[0],
          title: t.prefer ? 'Use "' + t.prefer + '" instead of "' + m[0] + '"' : 'Avoid "' + m[0] + '"',
          explanation: t.reason, fixes: [{ label: t.prefer ? 'Change to "' + repl + '"' : 'Remove "' + m[0] + '"', replacement: repl }],
        });
      }
    }

    /* tone */
    if (on('R-TONE-EXCL')) {
      const max = (rules['R-TONE-EXCL'].params || {}).max ?? 1;
      let count = 0, m; const re = /!+(?!\[)/g;
      while ((m = re.exec(text))) {
        count++;
        if (count > max) add({
          ruleId: 'R-TONE-EXCL', category: 'tone', severity: 'low', start: m.index, end: m.index + m[0].length, quote: m[0],
          title: 'Too many exclamation marks', explanation: rules['R-TONE-EXCL'].text,
          fixes: [{ label: 'End the sentence with a full stop', replacement: '.' }],
        });
      }
    }
    if (on('R-TONE-HYPE')) {
      for (const h of (rules['R-TONE-HYPE'].params || {}).words || []) {
        const re = new RegExp('(?<![A-Za-z])' + escapeRe(h.word) + '(?![A-Za-z])\\s?', 'gi');
        let m;
        while ((m = re.exec(text))) {
          const found = m[0].trimEnd();
          add({
            ruleId: 'R-TONE-HYPE', category: 'tone', severity: 'medium', start: m.index, end: m.index + found.length, quote: found,
            title: '"' + found + '" sounds like hype', explanation: h.why || rules['R-TONE-HYPE'].text,
            fixes: [{ label: h.alt ? 'Change to "' + h.alt + '"' : 'Remove "' + found + '"', replacement: h.alt ? matchCase(found, h.alt) : '' }],
          });
        }
      }
    }
    if (on('R-TONE-CAPS')) {
      const allow = new Set(((rules['R-TONE-CAPS'].params || {}).allow || []).map((x) => x.toUpperCase()));
      const re = /\b[A-Z]{4,}\b/g; let m;
      while ((m = re.exec(text))) {
        if (allow.has(m[0])) continue;
        add({
          ruleId: 'R-TONE-CAPS', category: 'tone', severity: 'low', start: m.index, end: m.index + m[0].length, quote: m[0],
          title: 'Shouting in capitals', explanation: rules['R-TONE-CAPS'].text,
          fixes: [{ label: 'Use normal case: "' + m[0][0] + m[0].slice(1).toLowerCase() + '"', replacement: m[0][0] + m[0].slice(1).toLowerCase() }],
        });
      }
    }

    /* readability */
    if (on('R-READ-LEN')) {
      const max = (rules['R-READ-LEN'].params || {}).maxWords || 28;
      for (const s of sents) {
        const wc = wordCount(s.text);
        if (wc > max) {
          const sp = splitLong(s.text);
          add({
            ruleId: 'R-READ-LEN', category: 'readability', severity: 'low', start: s.start, end: s.end, quote: s.text,
            title: 'Sentence has ' + wc + ' words (limit ' + max + ')', explanation: rules['R-READ-LEN'].text,
            fixes: sp ? [{ label: 'Split into two sentences', replacement: sp }] : [],
          });
        }
      }
    }
    const grade = fkGrade(text);
    if (on('R-READ-GRADE') && wordCount(text) >= 40 && grade > ((rules['R-READ-GRADE'].params || {}).maxGrade || 10)) {
      add({
        ruleId: 'R-READ-GRADE', category: 'readability', severity: 'low', start: -1, end: -1, quote: '',
        title: 'Reading level is grade ' + grade.toFixed(1), explanation: rules['R-READ-GRADE'].text, fixes: [],
      });
    }

    /* accessibility in text */
    if (on('R-A11Y-ALT')) {
      let m; const md = /!\[\s*\]\([^)]*\)/g;
      while ((m = md.exec(text))) add({ ruleId: 'R-A11Y-ALT', category: 'accessibility', severity: 'high', start: m.index, end: m.index + m[0].length, quote: m[0], title: 'Image has no alt text', explanation: rules['R-A11Y-ALT'].text, fixes: [], keep: [] });
      const html = /<img\b(?![^>]*\balt\s*=\s*"[^"]+")[^>]*>/gi;
      while ((m = html.exec(text))) add({ ruleId: 'R-A11Y-ALT', category: 'accessibility', severity: 'high', start: m.index, end: m.index + m[0].length, quote: m[0], title: 'Image has no alt text', explanation: rules['R-A11Y-ALT'].text, fixes: [], keep: [] });
    }
    if (on('R-A11Y-LINK')) {
      const re = /\[(click here|here|read more|link)\]\([^)]*\)|\bclick here\b/gi; let m;
      while ((m = re.exec(text))) add({ ruleId: 'R-A11Y-LINK', category: 'accessibility', severity: 'low', start: m.index, end: m.index + m[0].length, quote: m[0], title: 'Link text does not say where it goes', explanation: rules['R-A11Y-LINK'].text, fixes: [], keep: [] });
    }

    /* claims against approved facts (improvement 1 lives here) */
    const facts = (sources.facts || []).filter((f) => f.enabled !== false);
    if (on('R-CONF-1')) {
      for (const term of sources.confidential || []) {
        if (!term.trim()) continue;
        const re = new RegExp('(?<![A-Za-z])' + escapeRe(term.trim()) + '(?![A-Za-z])', 'gi'); let m;
        while ((m = re.exec(text))) add({
          ruleId: 'R-CONF-1', category: 'confidentiality', severity: 'high', start: m.index, end: m.index + m[0].length, quote: m[0],
          title: '"' + m[0] + '" is a confidential name', explanation: rules['R-CONF-1'].text,
          needsSpecialist: true, fixes: [{ label: 'Remove "' + m[0] + '"', replacement: '' }, { label: 'Remove this sentence', replacement: '', scope: 'sentence' }],
        });
      }
    }
    const units = [];
    for (const s of sents) {
      const re = /,\s+and\s+|;\s+|,\s+but\s+/g; let last = 0, m;
      const parts = [];
      while ((m = re.exec(s.text))) { parts.push([last, m.index]); last = m.index + m[0].length; }
      parts.push([last, s.text.length]);
      for (const [a, b] of parts) units.push({ start: s.start + a, end: s.start + b, text: s.text.slice(a, b) });
    }
    if (on('R-CLAIM-1')) {
      for (const s of units) {
        if (!CLAIM_RE.test(s.text)) continue;
        const m = matchFact(s.text, facts);
        const regulated = REGULATED_RE.test(s.text);
        if (!m) {
          const weak = weakFact(s.text, facts);
          const fixes = [];
          const soft = soften(s.text);
          if (soft) fixes.push({ label: 'Soften the wording (still needs legal review)', replacement: soft });
          if (weak) fixes.push({ label: 'Use approved wording: "' + weak.fact.text + '"', replacement: weak.fact.text.replace(/[.]*$/, '.') });
          fixes.push({ label: 'Remove this claim', replacement: '' });
          add({
            ruleId: regulated ? 'R-CLAIM-REG' : 'R-CLAIM-1', sourceId: regulated && on('R-CLAIM-REG') ? 'R-CLAIM-REG' : 'R-CLAIM-1',
            category: 'claim', severity: regulated ? 'high' : 'medium', start: s.start, end: s.end, quote: s.text,
            title: 'Unverified claim: no approved fact supports this',
            explanation: 'No approved fact in the library backs this statement. ' + (regulated ? 'It sounds like a health or scientific claim, so it needs legal sign-off with evidence. ' : '') + 'Add evidence to the fact library, reword it, or send it for human review.',
            unverified: true, needsSpecialist: true, fixes, confidence: 0.9,
          });
          continue;
        }
        const f = m.fact, st = factStatus(f, now);
        const fnums = numbersOf(f.text);
        const conflicts = numbersOf(s.text).filter((n) => fnums.some((x) => x.unit === n.unit && x.unit !== '' && x.value !== n.value));
        if (conflicts.length) {
          const c = conflicts[0];
          const fn = fnums.find((x) => x.unit === c.unit);
          add({
            ruleId: 'R-CLAIM-1', sourceId: f.id, category: 'claim', severity: 'high', start: s.start + c.index, end: s.start + c.end, quote: c.raw,
            ctxStart: s.start, ctxEnd: s.end, dropNumbers: [c.raw],
            title: 'Says ' + c.raw + ', approved fact says ' + fn.raw, explanation: 'Approved fact ' + f.id + ': "' + f.text + '". The draft number does not match.',
            needsSpecialist: true, allowedNew: [fn.raw], fixes: [{ label: 'Change to "' + fn.raw + '"', replacement: fn.raw }], confidence: 0.95, factId: f.id,
          });
        } else if (st.state === 'expired') {
          const alt = facts.find((x) => x.id !== f.id && x.replaces === f.id && factStatus(x, now).state !== 'expired');
          add({
            ruleId: 'R-FACT-EXPIRED', sourceId: f.id, category: 'claim', severity: 'high', start: s.start, end: s.end, quote: s.text,
            title: 'Outdated: approved fact expired on ' + st.until,
            explanation: 'This statement matches "' + f.text + '", which was only valid until ' + st.until + '. Ask the brand manager to renew the fact, or remove the claim.',
            needsSpecialist: true, factId: f.id, confidence: 0.95, keep: [],
            fixes: alt ? [{ label: 'Use current fact: "' + alt.text + '"', replacement: alt.text.replace(/[.]*$/, '.') }] : [],
          });
        } else if (st.state === 'expiring') {
          add({
            ruleId: 'R-FACT-EXPIRING', sourceId: f.id, category: 'claim', severity: 'low', start: s.start, end: s.end, quote: s.text,
            title: 'Fact expires in ' + st.days + ' day' + (st.days === 1 ? '' : 's'),
            explanation: 'This statement relies on "' + f.text + '", valid until ' + st.until + '. Check the publish date is before then.',
            factId: f.id, confidence: 0.95, fixes: [],
          });
        } else {
          verified.push({ sentence: s.text, factId: f.id, factText: f.text, until: st.until });
        }
      }
    }

    findings.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.start - b.start);
    findings.forEach((f, i) => { f.id = 'F' + (i + 1); f.fixes.forEach((fx, j) => { fx.id = f.id + '-' + (j + 1); }); });
    return { findings, verified, stats: { sentences: sents.length, words: wordCount(text), grade } };
  }

  /* ---------- image / visual checks ---------- */
  function checkVisual(input, sources) {
    const rules = {}; (sources.rules || []).forEach((r) => { rules[r.id] = r; });
    const on = (id) => rules[id] && rules[id].enabled !== false;
    const out = []; let n = 0;
    const push = (f) => { f.id = 'V' + (++n); f.status = 'open'; f.origin = 'rule'; f.confidence = 1; f.start = -1; f.end = -1; f.fixes = []; f.sourceLabel = sourceLabel(sources, f.ruleId); out.push(f); };
    if (on('R-A11Y-ALT') && !(input.alt || '').trim()) push({ ruleId: 'R-A11Y-ALT', category: 'accessibility', severity: 'high', quote: '', title: 'Image has no alt text', explanation: rules['R-A11Y-ALT'].text });
    if (input.fg && input.bg && on('R-A11Y-CONTRAST')) {
      const r = contrastRatio(input.fg, input.bg);
      const min = (rules['R-A11Y-CONTRAST'].params || {}).min || 4.5;
      if (r !== null && r < min) push({ ruleId: 'R-A11Y-CONTRAST', category: 'accessibility', severity: 'high', quote: '', title: 'Text contrast is ' + r.toFixed(2) + ':1 (needs ' + min + ':1)', explanation: rules['R-A11Y-CONTRAST'].text });
    }
    if (on('R-VIS-PALETTE')) {
      const tol = (rules['R-VIS-PALETTE'].params || {}).tolerance || 60;
      (input.dominant || []).filter((d) => d.share >= 0.1).forEach((d) => {
        const rgb = hexToRgb(d.hex); if (!rgb) return;
        const np = nearestPalette(rgb, sources.palette || []);
        if (np && np.distance > tol) push({ ruleId: 'R-VIS-PALETTE', category: 'visual', severity: 'medium', quote: d.hex, title: Math.round(d.share * 100) + '% of the image is ' + d.hex + ', which is not a brand colour', explanation: rules['R-VIS-PALETTE'].text + ' Closest brand colour: ' + np.name + ' ' + np.hex + '.' });
      });
    }
    if (input.isLogo && on('R-VIS-LOGO')) {
      const min = (rules['R-VIS-LOGO'].params || {}).minWidth || 120;
      if (input.width && input.width < min) push({ ruleId: 'R-VIS-LOGO', category: 'visual', severity: 'medium', quote: '', title: 'Logo is ' + input.width + 'px wide (minimum ' + min + 'px)', explanation: rules['R-VIS-LOGO'].text });
    }
    return out;
  }

  /* ---------- privacy: redaction and retrieval ---------- */
  function redact(text, confidential) {
    let out = text; const log = {};
    const bump = (k, c) => { if (c) log[k] = (log[k] || 0) + c; };
    for (const term of confidential || []) {
      if (!term.trim()) continue;
      const re = new RegExp(escapeRe(term.trim()), 'gi');
      out = out.replace(re, () => { bump('confidential term', 1); return '[CONFIDENTIAL]'; });
    }
    out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, () => { bump('email', 1); return '[EMAIL]'; });
    out = out.replace(/(?<![\w$])\+?\d[\d\s-]{8,}\d(?!\w)/g, (m) => { if (/[.]/.test(m) || /^\d{4}-\d{2}-\d{2}$/.test(m.trim())) return m; bump('phone', 1); return '[PHONE]'; });
    return { text: out, redactions: Object.entries(log).map(([kind, count]) => ({ kind, count })) };
  }
  function retrieve(segment, sources, k) {
    const sw = new Set(contentStems(segment));
    const items = [];
    (sources.rules || []).filter((r) => r.enabled !== false).forEach((r) => items.push({ id: r.id, type: 'rule', text: r.title + '. ' + r.text }));
    (sources.terms || []).filter((t) => t.enabled !== false).forEach((t) => items.push({ id: t.id, type: 'term', text: 'Avoid "' + t.avoid + '"' + (t.prefer ? ', prefer "' + t.prefer + '"' : '') + '. ' + t.reason }));
    (sources.facts || []).filter((f) => f.enabled !== false).forEach((f) => items.push({ id: f.id, type: 'fact', text: f.text }));
    (sources.guidelines || []).forEach((g) => items.push({ id: g.id, type: 'guideline', text: g.text }));
    return items.map((it) => ({ it, s: contentStems(it.text).filter((w) => sw.has(w)).length + (it.type === 'guideline' ? 0.5 : 0) }))
      .sort((a, b) => b.s - a.s).slice(0, k || 6).map((x) => x.it);
  }

  /* ---------- evaluation on a labelled set ---------- */
  function evaluateSet(cases, sources, opts) {
    let planted = 0, caught = 0, flagged = 0, tp = 0; const misses = [], falsePos = [];
    for (const c of cases) {
      const res = reviewText(c.text, sources, opts);
      const used = new Set();
      for (const p of c.planted || []) {
        planted++;
        const hit = res.findings.findIndex((f, i) => !used.has(i) && f.ruleId === p.ruleId && (f.quote + ' ' + text_ctx(c.text, f)).toLowerCase().includes(p.contains.toLowerCase()));
        if (hit >= 0) { caught++; used.add(hit); } else misses.push({ case: c.id, ruleId: p.ruleId, contains: p.contains });
      }
      res.findings.forEach((f, i) => {
        if (['R-READ-GRADE', 'R-FACT-EXPIRING'].includes(f.ruleId) && !(c.planted || []).some((p) => p.ruleId === f.ruleId)) return;
        flagged++;
        if (used.has(i)) tp++; else falsePos.push({ case: c.id, ruleId: f.ruleId, quote: f.quote });
      });
    }
    return { planted, caught, recall: planted ? caught / planted : 1, flagged, precision: flagged ? tp / flagged : 1, misses, falsePos, cases: cases.length };
  }
  function text_ctx(text, f) { return f.start >= 0 ? text.slice(f.ctxStart, f.ctxEnd) : ''; }

  return {
    splitSentences, numbersOf, contentStems, keepChips, meaningCheck, evaluateFixes, applyFix, reviewText, checkVisual, redact, retrieve, evaluateSet,
    factStatus, matchFact, fkGrade, syllables, contrastRatio, hexToRgb, rgbToHex, nearestPalette, sourceLabel, wordCount, CLAIM_RE, REGULATED_RE, tidy,
  };
});