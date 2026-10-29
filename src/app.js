/* BrandSentinel app shell. State lives in the browser (localStorage). Engine, AI adapter and workflow logic are separate, tested modules. */
(function () {
  'use strict';
  const E = window.BSEngine, D = window.BSData, A = window.BSAI, W = window.BSWorkflow, F = window.BSFiles;
  const KEY = 'brandsentinel.v1';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (iso) => { try { return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; } };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const CAT = { terminology: 'Terminology', tone: 'Tone', claim: 'Claim', readability: 'Readability', accessibility: 'Accessibility', visual: 'Visual', confidentiality: 'Confidentiality', messaging: 'Messaging' };

  /* ---------- state ---------- */
  const blankWork = () => ({ subId: null, title: '', text: '', mode: 'text', alt: '', isLogo: false, useContrast: false, fg: '#767676', bg: '#FFFFFF', imageInfo: null, imageUrl: '', findings: [], verified: [], ai: [], receipt: null, checked: false, editing: true, stats: null, pageMap: null, pageText: '', sourceNote: '' });
  let state = load();
  const API_URL = (typeof window !== 'undefined' && window.BS_API_URL) || 'http://127.0.0.1:8000';
  let aiTools = { sample: null, server: null, checked: false };
  let busy = '';

  /* ---------- server login (demo accounts, no passwords) ----------
     The token lives in sessionStorage only (never localStorage, never in a URL). Without BS_API_URL, or when the
     server cannot be reached, the app keeps working from this browser exactly as before. */
  const SERVER_ON = !!(typeof window !== 'undefined' && window.BS_API_URL);
  const AUTH_KEY = 'brandsentinel.auth';
  let auth = { token: '', user: null, workspace: null, connecting: false };
  try { const a = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null'); if (a && a.token && a.user) auth = { token: a.token, user: a.user, workspace: a.workspace || null, connecting: false }; } catch (e) { /* no session storage: stay logged out */ }
  const signedIn = () => !!(SERVER_ON && auth.token && auth.user);
  /* First screen: when the server is connected and nobody is signed in, show the sign-in screen before the app. */
  let entered = false; try { entered = sessionStorage.getItem('brandsentinel.entered') === '1'; } catch (e) { /* ignore */ }
  const gateOn = () => SERVER_ON && !signedIn() && !entered;
  const setEntered = (v) => { entered = v; try { if (v) sessionStorage.setItem('brandsentinel.entered', '1'); else sessionStorage.removeItem('brandsentinel.entered'); } catch (e) { /* ignore */ } };
  if (signedIn()) state.userId = auth.user.id;
  async function api(path, opts) {
    const o = opts || {}, ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), o.timeout || 8000);
    try {
      const headers = { 'Content-Type': 'application/json' }; if (auth.token) headers.Authorization = 'Bearer ' + auth.token;
      const res = await fetch(API_URL + path, { method: o.method || 'GET', signal: ctl.signal, headers, body: o.body ? JSON.stringify(o.body) : undefined });
      let j = null; try { j = await res.json(); } catch (e) { /* not JSON */ }
      if (res.status === 401 && auth.token) logout(true);
      if (!res.ok) { const err = new Error((j && j.detail) || ('Server answered ' + res.status)); err.status = res.status; throw err; }
      return j;
    } finally { clearTimeout(timer); }
  }
  async function demoLogin(roleName) {
    if (auth.connecting) return;
    auth.connecting = true; render();
    try {
      const j = await api('/api/auth/demo', { method: 'POST', body: { role: roleName }, timeout: 25000 });
      applySession(j); await loadServerSubs(true); save(); toast('Signed in as ' + j.user.name + '.');
    } catch (e) {
      auth.connecting = false;
      toast(e.name === 'AbortError' ? 'The server is waking up (the first time takes a few seconds). Press the button again, or keep working in this browser only.' : 'Could not sign in (' + (e.message || 'server not reachable') + '). You can keep working in this browser only.');
    }
    render();
  }
  function persistAuth() { try { sessionStorage.setItem(AUTH_KEY, JSON.stringify({ token: auth.token, user: auth.user, workspace: auth.workspace })); } catch (e) { /* ignore */ } }
  function applySession(j) {
    auth = { token: j.token, user: j.user, workspace: j.workspace || null, connecting: false };
    persistAuth(); state.userId = j.user.id; state.ui = {};
  }
  /* ---------- real accounts and private workspaces (Round 3) ---------- */
  let wsInfo = null, accountBusy = false;
  const fval = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  async function loadWorkspace() {
    try {
      wsInfo = await api('/api/workspace');
      if (auth.workspace) { auth.workspace = { id: wsInfo.id, name: wsInfo.name, aiEnabled: wsInfo.aiEnabled, isDemo: wsInfo.isDemo }; persistAuth(); }
    } catch (e) { wsInfo = null; if (e.status && e.status !== 401) toast(e.message); }
  }
  async function setWsAi(on) {
    try {
      const w = await api('/api/workspace/settings', { method: 'PUT', body: { ai_enabled: on } });
      auth.workspace = w; persistAuth(); if (wsInfo) wsInfo.aiEnabled = w.aiEnabled;
      toast(on ? 'The AI step is on for this workspace.' : 'The AI step is off for this workspace. Only the fixed checks run.');
    } catch (e) { toast(e.message || 'Could not change the setting.'); }
    render();
  }
  async function handleAccountForm(kind) {
    if (accountBusy) return;
    const v = kind === 'login' ? { email: fval('li-email').trim(), password: fval('li-pw') }
      : kind === 'signup' ? { workspace_name: fval('su-ws').trim(), name: fval('su-name').trim(), email: fval('su-email').trim(), password: fval('su-pw') }
        : { name: fval('mb-name').trim(), email: fval('mb-email').trim(), role: fval('mb-role'), password: fval('mb-pw') };
    if (kind === 'login' || kind === 'signup') gateVals = Object.assign({}, v, { password: '' }); // keep what was typed if the server says no
    accountBusy = true; render();
    try {
      if (kind === 'member') {
        await api('/api/workspace/members', { method: 'POST', body: v });
        await loadWorkspace(); toast('Added ' + v.name + '. They can log in with that email and password.');
      } else {
        const j = await api(kind === 'login' ? '/api/auth/login' : '/api/auth/signup', { method: 'POST', body: v, timeout: 25000 });
        applySession(j); await loadServerSubs(true); state.view = 'review'; save();
        toast(kind === 'signup' ? 'Workspace created. You are its admin. Add your team in the Account tab.' : 'Signed in as ' + j.user.name + '.');
      }
    } catch (e) {
      toast(e.name === 'AbortError' ? 'The server is waking up. Wait a few seconds and press the button again.' : (e.message || 'Something went wrong.'));
    }
    accountBusy = false; render();
  }
  const ROLE_OPTS = [['writer', 'Writer'], ['legal', 'Legal reviewer'], ['brand_manager', 'Brand manager'], ['admin', 'Admin']];
  function workspaceNotice() {
    const w = auth.workspace;
    if (w && !w.isDemo) return '<div class="notice"><b>Private workspace: ' + esc(w.name) + '.</b> Only people in this workspace can see these drafts.</div>';
    return '<div class="notice warn"><b>Demo data is shared.</b> Everything saved while you are signed in to the demo can be seen by everyone who uses it. Do not enter real private text. To work privately, create your own workspace in the Account tab.</div>';
  }
  function accountView() {
    if (!SERVER_ON) return '<div class="stack"><h2>Account</h2><p>Sign-in is not connected in this copy of BrandSentinel. Everything runs in this browser.</p></div>';
    const dis = accountBusy ? ' disabled' : '';
    if (!signedIn()) {
      return '<div class="stack"><h2>Account</h2><div class="grid2">'
        + '<div class="card stack"><h3>Log in</h3><p class="small muted">Use the email and password of an account in a workspace. To just look around, use the Demo login buttons at the top.</p>'
        + '<form data-form="login" class="stack"><label class="f2">Email<input type="email" id="li-email" autocomplete="username" required></label><label class="f2">Password<input type="password" id="li-pw" autocomplete="current-password" required></label><div class="row"><button class="btn primary" type="submit"' + dis + '>' + (accountBusy ? 'Please wait…' : 'Log in') + '</button></div></form></div>'
        + '<div class="card stack"><h3>Create a private workspace</h3><p class="small muted">You become its admin, and only people you add can see its drafts. Passwords are stored only as salted hashes.</p>'
        + '<form data-form="signup" class="stack"><label class="f2">Workspace name<input type="text" id="su-ws" maxlength="80" required></label><label class="f2">Your name<input type="text" id="su-name" maxlength="80" autocomplete="name" required></label><label class="f2">Email<input type="email" id="su-email" autocomplete="username" required></label><label class="f2">Password <span class="hint">at least 8 characters</span><input type="password" id="su-pw" minlength="8" autocomplete="new-password" required></label><div class="row"><button class="btn primary" type="submit"' + dis + '>' + (accountBusy ? 'Please wait…' : 'Create workspace') + '</button></div></form></div></div></div>';
    }
    const w = auth.workspace || { name: 'Demo workspace', isDemo: true, aiEnabled: true };
    let h = '<div class="stack"><h2>Account</h2><div class="card stack"><h3>' + esc(auth.user.name) + '</h3><p class="small">' + D.roleNames[auth.user.role] + ' in <b>' + esc(w.name) + '</b>. ' + (w.isDemo ? 'This is the shared demo workspace, so everyone who uses the demo sees the same drafts. To use BrandSentinel with a team, log out and create your own private workspace.' : 'Only people in this workspace can see its drafts.') + '</p></div>';
    if (!w.isDemo && auth.user.role === 'admin') {
      h += '<div class="card stack"><h3>Workspace settings</h3><label class="row"><input type="checkbox" id="wsai" data-bind="wsai"' + (w.aiEnabled ? ' checked' : '') + '> Let the AI step judge sentences the fixed rules cannot. When it is off, only the fixed checks run for everyone in this workspace.</label></div>';
      const members = wsInfo && wsInfo.members ? wsInfo.members : [];
      h += '<div class="card stack"><h3>People</h3>' + (members.length ? '<div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>' + members.map((m) => '<tr><td>' + esc(m.name) + '</td><td class="small">' + esc(m.email) + '</td><td>' + (D.roleNames[m.role] || esc(m.role)) + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="small muted">Loading…</p>')
        + '<p class="small muted">To try the full flow (Writer, then Legal, then Brand manager), add one person for each role and log in as each of them.</p>'
        + '<form data-form="member" class="stack"><div class="grid2"><label class="f2">Name<input type="text" id="mb-name" maxlength="80" required></label><label class="f2">Email<input type="email" id="mb-email" required></label><label class="f2">Role<select id="mb-role">' + ROLE_OPTS.map((r) => '<option value="' + r[0] + '">' + r[1] + '</option>').join('') + '</select></label><label class="f2">Password <span class="hint">at least 8 characters</span><input type="password" id="mb-pw" minlength="8" autocomplete="new-password" required></label></div><div class="row"><button class="btn primary" type="submit"' + dis + '>Add person</button></div></form></div>';
    } else if (!w.isDemo) h += '<p class="small muted">Ask your workspace admin to add people or change settings.</p>';
    return h + '</div>';
  }
  let gateTab = 'login', gateVals = {};
  const SHIELD = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3l11 4v8c0 7-4.5 12-11 14C9.500 27 5 22 5 15V7z" fill="var(--ink)"/><path d="M11 16l4 4 7-8" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function gateHtml() {
    const dis = (auth.connecting || accountBusy) ? ' disabled' : '';
    const busyLabel = (t) => (accountBusy ? 'Please wait…' : t);
    const signup = gateTab === 'signup';
    const roles = [['writer', 'Writer'], ['legal', 'Legal'], ['brand_manager', 'Brand manager']];
    const val = (k) => ' value="' + esc(gateVals[k] || '') + '"';
    const form = signup
      ? '<form data-form="signup" class="auth-form">'
        + '<label class="f2">Workspace name<input type="text" id="su-ws" maxlength="80" placeholder="e.g. Tidewell Marketing" required' + val('workspace_name') + '></label>'
        + '<label class="f2">Your name<input type="text" id="su-name" maxlength="80" autocomplete="name" required' + val('name') + '></label>'
        + '<label class="f2">Work email<input type="email" id="su-email" autocomplete="username" placeholder="you@company.com" required' + val('email') + '></label>'
        + '<label class="f2">Password <span class="hint">at least 8 characters</span><input type="password" id="su-pw" minlength="8" autocomplete="new-password" required></label>'
        + '<button class="btn primary block" type="submit"' + dis + '>' + busyLabel('Create workspace') + '</button>'
        + '<p class="small muted">You become the admin and add your team later. Only people in your workspace can see its drafts. Passwords are stored only as salted hashes.</p></form>'
      : '<form data-form="login" class="auth-form">'
        + '<label class="f2">Email<input type="email" id="li-email" autocomplete="username" placeholder="you@company.com" required' + val('email') + '></label>'
        + '<label class="f2">Password<input type="password" id="li-pw" autocomplete="current-password" required></label>'
        + '<button class="btn primary block" type="submit"' + dis + '>' + busyLabel('Log in') + '</button></form>';
    return '<div class="auth-top"><button class="btn small" data-a="theme" aria-label="Switch light and dark theme">Theme</button></div>'
      + '<div class="auth">'
      + '<aside class="auth-side"><div class="brand">' + SHIELD + 'BrandSentinel</div>'
      + '<h1>Brand copy, checked before it goes out.</h1>'
      + '<p>Check a draft against your approved wording and facts. Legal sees only what needs sign-off, and you can see exactly what left your system.</p>'
      + '<ul><li>Fixed brand rules run first. The AI only judges what rules cannot.</li><li>Claims are matched to approved facts, and wrong numbers or opposite meanings are caught.</li><li>Reads Word, PDF and pictures with text, right in your browser.</li><li>Writer, Legal and Brand manager each have their own step.</li></ul>'
      + '<p class="small">Tidewell, the brand in the demo, is made up.</p></aside>'
      + '<section class="auth-main"><div class="auth-box">'
      + '<h2>' + (signup ? 'Create your workspace' : 'Welcome back') + '</h2>'
      + '<p class="muted">' + (signup ? 'Start a private workspace for your team.' : 'Log in to your workspace.') + '</p>'
      + '<div class="auth-tabs" role="tablist"><button role="tab" aria-selected="' + !signup + '" data-a="gatetab" data-v="login">Log in</button><button role="tab" aria-selected="' + signup + '" data-a="gatetab" data-v="signup">Create account</button></div>'
      + form
      + '<div class="auth-or"><span>or try the demo</span></div>'
      + '<div class="auth-demo">' + roles.map((r) => '<button class="btn" data-a="login" data-v="' + r[0] + '"' + dis + '>' + (auth.connecting ? 'Connecting…' : r[1]) + '</button>').join('') + '</div>'
      + (dis ? '<p class="small"><b>Connecting to the server…</b> The first sign-in after a quiet period can take up to 20 seconds.</p>' : '<p class="small muted">No password needed. Demo data is shared by everyone, so do not type private text. Start as Writer.</p>')
      + '<p class="small"><button class="linkbtn" data-a="enter">Continue in this browser only</button><span class="muted"> Nothing is stored on the server.</span></p>'
      + '</div></section></div>';
  }
  function logout(expired) {
    setEntered(false);
    auth = { token: '', user: null, workspace: null, connecting: false }; wsInfo = null;
    try { sessionStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
    state.subs = state.subs.filter((s) => !s.onServer); // other people's drafts must not stay in this browser
    if (state.work.subId && !sub(state.work.subId)) state.work = blankWork();
    state.ui = {}; persistLocal();
    if (expired) toast('Your login expired. Please log in again.');
    render();
  }
  /* ---------- saving drafts on the server (writers only). Local copy always stays; the server copy is extra. ---------- */
  let syncChain = Promise.resolve(), syncTimer = null, syncState = 'idle', syncWarned = false;
  const draftSub = () => { const s = state.work.subId ? sub(state.work.subId) : null; return s && !s.sample && signedIn() && auth.user.role === 'writer' && s.author === auth.user.name ? s : null; };
  function enqueueSync(job) { const p = syncChain.then(job); syncChain = p.catch(() => {}); return p; }
  function scheduleSync() {
    if (!signedIn()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { const s = draftSub(); if (s && ['draft', 'changes_requested'].includes(s.status)) enqueueSync(() => pushSub(s)).catch(() => { /* already reported */ }); }, 1500);
  }
  function syncLabel() {
    const s = draftSub();
    if (syncState === 'saving') return ['Saving…', 'plain'];
    if (syncState === 'fail') return ['Not saved to server', 'warn'];
    if (s && s.onServer) return ['Saved on server', 'ok'];
    return ['Signed in to server', 'ok'];
  }
  function paintBadge() { const el = document.getElementById('syncbadge'); if (!el) return; const l = syncLabel(); el.textContent = l[0]; el.className = 'pill ' + l[1]; }
  function setSync(st, err) {
    syncState = st;
    if (st === 'fail' && !syncWarned) { syncWarned = true; toast('Could not save to the server (' + ((err && err.message) || 'not reachable') + '). Your work is still safe in this browser.'); }
    if (st === 'ok') syncWarned = false;
    paintBadge();
  }
  const subData = (s) => { const d = clone(s); delete d.serverEvents; delete d.onServer; d.draftText = state.work.subId === s.id ? state.work.text : undefined; return d; };
  async function pushSub(s) {
    setSync('saving');
    try {
      const body = { title: s.title || 'Untitled draft', data: subData(s) };
      if (!s.onServer) {
        const row = await api('/api/submissions', { method: 'POST', body });
        const old = s.id; s.id = row.id; s.onServer = true; // the server id replaces the local P-001 style id
        if (state.work.subId === old) state.work.subId = s.id;
        if (state.ui.open === old) state.ui.open = s.id;
        persistLocal();
      } else {
        await api('/api/submissions/' + encodeURIComponent(s.id), { method: 'PUT', body });
      }
      setSync('ok');
    } catch (e) { setSync('fail', e); throw e; }
  }
  function finishSubmit(s, v) {
    s.status = v.route; addEvent(s, 'submitted', 'v' + s.versions.length + ' sent to ' + (v.route === 'awaiting_specialist' ? 'Legal' : 'Brand manager'));
    state.work = blankWork(); state.view = 'queue'; state.ui.open = s.id; state.ui.ver = null; save(); render(); toast('Submitted. It is now in the Queue.');
  }
  async function submitToServer(s, v) {
    busy = 'Sending to the server…'; render();
    try {
      await enqueueSync(() => pushSub(s));
      const row = await api('/api/submissions/' + encodeURIComponent(s.id) + '/transition', { method: 'POST', body: { action: 'submit', route: v.route } });
      busy = ''; finishSubmit(s, Object.assign({}, v, { route: row.status })); // the server decides the route (a reworded unverified claim always goes to Legal)
    } catch (e) {
      busy = '';
      if (e.status) { s.versions.pop(); if (e.status !== 401) toast('The server did not accept the submit: ' + e.message); render(); return; }
      toast('The server could not be reached. Submitted in this browser only.'); finishSubmit(s, v);
    }
  }
  /* ---------- the queue from the server ---------- */
  const KIND_LABEL = { created: 'created', submit: 'submitted', signoff: 'legal sign-off', approve: 'approved', request_changes: 'changes requested' };

  /* Anything that comes from the server is untrusted (any demo user can write it): keep only the known fields, with the right types. */
  const sstr = (v, n) => String(v == null ? '' : v).slice(0, n || 2000);
  const snum = (v) => (Number.isFinite(+v) ? +v : 0);
  const spick = (v, list, dflt) => (list.indexOf(v) >= 0 ? v : dflt);
  const sarr = (v, n) => (Array.isArray(v) ? v.slice(0, n || 200) : []);
  function cleanReceipt(r) {
    r = r && typeof r === 'object' ? r : {};
    return {
      id: sstr(r.id, 40), at: sstr(r.at, 40), mode: spick(r.mode, ['rules-only', 'ai-assisted'], 'rules-only'), provider: sstr(r.provider, 120), reason: sstr(r.reason, 400), error: sstr(r.error, 300),
      sent: sarr(r.sent, 60).map((x) => ({ text: sstr(x && x.text, 1000) })),
      redactions: sarr(r.redactions, 20).map((x) => ({ kind: sstr(x && x.kind, 40), count: snum(x && x.count) })),
      sourceIds: sarr(r.sourceIds, 60).map((x) => sstr(x, 40)), bytes: snum(r.bytes), accepted: snum(r.accepted),
      blocked: sarr(r.blocked, 60).map((x) => ({ title: sstr(x && x.title, 200), reason: sstr(x && x.reason, 300) })),
    };
  }
  function cleanData(d) {
    d = d && typeof d === 'object' ? d : {};
    return {
      id: sstr(d.id, 40), title: sstr(d.title, 200), author: sstr(d.author, 80), status: spick(d.status, Object.keys(W.STATUS), 'draft'), createdAt: sstr(d.createdAt, 40), needsLegal: !!d.needsLegal, fixed: snum(d.fixed),
      versions: sarr(d.versions, 50).map((v, i) => ({ n: snum(v && v.n) || i + 1, text: sstr(v && v.text, 20000), at: sstr(v && v.at, 40), by: sstr(v && v.by, 80), note: sstr(v && v.note, 300) })),
      firstCheck: Array.isArray(d.firstCheck) ? d.firstCheck.slice(0, 200).map((f) => ({ ruleId: sstr(f && f.ruleId, 40), category: sstr(f && f.category, 40) })) : null,
      final: sarr(d.final, 200).map((f) => ({ ruleId: sstr(f && f.ruleId, 40), status: sstr(f && f.status, 20), reason: sstr(f && f.reason, 500) })),
      finalFindings: sarr(d.finalFindings, 200).map((f) => ({ ruleId: sstr(f && f.ruleId, 40), title: sstr(f && f.title, 300), severity: spick(f && f.severity, ['high', 'medium', 'low'], 'low'), status: sstr(f && f.status, 20), reason: sstr(f && f.reason, 500), quote: sstr(f && f.quote, 500), origin: spick(f && f.origin, ['rule', 'ai'], 'rule') })),
      comments: sarr(d.comments, 200).map((c) => ({ by: sstr(c && c.by, 100), at: sstr(c && c.at, 40), text: sstr(c && c.text, 1000) })),
      events: sarr(d.events, 300).map((e) => ({ at: sstr(e && e.at, 40), by: sstr(e && e.by, 100), type: sstr(e && e.type, 40), note: sstr(e && e.note, 500) })),
      receipts: sarr(d.receipts, 20).map(cleanReceipt),
      feedback: sarr(d.feedback, 200).map((f) => ({ findingKey: sstr(f && f.findingKey, 120), ruleId: sstr(f && f.ruleId, 40), clear: !!(f && f.clear) })),
    };
  }
  function mergeRow(row) {
    const d = row.data || {};
    let s = state.subs.find((x) => x.id === row.id);
    const mine = s && state.work.subId === s.id && auth.user && s.author === auth.user.name; // the draft being edited keeps its local data
    if (!s) { s = cleanData(d); state.subs.push(s); }
    else if (!mine) Object.assign(s, cleanData(d));
    Object.assign(s, { id: row.id, title: row.title, status: row.status, author: row.authorName, needsLegal: row.needsLegal, createdAt: s.createdAt || row.createdAt, onServer: true, sample: false });
    delete s.draftText;
    return s;
  }
  async function loadServerSubs(quiet) {
    if (!signedIn()) return false;
    try { const rows = await api('/api/submissions'); rows.forEach(mergeRow); persistLocal(); return true; }
    catch (e) { if (!quiet && e.status !== 401) toast('Could not load the queue from the server (' + (e.message || 'not reachable') + '). Showing this browser only.'); return false; }
  }
  async function loadEvents(s) {
    if (!s || !s.onServer || !signedIn()) return;
    try {
      const ev = await api('/api/submissions/' + encodeURIComponent(s.id) + '/events');
      s.serverEvents = ev.map((e) => ({ at: e.at, by: e.actor, type: KIND_LABEL[e.kind] || e.kind, kind: e.kind, note: e.detail || '—' }));
      if (state.ui.open === s.id) render();
    } catch (e) { /* keep the local history */ }
  }
  const eventsOf = (s) => (s.onServer && s.serverEvents ? s.serverEvents : s.events);
  const commentsOf = (s) => (s.onServer && s.serverEvents ? s.serverEvents.filter((e) => ['signoff', 'approve', 'request_changes'].includes(e.kind) && e.note !== '—').map((e) => ({ by: e.by, at: e.at, text: e.note })) : s.comments);
  async function decideOnServer(s, kind, t) {
    try {
      const row = await api('/api/submissions/' + encodeURIComponent(s.id) + '/transition', { method: 'POST', body: { action: kind, note: t.slice(0, 500) } });
      mergeRow(row); state.ui.decisionText = '';
      await loadEvents(s); save(); render();
      toast(kind === 'approve' ? 'Approved.' : kind === 'signoff' ? 'Legal sign-off recorded.' : 'Changes requested. The writer will see your comment.');
    } catch (e) {
      if (e.status === 401) return;
      toast(e.status ? 'The server refused: ' + e.message : 'The server could not be reached. Nothing was changed.');
      loadServerSubs(true).then(() => render());
    }
  }
  function guideHtml() {
    return '<div class="card stack"><h3>Try this in 2 minutes</h3><ol class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">'
      + '<li>You are signed in. To switch role later, press <b>Log out</b> and pick another demo login on the first screen. Start as <b>Writer</b>.</li>'
      + '<li>In "Try a sample" choose <b>Product page (nearly clean)</b>, press <b>Run check</b>, then <b>Dispute</b> the one warning with a short reason.</li>'
      + '<li>Press <b>Submit for approval</b>. It appears in the <b>Queue</b>.</li>'
      + '<li><b>Log out</b>, choose <b>Brand manager</b> on the first screen, open the piece in the Queue and press <b>Approve</b>.</li>'
      + '<li>To see the Legal step, check this sentence as Writer instead: <i>Clinically proven to reduce cramps.</i> Dispute the finding and submit. Then log in as <b>Legal</b> and press <b>Sign off</b> before the Brand manager approves.</li>'
      + '<li>Open <b>Insights</b> and <b>Trust and AI</b> to see what the team gets wrong most and what was sent to the AI.</li></ol></div>';
  }
  function whoHtml() {
    if (signedIn()) return '<span id="syncbadge" class="pill ' + syncLabel()[1] + '" title="Drafts you write while signed in are saved on the BrandSentinel server">' + syncLabel()[0] + '</span><span class="small">' + esc(auth.user.name) + ' · ' + D.roleNames[auth.user.role] + '</span>' + (auth.workspace ? '<span class="pill plain" title="Your workspace">' + esc(auth.workspace.name) + '</span>' : '') + '<button class="btn small" data-a="logout">Log out</button>';
    let h = '';
    if (SERVER_ON) {
      const dis = auth.connecting ? ' disabled' : '';
      h += '<span class="small muted">Demo login</span>' + [['writer', 'Writer'], ['legal', 'Legal'], ['brand_manager', 'Brand manager']].map((r) => '<button class="btn small primary" data-a="login" data-v="' + r[0] + '"' + dis + '>' + (auth.connecting ? 'Connecting…' : r[1]) + '</button>').join('');
      h += '<button class="btn small" data-a="gate">Sign-in screen</button>';
    }
    h += '<label for="user">Viewing as</label><select id="user" data-bind="user">' + D.users.map((u) => '<option value="' + u.id + '"' + (u.id === state.userId ? ' selected' : '') + '>' + esc(u.name) + ' · ' + D.roleNames[u.role] + '</option>').join('') + '</select>';
    return h + '<span class="pill plain" title="Nothing is stored on the server unless you sign in">This browser only</span>';
  }

  function fresh() {
    return { v: 1, userId: 'u-asha', view: 'review', settings: { aiEnabled: true, provider: 'auto', custom: { url: '', model: '', key: '' } }, sources: clone(D.sources), changelog: [], subs: D.seedHistory(), work: blankWork(), ui: {} };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) { s.ui = {}; s.work = Object.assign(blankWork(), s.work || {}); return s; } }
    } catch (e) { /* storage unavailable: run in memory */ }
    return fresh();
  }
  function save() { persistLocal(); scheduleSync(); }
  function persistLocal() {
    try { const s = Object.assign({}, state, { ui: {} }); s.work = Object.assign({}, state.work, { imageUrl: '' }); localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  const user = () => (signedIn() ? auth.user : null) || D.users.find((u) => u.id === state.userId) || D.users[0];
  const role = () => user().role;
  const can = (a) => W.can(role(), a);
  const sub = (id) => state.subs.find((s) => s.id === id);
  const ruleTitle = (id) => { const s = state.sources; const r = (s.rules || []).find((x) => x.id === id) || (s.terms || []).find((x) => x.id === id); if (!r) return id; return r.title || ('Term: avoid "' + r.avoid + '"'); };
  function toast(msg) {
    let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; clearTimeout(toast.h); toast.h = setTimeout(() => t.remove(), 3500);
  }
  function addEvent(s, type, note) { s.events.push({ at: new Date().toISOString(), by: user().name + ' (' + D.roleNames[role()] + ')', type, note }); }

  /* ---------- AI provider ---------- */
  async function detectAI() {
    try { if (window.claude && window.claude.use) aiTools.sample = await window.claude.use('sample'); } catch (e) { aiTools.sample = null; }
    try {
      const r = await fetch(API_URL + '/api/health'); const j = await r.json();
      aiTools.server = j && j.ok && j.ai_configured ? { url: API_URL, model: j.model || 'AI model' } : null;
    } catch (e) { aiTools.server = null; }
    aiTools.checked = true; render();
  }
  /* ---------- reading PDFs and images with text. Everything happens inside this browser: the file is never uploaded.
     Only the reader code (and, for pictures, the English language data) is downloaded from a public CDN, the first time it is needed. ---------- */
  const libs = {};
  const loadScript = (url) => libs[url] || (libs[url] = new Promise((resolve, reject) => {
    const el = document.createElement('script'); el.src = url; el.onload = resolve;
    el.onerror = () => { delete libs[url]; reject(new Error('Could not download the file reader. Check your internet connection and try again.')); };
    document.head.appendChild(el);
  }));
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const MAX_FILE = 15 * 1024 * 1024, MAX_PDF_PAGES = 30, MAX_OCR_PAGES = 5;
  function say(msg) { busy = msg; const el = document.querySelector('[aria-live="polite"]'); if (el) el.textContent = msg; }
  async function ocrAll(images, label) {
    await loadScript(TESS);
    const worker = await window.Tesseract.createWorker('eng', 1, { logger: (m) => { if (m.status === 'recognizing text') say('Reading the text in ' + label + '… ' + Math.round((m.progress || 0) * 100) + '%'); } });
    try {
      const out = [];
      for (const img of images) out.push(F.cleanOcrText((await worker.recognize(img)).data.text));
      return out;
    } finally { await worker.terminate(); }
  }
  async function readPdf(file) {
    await loadScript(PDFJS + 'pdf.min.js'); const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const n = Math.min(doc.numPages, MAX_PDF_PAGES); let pages = [];
    for (let i = 1; i <= n; i++) { say('Reading page ' + i + ' of ' + n + '…'); const pg = await doc.getPage(i); pages.push({ label: 'Page ' + i, text: F.pdfItemsToText((await pg.getTextContent()).items) }); }
    let usedOcr = false, read = n;
    if (pages.reduce((a, p) => a + p.text.length, 0) < 20 * n) { // almost no text: a scanned PDF, so read the pictures of its pages instead
      usedOcr = true; read = Math.min(doc.numPages, MAX_OCR_PAGES); const canvases = [];
      for (let i = 1; i <= read; i++) {
        say('Preparing page ' + i + ' of ' + read + '…'); const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 2 }), c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height; await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; canvases.push(c);
      }
      pages = (await ocrAll(canvases, 'the scanned pages')).map((t, i) => ({ label: 'Page ' + (i + 1), text: t }));
    }
    const j = F.joinPages(pages);
    if (!j.text) throw new Error('No readable text was found in this PDF.');
    return Object.assign(j, { usedOcr, total: doc.numPages, read });
  }
  async function readImageText(file) {
    const j = F.joinPages([{ label: 'Image', text: (await ocrAll([file], 'the image'))[0] }]);
    if (!j.text) throw new Error('No readable text was found in this image.');
    return j;
  }
  const pageOf = (f) => {
    const w = state.work; if (!w.pageMap || !f) return '';
    if (w.text === w.pageText && f.start >= 0) return F.pageOfOffset(w.pageMap, f.start);
    const i = f.quote ? (w.pageText || '').indexOf(f.quote) : -1; return i < 0 ? '' : F.pageOfOffset(w.pageMap, i);
  };
  const aiOnHere = () => !!state.settings.aiEnabled && !(signedIn() && auth.workspace && auth.workspace.aiEnabled === false);
  function getProvider() {
    const c = state.settings.custom;
    if (state.settings.provider === 'custom' && c.url && c.model) return A.openAICompatible(c);
    if (state.settings.provider !== 'none' && aiTools.sample) return { name: 'Claude (through your claude.ai session)', call: (p) => aiTools.sample.json(p, { cache: false }) };
    if (state.settings.provider !== 'none' && aiTools.server) return A.serverProvider(Object.assign({}, aiTools.server, { token: () => (signedIn() ? auth.token : '') }));
    return null;
  }

  /* ---------- checking ---------- */
  function carry(prev, next) {
    const m = new Map(prev.map((f) => [f.key, f]));
    next.forEach((f) => {
      const p = m.get(f.key);
      const prevChips = (p && p.chips) || [];
      const was = new Map(prevChips.map((c) => [c.t, c.on]));
      f.chips = (f.keep || []).map((t) => ({ t, on: was.has(t) ? was.get(t) : true })).concat(prevChips.filter((c) => c.custom));
      if (p) { f.status = p.status === 'fixed' ? 'open' : p.status; f.reason = p.reason; f.feedback = p.feedback; }
    });
  }
  function relocateAI(text, list) {
    const out = [];
    list.forEach((f) => {
      const i = text.indexOf(f.quote); if (i < 0) return;
      const s = E.splitSentences(text).find((x) => i >= x.start && i < x.end);
      out.push(Object.assign({}, f, { start: i, end: i + f.quote.length, ctxStart: s ? s.start : i, ctxEnd: s ? s.end : i + f.quote.length }));
    });
    return out;
  }
  const sortF = (a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || a.start - b.start;
  function ensureSub() {
    const w = state.work;
    if (w.subId && sub(w.subId)) return sub(w.subId);
    const s = { id: 'P-' + String(state.subs.filter((x) => !x.sample).length + 1).padStart(3, '0'), title: w.title || 'Untitled draft', author: user().name, status: 'draft', createdAt: new Date().toISOString(), versions: [], firstCheck: null, final: [], finalFindings: [], comments: [], events: [], receipts: [], feedback: [], fixed: 0 };
    addEvent(s, 'created', 'Draft created'); state.subs.unshift(s); w.subId = s.id; return s;
  }
  function recheckLocal() {
    const w = state.work;
    const r = E.reviewText(w.text, state.sources, { now: new Date() });
    const ai = relocateAI(w.text, w.ai);
    const all = r.findings.concat(ai).sort(sortF);
    carry(w.findings, all);
    w.findings = all; w.ai = ai; w.verified = r.verified; w.stats = r.stats; w.checked = true;
  }
  async function runCheck() {
    const w = state.work;
    if (!can('create') && !w.subId) return toast('Switch to a Writer to start a review.');
    if (w.mode === 'image') return runImageCheck();
    if (!w.text.trim()) return toast('Add some text first.');
    const s = ensureSub(); if (w.title) s.title = w.title;
    w.ai = []; w.editing = false;
    recheckLocal(); busy = 'Fixed checks done. ' + (aiOnHere() ? 'Asking the AI about the sentences they could not judge…' : ''); render();
    const res = await A.aiReview({ text: w.text, sources: state.sources, localFindings: w.findings, provider: getProvider(), enabled: aiOnHere() });
    w.ai = res.findings; w.receipt = res.receipt; s.receipts.push(res.receipt);
    const all = E.reviewText(w.text, state.sources, { now: new Date() }).findings.concat(res.findings).sort(sortF);
    carry(w.findings, all); w.findings = all;
    if (!s.firstCheck) s.firstCheck = all.map((f) => ({ ruleId: f.ruleId, category: f.category }));
    addEvent(s, 'check', all.length + ' findings (' + res.receipt.mode + ')');
    busy = ''; save(); render();
    if (res.receipt.error) toast('The AI step failed (' + res.receipt.error + '). Fixed checks still ran.');
  }
  function afterEdit() {
    recheckLocal();
    const s = sub(state.work.subId); if (s && !s.firstCheck) s.firstCheck = state.work.findings.map((f) => ({ ruleId: f.ruleId, category: f.category }));
    save(); render();
  }
  function runImageCheck() {
    const w = state.work;
    if (!w.imageInfo) return toast('Choose an image first.');
    const s = ensureSub(); if (w.title) s.title = w.title;
    const list = E.checkVisual({ alt: w.alt, fg: w.useContrast ? w.fg : '', bg: w.useContrast ? w.bg : '', dominant: w.imageInfo.dominant, isLogo: w.isLogo, width: w.imageInfo.width }, state.sources);
    list.forEach((f) => { f.key = f.ruleId + '|' + f.quote.toLowerCase(); f.keep = []; });
    carry(w.findings, list); w.findings = list; w.ai = []; w.verified = []; w.checked = true; w.editing = false;
    w.receipt = A.buildReceipt({ mode: 'rules-only', reason: 'Images are analysed inside your browser. Nothing left this page.' });
    if (!s.firstCheck) s.firstCheck = list.map((f) => ({ ruleId: f.ruleId, category: f.category }));
    addEvent(s, 'check', list.length + ' findings on image'); save(); render();
  }

  /* ---------- rendering helpers ---------- */
  const chipsOn = (f) => (f.chips || []).filter((c) => c.on).map((c) => c.t);
  function diffHtml(a, b) { return W.diffWords(a, b).map((d) => d.type === 'same' ? esc(d.t) : d.type === 'add' ? '<ins>' + esc(d.t) + '</ins>' : '<del>' + esc(d.t) + '</del>').join(''); }

  function annotated(text, findings) {
    const marks = findings.filter((f) => f.start >= 0 && f.end > f.start && f.status !== 'fixed').sort((a, b) => a.start - b.start);
    let html = '', pos = 0;
    marks.forEach((f) => {
      if (f.start < pos) return;
      html += esc(text.slice(pos, f.start)) + '<mark class="' + f.severity + (f.origin === 'ai' ? ' ai' : '') + '" data-a="focus" data-id="' + f.id + '" tabindex="0" title="' + esc(f.title) + '">' + esc(text.slice(f.start, f.end)) + '</mark>';
      pos = f.end;
    });
    return html + esc(text.slice(pos));
  }

  /* Findings on exactly the same words (for example hype + capitals on "AMAZING") show as one card. */
  function sameSpan(a, b) { return a.id !== b.id && a.start >= 0 && a.start === b.start && a.end === b.end && a.status === b.status; }
  function groupFindings(list) {
    const seen = new Set(), out = [];
    const rank = (f) => ((f.fixes || []).some((x) => (x.replacement || '').toLowerCase() !== (f.quote || '').toLowerCase()) ? 2 : 0) + (f.severity === 'high' ? 1 : 0);
    list.forEach((f) => {
      if (seen.has(f.id)) return;
      const g = [f].concat(list.filter((o) => !seen.has(o.id) && sameSpan(f, o)));
      g.forEach((x) => seen.add(x.id));
      g.sort((a, b) => rank(b) - rank(a));
      out.push({ f: g[0], others: g.slice(1) });
    });
    return out;
  }
  function findingCard(f, locked, others) {
    others = others || [];
    const ev = f.fixes && f.fixes.length ? E.evaluateFixes(f, state.work.text, chipsOn(f)) : { ok: [], blocked: [] };
    const disputing = state.ui.disputing === f.id;
    const badges = [
      '<span class="pill ' + f.severity + '">' + f.severity + '</span>',
      '<span class="pill plain">' + (CAT[f.category] || f.category) + '</span>',
      f.origin === 'ai' ? '<span class="pill ai" title="Suggested by an AI model, checked against a real source">AI-assisted</span>' : '',
      f.unverified ? '<span class="pill warn">Unverified, needs human review</span>' : '',
      f.needsSpecialist ? '<span class="pill plain">Goes to Legal</span>' : '',
      pageOf(f) ? '<span class="pill plain" title="Where this was found in your file">' + esc(pageOf(f)) + '</span>' : '',
      f.status === 'disputed' ? '<span class="pill ok">Disputed</span>' : '',
    ].join('');
    let h = '<article class="f ' + f.severity + (f.status === 'disputed' ? ' disputed' : '') + '" id="card-' + f.id + '"><div class="head">' + badges + '</div>';
    h += '<h4>' + esc(f.title) + '</h4>';
    if (f.quote) h += '<div class="quote">' + esc(f.quote) + '</div>';
    h += '<p class="small">' + esc(f.explanation) + '</p>';
    if (others.length) h += '<p class="small muted">Same words also flagged: ' + others.map((o) => esc(o.title)).join('; ') + '. One fix below covers them.</p>';
    h += '<p class="small muted">Source: ' + esc(f.sourceLabel) + (f.origin === 'ai' ? ' · confidence ' + Math.round((f.confidence || 0) * 100) + '%' : '') + '</p>';
    if (f.status === 'disputed') h += '<p class="small"><b>Your reason:</b> ' + esc(f.reason) + '</p>';
    if (f.fixes && f.fixes.length && f.status !== 'disputed') {
      h += '<div class="stack" style="gap:8px"><div><b class="small">Meaning check.</b> <span class="small muted">What must this sentence still say? Tap to switch a point off, or add your own.</span></div>';
      h += '<div class="chips">' + (f.chips || []).map((c, i) => '<button class="chip" aria-pressed="' + c.on + '" data-a="chip" data-id="' + f.id + '" data-i="' + i + '">' + esc(c.t) + '</button>').join('');
      h += '<input type="text" size="12" placeholder="Add a point" aria-label="Add a point this sentence must keep" id="chip-' + f.id + '" data-bind="chipinput" data-id="' + f.id + '"><button class="btn small" data-a="chipadd" data-id="' + f.id + '">Add</button></div>';
      ev.ok.forEach((x) => { h += '<div class="fix"><div class="t"><b>' + esc(x.label) + '</b><br>' + diffHtml(x.before, x.after) + '</div><button class="btn small primary" data-a="fix" data-id="' + f.id + '" data-fx="' + x.id + '"' + (locked ? ' disabled' : '') + '>Apply</button></div>'; });
      if (ev.blocked.length) {
        h += '<details><summary class="small">' + ev.blocked.length + ' rewrite' + (ev.blocked.length > 1 ? 's' : '') + ' hidden because the meaning check failed</summary>';
        ev.blocked.forEach((x) => { const why = [].concat(x.check.missing.map((m) => 'drops "' + m + '"'), x.check.added.map((m) => 'adds "' + m + '"')).join(', '); h += '<div class="fix blocked"><div class="t"><b>' + esc(x.label) + '</b><br>' + diffHtml(x.before, x.after) + '<br><span class="pill warn">Blocked: ' + esc(why) + '</span></div></div>'; });
        h += '</details>';
      }
      if (!ev.ok.length) h += '<p class="small muted">No safe rewrite keeps the points above. Edit the text yourself, change the points, or dispute this finding.</p>';
      h += '</div>';
    } else if (!f.fixes.length && f.status !== 'disputed') {
      h += '<p class="small muted">No automatic fix for this one. ' + (state.work.mode === 'image' ? 'Change it, then press Check again.' : 'Edit the text, then press Check again.') + '</p>';
    }
    if (disputing) {
      h += '<label class="f2">Why should this stay as written?<textarea rows="2" id="reason-' + f.id + '" data-bind="reason" data-id="' + f.id + '" placeholder="For example: the lab report supports this figure.">' + esc(state.ui.reasonText || '') + '</textarea></label><div class="row"><button class="btn small primary" data-a="disputesave" data-id="' + f.id + '">Save dispute</button><button class="btn small" data-a="disputecancel">Cancel</button></div>';
    } else if (!locked) {
      h += '<div class="row">' + (f.status === 'disputed' ? '<button class="btn small" data-a="undispute" data-id="' + f.id + '">Withdraw dispute</button>' : '<button class="btn small" data-a="dispute" data-id="' + f.id + '">Dispute</button>')
        + '<span class="grow"></span><span class="small muted">Clear enough to act on?</span>'
        + '<button class="btn small" data-a="fb" data-id="' + f.id + '" data-v="1" aria-pressed="' + (f.feedback === 1) + '">' + (f.feedback === 1 ? 'Clear ✓' : 'Clear') + '</button>'
        + '<button class="btn small" data-a="fb" data-id="' + f.id + '" data-v="0" aria-pressed="' + (f.feedback === 0) + '">' + (f.feedback === 0 ? 'Unclear ✓' : 'Unclear') + '</button></div>';
    }
    return h + '</article>';
  }

  const receiptStore = {};
  function dlBtn(r) { receiptStore[r.id] = r; return '<p><button class="btn" data-a="receiptdl" data-id="' + esc(r.id) + '">Download this receipt (JSON)</button></p>'; }
  function receiptHtml(r) {
    if (!r) return '';
    if (r.mode === 'rules-only') return '<div class="receipt"><b>What left our system: nothing.</b><p class="small">' + esc(r.reason) + '</p>' + dlBtn(r) + '</div>';
    let h = '<div class="receipt ai"><b>What left our system</b>';
    if (r.error) h += '<p class="small"><span class="pill warn">AI step failed</span> ' + esc(r.error) + '. Only the sentences below were prepared; check the AI provider settings.</p>';
    h += '<p class="small">' + r.sent.length + ' sentence' + (r.sent.length === 1 ? '' : 's') + ' (' + r.bytes + ' characters) went to <b>' + esc(r.provider) + '</b> with ' + r.sourceIds.length + ' retrieved sources. ' + (signedIn() ? 'The rest of your draft was not sent to any AI service.' : 'The rest of your draft stayed here.');
    if (r.redactions.length) h += ' Hidden before sending: ' + r.redactions.map((x) => x.count + ' ' + x.kind + (x.count > 1 ? 's' : '')).join(', ') + '.';
    h += '</p>';
    h += '<details><summary class="small">See exactly what was sent</summary>' + r.sent.map((s) => '<div class="sent">' + esc(s.text) + '</div>').join('') + '<p class="small muted" style="margin-top:8px">Sources attached: ' + esc(r.sourceIds.join(', ')) + '</p></details>';
    if (r.blocked.length) h += '<details><summary class="small">' + r.blocked.length + ' AI suggestion' + (r.blocked.length > 1 ? 's were' : ' was') + ' blocked</summary>' + r.blocked.map((b) => '<div class="sent">' + esc(b.title) + ' — ' + esc(b.reason) + '</div>').join('') + '</details>';
    return h + dlBtn(r) + '</div>';
  }

  /* ---------- views ---------- */
  function reviewView() {
    const w = state.work, locked = false;
    const s = w.subId ? sub(w.subId) : null;
    let h = (signedIn() ? workspaceNotice() : '') + '<div class="cols"><section class="stack">';
    h += '<div class="card stack"><div class="row"><h2 class="grow">Check a draft</h2><div class="seg" role="group" aria-label="Content type"><button data-a="mode" data-v="text" aria-pressed="' + (w.mode === 'text') + '">Text</button><button data-a="mode" data-v="image" aria-pressed="' + (w.mode === 'image') + '">Image</button></div></div>';
    if (!can('create') && !w.subId) h += '<div class="notice warn">You are viewing as <b>' + D.roleNames[role()] + '</b>. Writers start reviews. Switch to a writer at the top, or open a piece from the Queue.</div>';
    h += '<label class="f2">Title<input type="text" id="title" data-bind="title" value="' + esc(w.title) + '" placeholder="e.g. Autumn launch email"></label>';
    if (w.mode === 'text') {
      h += '<div class="row"><label class="f2 grow">Try a sample<select id="sample" data-bind="sample"><option value="">Choose a sample draft…</option>' + D.samples.map((x) => '<option value="' + x.id + '">' + esc(x.label) + '</option>').join('') + '</select></label>'
        + '<label class="f2">Or upload<input type="file" id="file" data-bind="file" accept=".docx,.pdf,.txt,.md,image/*"></label></div>'
        + '<p class="small muted">Word, PDF, text, or a picture with text in it. PDFs and pictures are read inside your browser, so the file is not uploaded.</p>' + (w.sourceNote ? '<p class="small"><b>' + esc(w.sourceNote) + '</b></p>' : '');
      if (w.checked && !w.editing) {
        h += '<div class="doc" id="doc" aria-label="Your draft with findings marked">' + annotated(w.text, w.findings) + '</div><div class="row"><button class="btn" data-a="edit">Edit text</button><span class="small muted">Tap a highlighted phrase to jump to its finding.</span></div>';
      } else {
        h += '<textarea id="text" rows="12" data-bind="text" placeholder="Paste your draft here, or choose a sample above.">' + esc(w.text) + '</textarea>';
      }
    } else {
      h += '<div class="drop"><label class="f2">Image file (PNG, JPG, SVG, WebP)<input type="file" id="img" data-bind="img" accept="image/*"></label></div>';
      if (w.imageUrl) h += '<img class="imgprev" src="' + esc(w.imageUrl) + '" alt="Preview of the uploaded image">';
      else if (w.imageInfo) h += '<p class="small muted">Image analysed earlier. Upload it again to see the preview.</p>';
      if (w.imageInfo) {
        h += '<p class="small">' + w.imageInfo.width + ' × ' + w.imageInfo.height + ' px. Main colours: ' + w.imageInfo.dominant.map((d) => '<span class="swatch" style="background:' + esc(d.hex) + '"></span> <span class="mono">' + esc(d.hex) + '</span> ' + Math.round(d.share * 100) + '%').join(' · ') + '</p>';
        h += '<label class="f2">Alt text <span class="hint">what a screen reader should say</span><textarea id="alt" rows="2" data-bind="alt">' + esc(w.alt) + '</textarea></label>';
        h += '<label class="row small"><input type="checkbox" id="islogo" data-bind="islogo"' + (w.isLogo ? ' checked' : '') + '> This is a logo</label>';
        h += '<div class="row small"><label class="row"><input type="checkbox" id="usecontrast" data-bind="usecontrast"' + (w.useContrast ? ' checked' : '') + '> Text sits on this image or background:</label>'
          + '<label class="row">text <input type="color" id="fg" data-bind="fg" value="' + esc(w.fg) + '"></label><label class="row">background <input type="color" id="bg" data-bind="bg" value="' + esc(w.bg) + '"></label></div>';
      }
    }
    h += '<div class="row"><button class="btn primary" data-a="check"' + (busy ? ' disabled' : '') + '>' + (w.checked ? 'Check again' : 'Run check') + '</button>'
      + (w.checked ? '<button class="btn" data-a="newreview">Start over</button>' : '') + '<span class="small muted" aria-live="polite">' + esc(busy) + '</span></div>';
    h += '</div>';
    if (w.checked && w.verified.length) {
      h += '<div class="card stack"><h3>Claims backed by approved facts</h3>' + w.verified.map((v) => '<div class="verified"><span class="pill ok">Verified</span><span>' + esc(v.sentence) + ' <span class="muted small">(' + esc(v.factId) + (v.until ? ', valid until ' + esc(v.until) : '') + ')</span></span></div>').join('') + '</div>';
    }
    h += '</section><section class="stack">';
    if (!w.checked) {
      h += '<div class="card stack"><h3>How a review works</h3><ol class="small" style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px"><li>Pick a sample draft (or paste your own) and press <b>Run check</b>.</li><li>Fixed rules run first, then the AI judges the rest. Every finding shows its source.</li><li>Apply a fix, or dispute it with a reason. Rewrites that change your meaning are blocked.</li><li>Submit. Legal and the Brand manager review in the Queue, and every step is logged.</li></ol>' + (signedIn() ? '<p class="small muted">You are signed in, so your drafts and decisions are saved on the BrandSentinel server. Text goes to an AI service only as the receipt shows.</p>' : '<p class="small muted">You can switch role at the top to play the reviewer. Nothing here is sent anywhere unless the receipt says so.</p>') + '</div>';
      if (SERVER_ON) h += guideHtml();
    } else {
      const groups = groupFindings(w.findings);
      const c = { high: 0, medium: 0, low: 0 }; groups.forEach((g) => { c[g.f.severity]++; });
      const open = W.openCount(w.findings);
      h += '<div class="card stack"><div class="sum"><h3 class="grow">' + (groups.length ? groups.length + ' finding' + (groups.length === 1 ? '' : 's') : 'No findings') + '</h3>'
        + '<span class="pill high">' + c.high + ' high</span><span class="pill medium">' + c.medium + ' medium</span><span class="pill low">' + c.low + ' low</span></div>'
        + (w.stats ? '<p class="small muted">' + w.stats.words + ' words · reading level grade ' + w.stats.grade.toFixed(1) + (s && s.fixed ? ' · ' + s.fixed + ' fix' + (s.fixed > 1 ? 'es' : '') + ' applied' : '') + '</p>' : '')
        + receiptHtml(w.receipt) + '</div>';
      groups.forEach((g) => { h += findingCard(g.f, locked, g.others); });
      if (!w.findings.length) h += '<div class="notice">Nothing to fix. Submit it for approval below.</div>';
      const v = W.validateSubmit(s || { versions: [] }, w.findings);
      h += '<div class="card stack"><h3>Submit for approval</h3><p class="small">' + (open ? open + ' open finding' + (open > 1 ? 's' : '') + '. Apply a fix, edit the text, or dispute with a reason first.' : (v.ok ? (v.route === 'awaiting_specialist' ? 'This goes to Legal first because it still contains claims they must sign off, then to the Brand manager.' : 'This goes straight to the Brand manager.') : esc(v.reason))) + '</p><div class="row"><button class="btn primary" data-a="submit"' + (!can('submit') || !v.ok ? ' disabled' : '') + '>Submit for approval</button>' + (!can('submit') ? '<span class="small muted">Only writers can submit.</span>' : '') + '</div></div>';
    }
    return h + '</section></div>';
  }

  function queueView() {
    const open = state.ui.open ? sub(state.ui.open) : null;
    if (open) return subDetail(open);
    const rows = state.subs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    let h = '<div class="stack"><div class="row"><h2 class="grow">Review queue</h2>' + (signedIn() ? '<button class="btn small" data-a="refresh">Refresh from server</button>' : '') + '</div>';
    const mine = rows.filter((s) => (role() === 'legal' && s.status === 'awaiting_specialist') || (role() === 'brand_manager' && s.status === 'awaiting_manager') || (role() === 'writer' && s.author === user().name && ['draft', 'changes_requested'].includes(s.status)));
    if (mine.length) h += '<div class="notice"><b>' + mine.length + ' item' + (mine.length > 1 ? 's' : '') + ' waiting for you</b> as ' + D.roleNames[role()] + ': ' + mine.map((s) => '<a href="#" data-a="open" data-id="' + s.id + '">' + esc(s.title) + '</a>').join(', ') + '</div>';
    h += '<div class="card tablewrap"><table><thead><tr><th>Piece</th><th>Author</th><th>Status</th><th>Version</th><th>Created</th></tr></thead><tbody>';
    rows.forEach((s) => { h += '<tr class="click" data-a="open" data-id="' + s.id + '"><td><b>' + esc(s.title) + '</b>' + (s.sample ? ' <span class="pill plain">sample history</span>' : '') + '<br><span class="mono muted">' + esc(s.id) + '</span></td><td>' + esc(s.author) + '</td><td><span class="pill ' + (s.status === 'approved' ? 'ok' : s.status === 'changes_requested' ? 'warn' : 'plain') + '">' + esc(W.STATUS[s.status]) + '</span></td><td>v' + (s.versions.length || 0) + '</td><td class="small">' + fmt(s.createdAt) + '</td></tr>'; });
    return h + '</tbody></table></div></div>';
  }
  function subDetail(s) {
    const vsel = state.ui.ver || s.versions.length;
    const ver = s.versions.find((v) => v.n === vsel) || s.versions[s.versions.length - 1];
    const prev = s.versions.find((v) => v.n === (ver ? ver.n - 1 : 0));
    let h = '<div class="stack"><div class="row"><button class="btn" data-a="close">← Queue</button><h2 class="grow">' + esc(s.title) + '</h2><span class="pill ' + (s.status === 'approved' ? 'ok' : 'plain') + '">' + esc(W.STATUS[s.status]) + '</span></div>';
    h += '<p class="small muted">' + esc(s.id) + ' · by ' + esc(s.author) + (s.sample ? ' · sample history, text not stored' : '') + '</p><div class="cols"><section class="stack">';
    h += '<div class="card stack"><div class="row"><h3 class="grow">Version history</h3>' + s.versions.map((v) => '<button class="btn small' + (ver && v.n === ver.n ? ' primary' : '') + '" data-a="ver" data-v="' + v.n + '">v' + v.n + '</button>').join('') + '</div>';
    if (ver && !s.sample) {
      h += '<p class="small muted">v' + ver.n + ' · ' + fmt(ver.at) + ' · ' + esc(ver.by) + (ver.note ? ' · ' + esc(ver.note) : '') + '</p>';
      h += '<div class="doc">' + (prev ? diffHtml(prev.text, ver.text) : esc(ver.text)) + '</div>' + (prev ? '<p class="small muted">Changes since v' + prev.n + ' are marked.</p>' : '');
    } else h += '<p class="small muted">Version text is not stored for sample history.</p>';
    h += '</div>';
    if (s.finalFindings && s.finalFindings.length) {
      h += '<div class="card stack"><h3>Findings at submission</h3>' + s.finalFindings.map((f) => '<div class="small"><span class="pill ' + f.severity + '">' + f.severity + '</span> ' + esc(f.title) + (f.status === 'disputed' ? ' <span class="pill ok">disputed</span><br><span class="muted">Reason: ' + esc(f.reason) + '</span>' : ' <span class="pill plain">' + esc(f.status) + '</span>') + '</div>').join('') + '</div>';
    }
    if (s.receipts && s.receipts.length) h += '<div class="card stack"><h3>What left our system</h3>' + receiptHtml(s.receipts[s.receipts.length - 1]) + '</div>';
    h += '</section><section class="stack"><div class="card stack"><h3>Decision</h3>';
    const act = [];
    if (s.status === 'awaiting_specialist') act.push(['signoff', 'Sign off claims', can('signoff')]);
    if (s.status === 'awaiting_manager') act.push(['approve', 'Approve', can('approve')]);
    if (['awaiting_specialist', 'awaiting_manager'].includes(s.status)) act.push(['request_changes', 'Request changes', can('request_changes')]);
    if (!act.length) h += '<p class="small muted">' + (s.status === 'approved' ? 'Approved. The decision is recorded in the history below.' : s.status === 'changes_requested' ? 'The writer needs to revise and resubmit.' : 'Not in review yet.') + '</p>';
    else {
      h += '<label class="f2">Comment <span class="hint">required when requesting changes</span><textarea id="decision" rows="2" data-bind="decision">' + esc(state.ui.decisionText || '') + '</textarea></label><div class="row">' + act.map((a) => '<button class="btn' + (a[0] === 'request_changes' ? '' : ' primary') + '" data-a="' + a[0] + '" data-id="' + s.id + '"' + (a[2] ? '' : ' disabled title="Your role cannot do this"') + '>' + a[1] + '</button>').join('') + '</div>';
      if (!act.some((a) => a[2])) h += '<p class="small muted">You are viewing as ' + D.roleNames[role()] + '. Switch role at the top to act on this piece.</p>';
    }
    if (['draft', 'changes_requested'].includes(s.status) && !s.sample && can('revise')) h += '<button class="btn" data-a="revise" data-id="' + s.id + '">Open in editor</button>';
    h += '</div><div class="card stack"><h3>Comments</h3>' + (commentsOf(s).length ? commentsOf(s).map((c) => '<div class="small"><b>' + esc(c.by) + '</b> <span class="muted">' + fmt(c.at) + '</span><br>' + esc(c.text) + '</div>').join('') : '<p class="small muted">No comments yet.</p>')
      + (s.onServer ? '<p class="small muted">Reviewer comments are saved together with the decision above.</p>' : '<label class="f2">Add a comment<textarea id="comment" rows="2" data-bind="comment">' + esc(state.ui.commentText || '') + '</textarea></label><button class="btn small" data-a="comment" data-id="' + s.id + '">Post comment</button>') + '</div>';
    h += '<div class="card stack"><h3>History</h3><ul class="timeline">' + eventsOf(s).slice().reverse().map((e) => '<li><b>' + esc(e.type) + '</b> · ' + esc(e.note) + '<br><span class="muted small">' + esc(e.by) + ' · ' + fmt(e.at) + '</span></li>').join('') + '</ul></div></section></div></div>';
    return h;
  }

  function sourcesView() {
    const S = state.sources, tab = state.ui.srcTab || 'facts';
    const canSrc = can('edit_sources'), canFact = can('edit_facts');
    const tabs = [['facts', 'Facts'], ['terms', 'Terms'], ['rules', 'Rules'], ['palette', 'Colours'], ['conf', 'Confidential']];
    let h = '<div class="stack"><div class="row"><h2 class="grow">Source library</h2><span class="pill plain">' + esc(S.name) + ' · version ' + S.version + '</span></div>';
    h += '<p class="small muted">Everything the checker says must trace back to something here. Brand managers edit rules, terms and colours; Brand managers and Legal edit facts. Each change raises the version and is logged.</p>';
    h += '<div class="seg" role="group" aria-label="Library section">' + tabs.map((t) => '<button data-a="srctab" data-v="' + t[0] + '" aria-pressed="' + (tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div><div class="card stack">';
    if (tab === 'facts') {
      const att = S.facts.map((f) => ({ f, st: E.factStatus(f, new Date()) })).filter((x) => x.st.state !== 'valid').sort((x, y) => x.st.days - y.st.days);
      if (att.length) {
        h += '<div class="receipt"><b>' + att.length + ' fact' + (att.length === 1 ? ' needs' : 's need') + ' attention</b> <span class="small muted">(' + att.filter((x) => x.st.state === 'expired').length + ' expired, ' + att.filter((x) => x.st.state === 'expiring').length + ' expiring within 30 days)</span>'
          + att.map((x) => { const rep = S.facts.find((y) => y.replaces === x.f.id); return '<div class="small" style="margin-top:6px"><span class="pill ' + (x.st.state === 'expired' ? 'high' : 'warn') + '">' + (x.st.state === 'expired' ? 'Expired' : 'Expires in ' + x.st.days + ' days') + '</span> <span class="mono">' + esc(x.f.id) + '</span> ' + esc(x.f.text) + (rep ? ' <span class="muted">Replaced by ' + esc(rep.id) + ': ' + esc(rep.text) + '</span>' : '') + '</div>'; }).join('') + '</div>';
      } else h += '<div class="receipt"><b>All facts are in date.</b></div>';
      h += '<p class="small">Each fact has a <b>valid until</b> date. Past that date, any draft that relies on it is flagged as outdated.</p><div class="tablewrap"><table><thead><tr><th>ID</th><th>Approved fact</th><th>Valid until</th><th>Status</th><th></th></tr></thead><tbody>';
      S.facts.forEach((f) => { const st = E.factStatus(f, new Date()); h += '<tr><td class="mono">' + esc(f.id) + '</td><td>' + esc(f.text) + '<br><span class="small muted">Evidence: ' + esc(f.evidence || 'none recorded') + '</span></td><td>' + (canFact ? '<input type="date" data-bind="factdate" data-id="' + f.id + '" value="' + esc(f.validUntil || '') + '" aria-label="Valid until for ' + esc(f.id) + '">' : esc(f.validUntil || 'no end date')) + '</td><td><span class="pill ' + (st.state === 'expired' ? 'high' : st.state === 'expiring' ? 'warn' : 'ok') + '">' + (st.state === 'expired' ? 'Expired' : st.state === 'expiring' ? 'Expires in ' + st.days + ' days' : 'In date') + '</span></td><td>' + (canFact ? '<button class="btn small danger" data-a="del" data-t="facts" data-id="' + f.id + '">Delete</button>' : '') + '</td></tr>'; });
      h += '</tbody></table></div>';
      if (canFact) h += '<form class="stack" data-form="fact"><h4>Add a fact</h4><div class="row"><input type="text" id="nf-text" class="grow" placeholder="e.g. Tidewell is carbon neutral." required><input type="text" id="nf-ev" placeholder="Evidence (document or link)"><label class="row small">Valid until <input type="date" id="nf-until"></label><button class="btn primary" type="submit">Add fact</button></div></form>';
    } else if (tab === 'terms') {
      h += '<div class="tablewrap"><table><thead><tr><th>ID</th><th>Avoid</th><th>Use instead</th><th>Why</th><th></th></tr></thead><tbody>';
      S.terms.forEach((t) => { h += '<tr><td class="mono">' + esc(t.id) + '</td><td><b>' + esc(t.avoid) + '</b></td><td>' + esc(t.prefer || '(remove)') + '</td><td class="small">' + esc(t.reason) + '</td><td>' + (canSrc ? '<button class="btn small" data-a="toggle" data-t="terms" data-id="' + t.id + '">' + (t.enabled === false ? 'Enable' : 'Disable') + '</button> <button class="btn small danger" data-a="del" data-t="terms" data-id="' + t.id + '">Delete</button>' : (t.enabled === false ? '<span class="pill plain">off</span>' : '')) + '</td></tr>'; });
      h += '</tbody></table></div>';
      if (canSrc) h += '<form class="stack" data-form="term"><h4>Add a term</h4><div class="row"><input type="text" id="nt-avoid" placeholder="Avoid" required><input type="text" id="nt-prefer" placeholder="Use instead"><input type="text" id="nt-why" class="grow" placeholder="Why" required><button class="btn primary" type="submit">Add term</button></div></form>';
    } else if (tab === 'rules') {
      h += '<div class="tablewrap"><table><thead><tr><th>ID</th><th>Rule</th><th>Source</th><th></th></tr></thead><tbody>';
      S.rules.forEach((r) => { h += '<tr><td class="mono">' + esc(r.id) + '</td><td><b>' + esc(r.title) + '</b><br><span class="small">' + esc(r.text) + '</span></td><td class="small">' + esc(r.source) + '</td><td>' + (canSrc && !['R-FACT-EXPIRED', 'R-FACT-EXPIRING', 'R-CLAIM-REG'].includes(r.id) ? '<button class="btn small" data-a="toggle" data-t="rules" data-id="' + r.id + '">' + (r.enabled === false ? 'Enable' : 'Disable') + '</button>' : (r.enabled === false ? '<span class="pill plain">off</span>' : '')) + '</td></tr>'; });
      h += '</tbody></table></div>';
    } else if (tab === 'palette') {
      h += '<div class="stack">' + S.palette.map((p) => '<div class="row"><span class="swatch" style="background:' + esc(p.hex) + '"></span><b>' + esc(p.name) + '</b><span class="mono muted">' + esc(p.hex) + '</span>' + (canSrc ? '<button class="btn small danger" data-a="del" data-t="palette" data-id="' + esc(p.hex) + '">Delete</button>' : '') + '</div>').join('') + '</div>';
      if (canSrc) h += '<form class="stack" data-form="colour"><h4>Add a colour</h4><div class="row"><input type="text" id="nc-name" placeholder="Name" required><input type="color" id="nc-hex" value="#0F766E" aria-label="Colour"><button class="btn primary" type="submit">Add colour</button></div></form>';
    } else {
      h += '<p class="small">These names must never appear in public copy, and are removed before any text is sent to an AI service.</p><div class="stack">' + S.confidential.map((c, i) => '<div class="row"><b class="grow">' + esc(c) + '</b>' + (canSrc ? '<button class="btn small danger" data-a="delconf" data-i="' + i + '">Delete</button>' : '') + '</div>').join('') + '</div>';
      if (canSrc) h += '<form class="stack" data-form="conf"><div class="row"><input type="text" id="ncf" class="grow" placeholder="e.g. Project Orca" required><button class="btn primary" type="submit">Add</button></div></form>';
    }
    if (!(canSrc || canFact)) h += '<p class="small muted">You are viewing as ' + D.roleNames[role()] + '. Switch to Brand manager, Legal reviewer or Admin to edit.</p>';
    h += '</div><div class="card stack"><h3>Change log</h3>' + (state.changelog.length ? '<ul class="timeline">' + state.changelog.slice().reverse().map((c) => '<li>v' + c.v + ' · ' + esc(c.what) + '<br><span class="muted small">' + esc(c.by) + ' · ' + fmt(c.at) + '</span></li>').join('') + '</ul>' : '<p class="small muted">No changes yet. Edit something above to see it logged here.</p>') + '</div></div>';
    return h;
  }

  function barRows(list, key, valFn, max, warn) {
    return list.map((x) => '<div class="bar-row"><span title="' + esc(x.ruleId) + '">' + esc(x.title) + '</span><span class="track"><span class="fill' + (warn ? ' warn' : '') + '" style="display:block;width:' + Math.round((100 * valFn(x)) / max) + '%"></span></span><span class="v">' + (warn ? Math.round(x.rate * 100) + '%' : x.count) + '</span></div>').join('');
  }
  function insightsView() {
    const I = W.insights(state.subs, ruleTitle);
    const real = state.subs.filter((s) => !s.sample).length;
    let h = '<div class="stack"><div class="row"><h2 class="grow">Insights</h2></div><div class="notice small">Includes ' + state.subs.filter((s) => s.sample).length + ' pieces of <b>sample history</b> so this page is not empty. Your own reviews (' + real + ') are added as you submit and triage.</div>';
    h += '<div class="grid2"><div class="card stat"><span class="small muted">Pieces reviewed</span><b>' + I.totals.submissions + '</b></div><div class="card stat"><span class="small muted">Approved</span><b>' + I.totals.approved + '</b></div><div class="card stat"><span class="small muted">Findings rated clear</span><b>' + (I.clarity.pct == null ? '–' : I.clarity.pct + '%') + '</b><span class="small muted">' + (I.clarity.total ? I.clarity.total + ' ratings from testers' : 'Use Clear / Unclear on findings to fill this in') + '</span></div></div>';
    h += '<div class="grid2"><div class="card stack"><h3>Most broken rules</h3><p class="small muted">Findings on first check, across all pieces.</p>' + (I.topRules.length ? barRows(I.topRules.slice(0, 8), 'count', (x) => x.count, I.topRules[0].count) : '<p class="small muted">No data yet.</p>') + '</div>';
    h += '<div class="card stack"><h3>Most disputed rules</h3><p class="small muted">Share of findings writers disputed.</p>' + (I.disputes.length ? barRows(I.disputes.slice(0, 8), 'rate', (x) => x.rate, 1, true) : '<p class="small muted">Nothing disputed yet.</p>') + '</div></div>';
    h += '<div class="card stack"><h3>Guidelines that may be unclear</h3>' + (I.unclearRules.length ? I.unclearRules.map((u) => '<div><b>' + esc(u.title) + '</b> <span class="pill warn">' + u.disputed + ' of ' + u.total + ' disputed</span><p class="small muted">Writers said: ' + esc(u.reasons.join('; ')) + '</p><p class="small">Suggestion: add an example of an allowed exception to this rule, or change its limit.</p></div>').join('') : '<p class="small muted">No rule has been disputed in at least half of its uses (with 2 or more uses).</p>') + '</div>';
    h += '<div class="card stack"><h3>Mistakes people repeat</h3>' + (I.repeats.length ? '<div class="tablewrap"><table><thead><tr><th>Writer</th><th>Rule</th><th>Pieces</th></tr></thead><tbody>' + I.repeats.slice(0, 8).map((r) => '<tr><td>' + esc(r.author) + '</td><td>' + esc(r.title) + '</td><td>' + r.count + '</td></tr>').join('') + '</tbody></table></div><p class="small muted">Use this for a short refresher, not for blame.</p>' : '<p class="small muted">Nobody has hit the same rule in two pieces yet.</p>') + '</div></div>';
    return h;
  }

  function trustView() {
    const S = state.settings, ev = state.ui.evalResult, prov = getProvider();
    let h = '<div class="stack"><h2>Trust and AI use</h2><div class="grid2"><div class="card stack"><h3>AI review</h3>';
    h += '<p class="small">Status: <b>' + (!aiOnHere() ? (S.aiEnabled ? 'switched off by your workspace admin' : 'switched off') : prov ? 'ready (' + esc(prov.name) + ')' : aiTools.checked ? 'no AI provider in this view; fixed checks only' : 'checking…') + '</b></p>';
    h += '<label class="row"><input type="checkbox" id="aitoggle" data-bind="aitoggle"' + (S.aiEnabled ? ' checked' : '') + (can('settings') ? '' : ' disabled') + '> Let the AI judge sentences the fixed rules cannot</label>' + (can('settings') ? '' : '<p class="small muted">Only an Admin can change this. Switch role at the top.</p>');
    h += '<label class="f2">Provider<select id="prov" data-bind="prov"' + (can('settings') ? '' : ' disabled') + '><option value="auto"' + (S.provider === 'auto' ? ' selected' : '') + '>Automatic (Claude inside claude.ai, otherwise the BrandSentinel server)</option><option value="custom"' + (S.provider === 'custom' ? ' selected' : '') + '>My own OpenAI-compatible endpoint</option><option value="none"' + (S.provider === 'none' ? ' selected' : '') + '>None (fixed checks only)</option></select></label>';
    if (S.provider === 'custom') h += '<div class="stack"><input type="url" id="cu" data-bind="cu" placeholder="https://…/v1/chat/completions" value="' + esc(S.custom.url) + '"><input type="text" id="cm" data-bind="cm" placeholder="Model name" value="' + esc(S.custom.model) + '"><input type="password" id="ck" data-bind="ck" placeholder="API key (stays in this browser)" value="' + esc(S.custom.key) + '"><p class="small muted">The browser calls your endpoint directly, so it must allow cross-origin requests. A server-side proxy is planned for Round 3.</p></div>';
    h += '</div><div class="card stack"><h3>What we promise</h3><ul class="small" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px"><li>Fixed rule checks, claim matching and image checks run in your browser. They send nothing anywhere.</li><li>The AI sees only sentences the fixed rules could not judge, never the whole draft, with confidential names, emails and phone numbers hidden first.</li><li>Every finding must cite a real source in the library and quote real text. Anything else is blocked and counted in the receipt.</li><li>Findings from the AI carry an <span class="pill ai">AI-assisted</span> label. Unsupported claims say <span class="pill warn">Unverified, needs human review</span>.</li><li>People decide. Nothing is approved without a Brand manager, and risky claims need Legal.</li></ul></div></div>';
    h += '<div class="card stack"><h3>Test the checker</h3><p class="small">Runs the fixed checks on ' + D.evalSet.length + ' short drafts the team wrote, with ' + D.evalSet.reduce((a, c) => a + c.planted.length, 0) + ' planted mistakes and 2 clean drafts. It runs against the current library, so editing a rule or letting a fact lapse can change the result. This is our own test set: treat the numbers as a regression check, not as proof of real-world accuracy.</p><div class="row"><button class="btn primary" data-a="runeval">Run test set</button></div>';
    if (ev) h += '<div class="grid2"><div class="stat"><span class="small muted">Planted mistakes caught</span><b>' + ev.caught + ' of ' + ev.planted + ' (' + Math.round(ev.recall * 100) + '%)</b></div><div class="stat"><span class="small muted">Findings that were real</span><b>' + Math.round(ev.precision * 100) + '%</b><span class="small muted">' + ev.falsePos.length + ' false alarm' + (ev.falsePos.length === 1 ? '' : 's') + '</span></div></div>' + (ev.misses.length ? '<p class="small">Missed: ' + ev.misses.map((m) => esc(m.case + ' ' + m.ruleId)).join(', ') + '</p>' : '');
    h += '</div>';
    const rc = state.subs.flatMap((s) => (s.receipts || []).map((r) => Object.assign({ piece: s.title }, r))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    h += '<div class="card stack"><h3>AI-use log</h3><p class="small muted">Every check run, with what left this page.</p>' + (rc.length ? '<div class="tablewrap"><table><thead><tr><th>When</th><th>Piece</th><th>Mode</th><th>Sentences sent</th></tr></thead><tbody>' + rc.map((r) => '<tr><td class="small">' + fmt(r.at) + '</td><td>' + esc(r.piece) + '</td><td>' + (r.mode === 'ai-assisted' ? '<span class="pill ai">AI-assisted</span>' : '<span class="pill ok">Nothing sent</span>') + '</td><td>' + r.sent.length + ' (' + r.bytes + ' chars)</td></tr>').join('') + '</tbody></table></div>' : '<p class="small muted">No checks run yet.</p>') + '</div>';
    h += '<div class="card stack flat"><h3>Demo data</h3><p class="small">Everything on this page is saved in your browser only. The Tidewell brand is made up. <button class="btn small danger" data-a="reset">Reset demo data</button></p></div></div>';
    return h;
  }

  function render() {
    const y = window.scrollY, app = document.getElementById('app'); if (!app) return;
    if (gateOn()) { app.innerHTML = gateHtml(); window.scrollTo(0, 0); return; }
    const waiting = state.subs.filter((s) => (role() === 'legal' && s.status === 'awaiting_specialist') || (role() === 'brand_manager' && s.status === 'awaiting_manager')).length;
    const tabs = [['review', 'Review'], ['queue', 'Queue'], ['sources', 'Source library'], ['insights', 'Insights'], ['trust', 'Trust and AI']];
    if (SERVER_ON) tabs.push(['account', 'Account']);
    let h = '<header class="bar"><div class="wrap"><div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3l11 4v8c0 7-4.5 12-11 14C9.500 27 5 22 5 15V7z" fill="var(--ink)"/><path d="M11 16l4 4 7-8" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>BrandSentinel</div>'
      + '<div class="who">' + whoHtml() + '<button class="btn small" data-a="theme" aria-label="Switch light and dark theme">Theme</button></div></div>'
      + '<div class="wrap tabs" role="tablist">' + tabs.map((t) => '<button class="tab" ' + (state.view === t[0] ? 'aria-current="page"' : '') + ' data-a="nav" data-v="' + t[0] + '">' + t[1] + (t[0] === 'queue' && waiting ? '<span class="n">' + waiting + '</span>' : '') + '</button>').join('') + '</div></header><main class="wrap">';
    h += state.view === 'review' ? reviewView() : state.view === 'queue' ? queueView() : state.view === 'sources' ? sourcesView() : state.view === 'insights' ? insightsView() : state.view === 'account' ? accountView() : trustView();
    app.innerHTML = h + '</main>'; window.scrollTo(0, y);
  }

  /* ---------- actions ---------- */
  const find = (id) => state.work.findings.find((f) => f.id === id);
  function bump(what) { state.sources.version++; state.changelog.push({ v: state.sources.version, what, by: user().name, at: new Date().toISOString() }); save(); render(); }
  const actions = {
    nav(el) { state.view = el.dataset.v; state.ui.open = null; save(); render(); if (state.view === 'queue' && signedIn()) loadServerSubs(true).then(() => render());
      if (state.view === 'account' && signedIn()) loadWorkspace().then(() => render()); },
    openauth() { state.view = 'account'; state.ui.open = null; render(); },
    enter() { setEntered(true); render(); },
    gatetab(el) { gateTab = el.dataset.v === 'signup' ? 'signup' : 'login'; render(); const f = document.getElementById(gateTab === 'signup' ? 'su-ws' : 'li-email'); if (f) f.focus(); },
    gate() { setEntered(false); render(); },
    refresh() { return loadServerSubs(false).then((ok) => { render(); if (ok) toast('Queue refreshed from the server.'); }); },
    theme() { const r = document.documentElement; const dark = r.getAttribute('data-theme') === 'dark' || (!r.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches); r.setAttribute('data-theme', dark ? 'light' : 'dark'); },
    mode(el) { state.work.mode = el.dataset.v; state.work.checked = false; state.work.findings = []; state.work.editing = true; render(); },
    edit() { state.work.editing = true; render(); setTimeout(() => { const t = document.getElementById('text'); if (t) t.focus(); }, 0); },
    check() { return runCheck(); },
    login(el) { return demoLogin(el.dataset.v); },
    logout() { logout(false); },
    newreview() { state.work = blankWork(); save(); render(); },
    receiptdl(el) {
      const r = receiptStore[el.dataset.id]; if (!r) return;
      const out = { exported_at: new Date().toISOString(), tool: 'BrandSentinel', note: 'Only the sentences listed under "sent" left the system, after the hidden items were removed.', receipt: r };
      const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'brandsentinel-receipt-' + r.id + '.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    focus(el) { const c = document.getElementById('card-' + el.dataset.id); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1400); } },
    chip(el) { const f = find(el.dataset.id); const c = f.chips[+el.dataset.i]; c.on = !c.on; save(); render(); },
    chipadd(el) { const f = find(el.dataset.id); const i = document.getElementById('chip-' + f.id); const v = (i.value || '').trim(); if (!v) return; f.chips.push({ t: v, on: true, custom: true }); save(); render(); },
    fix(el) {
      const f = find(el.dataset.id); const w = state.work;
      const ev = E.evaluateFixes(f, w.text, chipsOn(f)); const fx = ev.ok.find((x) => x.id === el.dataset.fx); if (!fx) return toast('That rewrite no longer passes the meaning check.');
      w.text = E.applyFix(w.text, f, fx); const s = sub(w.subId); s.fixed = (s.fixed || 0) + 1; addEvent(s, 'fix applied', f.title);
      if (f.unverified) { s.needsLegal = true; addEvent(s, 'legal flag', 'An unverified claim was reworded, so Legal must still sign it off'); }
      afterEdit(); toast('Fix applied and draft re-checked.');
    },
    dispute(el) { state.ui.disputing = el.dataset.id; state.ui.reasonText = ''; render(); const t = document.getElementById('reason-' + el.dataset.id); if (t) t.focus(); },
    disputecancel() { state.ui.disputing = null; render(); },
    disputesave(el) { const f = find(el.dataset.id); const r = (state.ui.reasonText || '').trim(); if (!r) return toast('Add a reason so the reviewer understands.'); f.status = 'disputed'; f.reason = r; state.work.findings.forEach((o) => { if (o.start >= 0 && o.start === f.start && o.end === f.end && o.status === 'open') { o.status = 'disputed'; o.reason = r; } }); state.ui.disputing = null; addEvent(sub(state.work.subId), 'disputed', f.title + ': ' + r); save(); render(); },
    undispute(el) { const f = find(el.dataset.id); const rs = f.reason; state.work.findings.forEach((o) => { if (o === f || (o.start >= 0 && o.start === f.start && o.end === f.end && o.status === 'disputed' && o.reason === rs)) { o.status = 'open'; o.reason = ''; } }); save(); render(); },

    fb(el) {
      const f = find(el.dataset.id); const v = +el.dataset.v; const s = sub(state.work.subId); if (!s) return;
      s.feedback = s.feedback.filter((x) => x.findingKey !== f.key); f.feedback = v; s.feedback.push({ findingKey: f.key, ruleId: f.ruleId, clear: v === 1 }); save(); render();
    },
    submit() {
      if (busy) return;
      const w = state.work, s = sub(w.subId); const v = W.validateSubmit(s, w.findings); if (!v.ok) return toast(v.reason);
      if (w.mode === 'image') { toast('Image submissions are tracked with the checks only in this version.'); }
      s.versions.push({ n: s.versions.length + 1, text: w.mode === 'image' ? '[Image] ' + (w.alt || 'no alt text') : w.text, at: new Date().toISOString(), by: user().name, note: s.status === 'changes_requested' ? 'Revised after changes were requested' : '' });
      s.finalFindings = w.findings.map((f) => ({ ruleId: f.ruleId, title: f.title, severity: f.severity, status: f.status, reason: f.reason || '', quote: f.quote, origin: f.origin }));
      s.final = w.findings.map((f) => ({ ruleId: f.ruleId, status: f.status, reason: f.reason || '' }));
      if (draftSub() === s) return submitToServer(s, v);
      finishSubmit(s, v);
    },
    open(el) { state.ui.open = el.dataset.id; state.ui.ver = null; state.ui.decisionText = ''; render(); const o = sub(el.dataset.id); if (o && o.onServer) loadEvents(o); },
    close() { state.ui.open = null; render(); },
    ver(el) { state.ui.ver = +el.dataset.v; render(); },
    comment(el) { const t = (state.ui.commentText || '').trim(); if (!t) return; const s = sub(el.dataset.id); s.comments.push({ by: user().name + ' (' + D.roleNames[role()] + ')', at: new Date().toISOString(), text: t }); addEvent(s, 'comment', t.slice(0, 80)); state.ui.commentText = ''; save(); render(); },
    decide(el, kind) {
      const s = sub(el.dataset.id), t = (state.ui.decisionText || '').trim();
      const r = W.transition(s, role(), kind); if (!r.ok) return toast(r.reason);
      if (kind === 'request_changes' && !t) return toast('Add a comment so the writer knows what to change.');
      if (s.onServer && signedIn()) return decideOnServer(s, kind, t);
      s.status = r.to; if (t) s.comments.push({ by: user().name + ' (' + D.roleNames[role()] + ')', at: new Date().toISOString(), text: t });
      addEvent(s, kind === 'signoff' ? 'legal sign-off' : kind === 'approve' ? 'approved' : 'changes requested', t || '—'); state.ui.decisionText = ''; save(); render();
    },
    signoff(el) { actions.decide(el, 'signoff'); }, approve(el) { actions.decide(el, 'approve'); }, request_changes(el) { actions.decide(el, 'request_changes'); },
    revise(el) {
      const s = sub(el.dataset.id), last = s.versions[s.versions.length - 1];
      state.work = Object.assign(blankWork(), { subId: s.id, title: s.title, text: last ? last.text : '', editing: false }); s.status = 'draft'; addEvent(s, 'reopened', 'Writer opened it to revise');
      state.view = 'review'; state.ui.open = null; recheckLocal(); save(); render();
    },
    srctab(el) { state.ui.srcTab = el.dataset.v; render(); },
    toggle(el) { const it = state.sources[el.dataset.t].find((x) => x.id === el.dataset.id); it.enabled = it.enabled === false; bump((it.enabled ? 'Enabled ' : 'Disabled ') + it.id); },
    del(el) { const t = el.dataset.t; const key = t === 'palette' ? 'hex' : 'id'; state.sources[t] = state.sources[t].filter((x) => x[key] !== el.dataset.id); bump('Deleted ' + el.dataset.id + ' from ' + t); },
    delconf(el) { const [x] = state.sources.confidential.splice(+el.dataset.i, 1); bump('Removed confidential term "' + x + '"'); },
    runeval() { state.ui.evalResult = E.evaluateSet(D.evalSet, state.sources, { now: new Date() }); render(); },
    reset() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } state = fresh(); render(); toast('Demo data reset.'); },
  };
  const NEEDS_PERM = { signoff: 'signoff', approve: 'approve', request_changes: 'request_changes' };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]'); if (!el || el.disabled) return;
    if (el.tagName === 'A') e.preventDefault();
    const fn = actions[el.dataset.a]; if (fn) fn(el);
  });
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('mark[data-a]')) { e.preventDefault(); actions.focus(e.target); } });
  document.addEventListener('input', (e) => {
    const b = e.target.dataset && e.target.dataset.bind; if (!b) return;
    const w = state.work, v = e.target.value;
    if (b === 'title') w.title = v; else if (b === 'text') w.text = v; else if (b === 'alt') w.alt = v;
    else if (b === 'reason') state.ui.reasonText = v; else if (b === 'comment') state.ui.commentText = v; else if (b === 'decision') state.ui.decisionText = v;
    else if (b === 'cu') state.settings.custom.url = v; else if (b === 'cm') state.settings.custom.model = v; else if (b === 'ck') state.settings.custom.key = v;
    if (['title', 'text', 'alt', 'cu', 'cm', 'ck'].includes(b)) save();
  });
  document.addEventListener('change', async (e) => {
    const t = e.target, b = t.dataset && t.dataset.bind; if (!b) return; const w = state.work;
    if (b === 'user') { state.userId = t.value; state.ui.open = state.ui.open; save(); render(); }
    else if (b === 'sample') { const s = D.samples.find((x) => x.id === t.value); if (s) { state.work = Object.assign(blankWork(), { title: s.title, text: s.text }); save(); render(); } }
    else if (b === 'file') {
      const f = t.files[0]; if (!f) return;
      try {
        let text;
        let pageMap = null, sourceNote = '';
        if (/\.docx$/i.test(f.name)) { if (!window.JSZip) throw new Error('The Word reader could not load.'); text = await F.readDocx(window.JSZip, await f.arrayBuffer()); }
        else if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
          say('Reading ' + f.name + '… the first time, the reader has to download (a few seconds).'); render();
          const r = await readPdf(f); text = r.text; pageMap = r.pageMap;
          sourceNote = 'Read from ' + f.name + ' (' + r.read + (r.read === 1 ? ' page' : ' pages') + (r.read < r.total ? ' of ' + r.total : '') + (r.usedOcr ? ', scanned, so the text was recognised from pictures and may contain mistakes' : '') + '). Check the text before you run the check.';
        } else if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)) {
          say('Reading the text in ' + f.name + '… the first time takes 10 to 20 seconds while the reader downloads.'); render();
          const r = await readImageText(f); text = r.text; pageMap = r.pageMap;
          sourceNote = 'Text recognised from ' + f.name + '. Recognised text can contain mistakes, so check it before you run the check.';
        } else text = await f.text();
        busy = ''; state.work = Object.assign(blankWork(), { title: f.name.replace(/\.[^.]+$/, ''), text, pageMap, pageText: pageMap ? text : '', sourceNote }); save(); render(); toast('Loaded ' + f.name);
      } catch (err) { busy = ''; render(); toast(err.message || 'Could not read that file.'); }
    } else if (b === 'img') {
      const f = t.files[0]; if (!f) return;
      const url = URL.createObjectURL(f), img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 64, 64);
        w.imageInfo = { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, dominant: F.dominantColours(x.getImageData(0, 0, 64, 64).data, 4) };
        w.imageUrl = url; if (!w.title) w.title = f.name.replace(/\.[^.]+$/, ''); w.checked = false; save(); render();
      };
      img.onerror = () => toast('Could not open that image.'); img.src = url;
    } else if (b === 'islogo') { w.isLogo = t.checked; save(); }
    else if (b === 'usecontrast') { w.useContrast = t.checked; save(); }
    else if (b === 'fg') { w.fg = t.value; save(); } else if (b === 'bg') { w.bg = t.value; save(); }
    else if (b === 'wsai') { setWsAi(t.checked); }
    else if (b === 'aitoggle') { state.settings.aiEnabled = t.checked; save(); render(); }
    else if (b === 'prov') { state.settings.provider = t.value; save(); render(); }
    else if (b === 'factdate') { const f = state.sources.facts.find((x) => x.id === t.dataset.id); f.validUntil = t.value; bump('Changed valid-until of ' + f.id + ' to ' + (t.value || 'no end date')); }
  });
  document.addEventListener('submit', (e) => {
    const k = e.target.dataset && e.target.dataset.form; if (!k) return; e.preventDefault(); if (k === 'login' || k === 'signup' || k === 'member') return handleAccountForm(k); const S = state.sources, $ = (id) => document.getElementById(id).value.trim();
    if (k === 'fact') { const id = 'F-' + String(S.facts.length + 1).padStart(2, '0') + uid('').slice(-1); S.facts.push({ id, text: $('nf-text'), evidence: $('nf-ev'), validUntil: document.getElementById('nf-until').value }); bump('Added fact ' + id); }
    else if (k === 'term') { const id = 'T-' + String(S.terms.length + 1).padStart(2, '0') + uid('').slice(-1); S.terms.push({ id, avoid: $('nt-avoid'), prefer: $('nt-prefer'), reason: $('nt-why'), severity: 'medium', source: S.name }); bump('Added term ' + id); }
    else if (k === 'colour') { S.palette.push({ name: $('nc-name'), hex: document.getElementById('nc-hex').value.toUpperCase() }); bump('Added colour'); }
    else if (k === 'conf') { S.confidential.push($('ncf')); bump('Added confidential term'); }
  });

  /* Wake the server while the person reads the first screen, so the first sign-in does not wait for a cold start. */
  if (gateOn()) { try { fetch(API_URL + '/api/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'writer' }) }).catch(() => {}); } catch (e) { /* ignore */ } }
  render(); detectAI();
  window.__bs = { state: () => state, E, D, A, W, F }; // for tests
})();