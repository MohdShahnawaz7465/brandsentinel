// Measures how well claims are matched to approved facts. Usage: node tools/measure_matching.js [--json]
const E = require('../src/engine.js');
const T = require('../test/matching_testset.json');

function oldStance(sentence, m) {
  const fact = m.fact;
  const fn = E.numbersOf(fact.text);
  return E.numbersOf(sentence).some((n) => fn.some((x) => x.unit === n.unit && x.unit !== '' && x.value !== n.value)) ? 'conflict' : 'supported';
}
function run(label, matcher, stanceOf) {
  const rows = T.cases.map((c) => {
    const m = matcher(c.claim, T.facts);
    const got = m ? m.fact.id : null;
    const stance = m ? stanceOf(c.claim, m) : 'none';
    return { ...c, gotFactId: got, gotStance: stance, factOk: got === c.expectedFactId, stanceOk: got === c.expectedFactId && stance === c.expectedStance };
  });
  const about = rows.filter((r) => r.expectedFactId), none = rows.filter((r) => !r.expectedFactId);
  const sup = rows.filter((r) => r.expectedStance === 'supported');
  const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
  const res = {
    label,
    cases: rows.length,
    foundTheRightFact: [about.filter((r) => r.factOk).length, about.length],
    wronglyMatched: [none.filter((r) => r.gotFactId).length, none.length],
    pickedAWrongFact: about.filter((r) => r.gotFactId && !r.factOk).length,
    paraphrasesFound: [rows.filter((r) => r.group === 'paraphrase' && r.factOk).length, rows.filter((r) => r.group === 'paraphrase').length],
    rightVerdict: [rows.filter((r) => r.stanceOk || (!r.expectedFactId && !r.gotFactId)).length, rows.length],
    falselyVerified: rows.filter((r) => r.expectedStance !== 'supported' && r.gotStance === 'supported').length,
    rows,
  };
  res.pct = { foundTheRightFact: pct(...res.foundTheRightFact), paraphrasesFound: pct(...res.paraphrasesFound), rightVerdict: pct(...res.rightVerdict), wronglyMatched: pct(...res.wronglyMatched) };
  return res;
}
const out = [run('old (word overlap)', E.matchFactLegacy || E.matchFact, oldStance)];
if (E.matchFactLegacy) out.push(run('new (meaning-aware)', E.matchFact, (s, m) => E.claimStance(s, m).stance));
if (process.argv.includes('--json')) { console.log(JSON.stringify(out.map(({ rows, ...r }) => r), null, 1)); process.exit(0); }
for (const r of out) {
  console.log('\n== ' + r.label + ' ==');
  console.log('right fact found          ' + r.foundTheRightFact.join('/') + '  (' + r.pct.foundTheRightFact + '%)');
  console.log('  of which paraphrases    ' + r.paraphrasesFound.join('/') + '  (' + r.pct.paraphrasesFound + '%)');
  console.log('claims with no fact, wrongly matched  ' + r.wronglyMatched.join('/') + '  (' + r.pct.wronglyMatched + '%)');
  console.log('matched to a wrong fact   ' + r.pickedAWrongFact);
  console.log('right verdict overall     ' + r.rightVerdict.join('/') + '  (' + r.pct.rightVerdict + '%)');
  console.log('wrong claims passed as verified  ' + r.falselyVerified);
  for (const x of r.rows) if (!(x.stanceOk || (!x.expectedFactId && !x.gotFactId))) console.log('  miss ' + x.id + ' [' + x.group + '] "' + x.claim + '" expected ' + x.expectedFactId + '/' + x.expectedStance + ', got ' + x.gotFactId + '/' + x.gotStance);
}