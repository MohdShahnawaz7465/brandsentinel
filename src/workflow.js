/* Roles, routing and insights. Pure logic, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BSWorkflow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const STATUS = {
    draft: 'Draft', awaiting_specialist: 'Waiting for Legal', awaiting_manager: 'Waiting for Brand manager',
    changes_requested: 'Changes requested', approved: 'Approved',
  };
  const PERMS = {
    writer: ['create', 'submit', 'revise', 'comment'],
    brand_manager: ['approve', 'request_changes', 'edit_sources', 'edit_facts', 'comment'],
    legal: ['signoff', 'request_changes', 'edit_facts', 'comment'],
    admin: ['settings', 'edit_sources', 'edit_facts', 'comment'],
  };
  function can(role, action) { return (PERMS[role] || []).includes(action); }

  function openCount(findings) { return findings.filter((f) => f.status === 'open').length; }
  function needsSpecialist(findings) {
    return findings.some((f) => f.status !== 'fixed' && f.needsSpecialist);
  }
  function validateSubmit(sub, findings) {
    if (!(findings || []).length && !sub.versions.length) return { ok: false, reason: 'Run a check first.' };
    const open = openCount(findings);
    if (open) return { ok: false, reason: open + ' finding' + (open === 1 ? ' is' : 's are') + ' still open. Apply a fix, edit the text, or dispute it with a reason.' };
    const bad = findings.find((f) => f.status === 'disputed' && !(f.reason || '').trim());
    if (bad) return { ok: false, reason: 'A disputed finding needs a reason.' };
    return { ok: true, route: needsSpecialist(findings) || sub.needsLegal ? 'awaiting_specialist' : 'awaiting_manager' };
  }
  function transition(sub, role, action) {
    const s = sub.status;
    if (action === 'signoff') {
      if (!can(role, 'signoff')) return { ok: false, reason: 'Only a Legal reviewer can sign off.' };
      if (s !== 'awaiting_specialist') return { ok: false, reason: 'Nothing is waiting for Legal.' };
      return { ok: true, to: 'awaiting_manager' };
    }
    if (action === 'approve') {
      if (!can(role, 'approve')) return { ok: false, reason: 'Only a Brand manager can approve.' };
      if (s === 'awaiting_specialist') return { ok: false, reason: 'Legal must sign off first.' };
      if (s !== 'awaiting_manager') return { ok: false, reason: 'This piece is not waiting for approval.' };
      return { ok: true, to: 'approved' };
    }
    if (action === 'request_changes') {
      if (!can(role, 'request_changes')) return { ok: false, reason: 'Your role cannot request changes.' };
      if (!['awaiting_specialist', 'awaiting_manager'].includes(s)) return { ok: false, reason: 'This piece is not in review.' };
      return { ok: true, to: 'changes_requested' };
    }
    return { ok: false, reason: 'Unknown action.' };
  }

  function insights(subs, ruleTitle) {
    ruleTitle = ruleTitle || ((id) => id);
    const first = {}, disputed = {}, byAuthor = {};
    let clear = 0, unclear = 0;
    subs.forEach((s) => {
      const ruleSet = new Set();
      (s.firstCheck || []).forEach((f) => { first[f.ruleId] = (first[f.ruleId] || 0) + 1; ruleSet.add(f.ruleId); });
      ruleSet.forEach((r) => { byAuthor[s.author] = byAuthor[s.author] || {}; byAuthor[s.author][r] = (byAuthor[s.author][r] || 0) + 1; });
      (s.final || []).forEach((f) => { if (f.status === 'disputed') { disputed[f.ruleId] = disputed[f.ruleId] || { n: 0, reasons: [] }; disputed[f.ruleId].n++; if (f.reason) disputed[f.ruleId].reasons.push(f.reason); } });
      (s.feedback || []).forEach((f) => { f.clear ? clear++ : unclear++; });
    });
    const topRules = Object.entries(first).map(([ruleId, count]) => ({ ruleId, title: ruleTitle(ruleId), count })).sort((a, b) => b.count - a.count);
    const disputes = Object.entries(first).map(([ruleId, total]) => {
      const d = disputed[ruleId] || { n: 0, reasons: [] };
      return { ruleId, title: ruleTitle(ruleId), total, disputed: d.n, rate: d.n / total, reasons: [...new Set(d.reasons)] };
    }).filter((x) => x.disputed > 0).sort((a, b) => b.rate - a.rate || b.disputed - a.disputed);
    const unclearRules = disputes.filter((d) => d.rate >= 0.5 && d.total >= 2);
    const repeats = [];
    Object.entries(byAuthor).forEach(([author, m]) => Object.entries(m).forEach(([ruleId, n]) => { if (n >= 2) repeats.push({ author, ruleId, title: ruleTitle(ruleId), count: n }); }));
    repeats.sort((a, b) => b.count - a.count);
    const total = clear + unclear;
    return {
      topRules, disputes, unclearRules, repeats,
      clarity: { clear, unclear, total, pct: total ? Math.round((100 * clear) / total) : null },
      totals: { submissions: subs.length, approved: subs.filter((s) => s.status === 'approved').length },
    };
  }
  function diffWords(a, b) {
    const A = a.split(/(\s+)/).filter(Boolean), B = b.split(/(\s+)/).filter(Boolean);
    const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0;
    const push = (t, type) => { const last = out[out.length - 1]; if (last && last.type === type) last.t += t; else out.push({ t, type }); };
    while (i < n && j < m) {
      if (A[i] === B[j]) { push(A[i], 'same'); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) push(A[i++], 'del'); else push(B[j++], 'add');
    }
    while (i < n) push(A[i++], 'del'); while (j < m) push(B[j++], 'add');
    return out;
  }
  return { diffWords, STATUS, can, validateSubmit, transition, insights, openCount, needsSpecialist };
});
