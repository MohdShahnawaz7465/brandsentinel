// Run from the project folder:  node patch_app.js
// Applies the "untrusted server data" fixes to src/app.js. It stops without changing anything if a line is not found exactly once.
const fs = require('fs');
const file = 'src/app.js';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('function cleanData(')) { console.log('Already patched. Nothing to do.'); process.exit(0); }
const CLEAN = fs.readFileSync(__dirname + '/clean_block.txt', 'utf8');
const edits = [
  ['  function mergeRow(row) {', CLEAN + '\n  function mergeRow(row) {'],
  ["    if (!s) { s = Object.assign({ versions: [], firstCheck: null, final: [], finalFindings: [], comments: [], events: [], receipts: [], feedback: [], fixed: 0 }, clone(d)); state.subs.push(s); }", '    if (!s) { s = cleanData(d); state.subs.push(s); }'],
  ['    else if (!mine) Object.assign(s, clone(d));', '    else if (!mine) Object.assign(s, cleanData(d));'],
  ["    if (expired) toast('Your login expired. Press a demo login button again.');", "    state.subs = state.subs.filter((s) => !s.onServer); // other people's drafts must not stay in this browser\n    if (state.work.subId && !sub(state.work.subId)) state.work = blankWork();\n    state.ui = {}; persistLocal();\n    if (expired) toast('Your login expired. Press a demo login button again.');"],
  ['  const subData = (s) => Object.assign(clone(s), { draftText: state.work.subId === s.id ? state.work.text : undefined });', '  const subData = (s) => { const d = clone(s); delete d.serverEvents; delete d.onServer; d.draftText = state.work.subId === s.id ? state.work.text : undefined; return d; };'],
  ["'The server did not answer in time. You can keep working in this browser only.'", "'The server is waking up (the first time takes a few seconds). Press the button again, or keep working in this browser only.'"],
];
for (const [find, rep] of edits) {
  const n = s.split(find).length - 1;
  if (n !== 1) { console.log('STOPPED. This line was found ' + n + ' times (expected 1), nothing was changed:\n' + find.slice(0, 90)); process.exit(1); }
}
for (const [find, rep] of edits) s = s.split(find).join(rep);
fs.copyFileSync(file, 'src/app.js.bak');
fs.writeFileSync(file, s);
console.log('Done. 6 changes applied. A backup of the old file is src/app.js.bak');