/* Demo brand "Tidewell" (made up by the team), sample drafts, seed history and labelled test set. No real customer data. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BSData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SRC = 'Tidewell Brand Guide v3';
  const sources = {
    name: SRC, version: 3,
    rules: [
      { id: 'R-TONE-EXCL', category: 'tone', title: 'Exclamation marks', text: 'Use at most one exclamation mark per piece. Tidewell sounds warm and calm, not loud.', params: { max: 1 }, source: SRC + ' §1.2' },
      { id: 'R-TONE-HYPE', category: 'tone', title: 'No hype words', text: 'Avoid hype words. Say what the product does and let people decide.', source: SRC + ' §1.3', params: { words: [
        { word: 'amazing', alt: '', why: 'Hype word. Tidewell describes what the mix does instead of calling it amazing.' },
        { word: 'game-changing', alt: 'new', why: '"Game-changing" is an overclaim and is on the avoid list in section 1.3.' },
        { word: 'revolutionary', alt: 'new', why: '"Revolutionary" is an overclaim and is on the avoid list in section 1.3.' },
        { word: 'miracle', alt: '', why: '"Miracle" suggests a health promise we cannot support.' },
        { word: 'best-in-class', alt: 'well made', why: 'Comparative boasts need evidence we do not hold.' },
      ] } },
      { id: 'R-TONE-CAPS', category: 'tone', title: 'No shouting', text: 'Do not write whole words in capitals. Use bold sparingly instead.', params: { allow: ['USDA', 'FAQ', 'NASA'] }, source: SRC + ' §1.4' },
      { id: 'R-READ-LEN', category: 'readability', title: 'Sentence length', text: 'Keep sentences under 28 words so they are easy to read on a phone.', params: { maxWords: 28 }, source: SRC + ' §1.5' },
      { id: 'R-READ-GRADE', category: 'readability', title: 'Reading level', text: 'Aim for a reading level of grade 10 or lower so most readers can follow without effort.', params: { maxGrade: 10 }, source: SRC + ' §1.5' },
      { id: 'R-A11Y-ALT', category: 'accessibility', title: 'Alt text', text: 'Every image needs alt text that says what the image shows, so screen reader users get the same information.', source: SRC + ' §5.1 (WCAG 1.1.1)' },
      { id: 'R-A11Y-LINK', category: 'accessibility', title: 'Link text', text: 'Link text must make sense on its own. Avoid "click here" and "read more".', source: SRC + ' §5.2 (WCAG 2.4.4)' },
      { id: 'R-A11Y-CONTRAST', category: 'accessibility', title: 'Text contrast', text: 'Normal text needs a contrast ratio of at least 4.5:1 against its background.', params: { min: 4.5 }, source: SRC + ' §5.3 (WCAG 1.4.3)' },
      { id: 'R-VIS-PALETTE', category: 'visual', title: 'Brand colours', text: 'Large areas of colour in images should come from the brand palette.', params: { tolerance: 60 }, source: SRC + ' §4.1' },
      { id: 'R-VIS-LOGO', category: 'visual', title: 'Logo size', text: 'The Tidewell logo must be at least 120 px wide on screen so the wordmark stays readable.', params: { minWidth: 120 }, source: SRC + ' §4.2' },
      { id: 'R-CLAIM-1', category: 'claim', title: 'Claims need approved facts', text: 'Every factual claim must match an approved, in-date fact in the library.', source: SRC + ' §3.1' },
      { id: 'R-CLAIM-REG', category: 'claim', title: 'Health and science claims', text: 'Health, scientific and medical claims need written evidence and Legal sign-off before publishing.', source: SRC + ' §3.2' },
      { id: 'R-FACT-EXPIRED', category: 'claim', title: 'Expired facts', text: 'Facts have a valid-until date. Do not publish claims that rely on an expired fact.', source: SRC + ' §3.3' },
      { id: 'R-FACT-EXPIRING', category: 'claim', title: 'Facts about to expire', text: 'Check the publish date against the fact\'s valid-until date.', source: SRC + ' §3.3' },
      { id: 'R-CONF-1', category: 'confidentiality', title: 'Confidential names', text: 'Internal project names and unreleased plans must never appear in public copy.', source: SRC + ' §6.1' },
    ],
    terms: [
      { id: 'T-01', avoid: 'cheap', prefer: 'affordable', severity: 'medium', reason: 'Tidewell is positioned as good value, not low quality. Say "affordable".', source: SRC + ' §2.1' },
      { id: 'T-02', avoid: 'guys', prefer: 'everyone', severity: 'low', reason: 'Use inclusive greetings.', source: SRC + ' §2.2' },
      { id: 'T-03', avoid: 'sugar-free', prefer: 'no added sugar', severity: 'high', reason: 'Our mix contains naturally occurring sugars, so "sugar-free" is inaccurate. Say "no added sugar".', source: SRC + ' §2.3' },
      { id: 'T-04', avoid: 'powder', prefer: 'electrolyte mix', severity: 'medium', reason: 'The product name is "Tidewell Electrolyte Mix". Do not call it powder.', source: SRC + ' §2.4' },
      { id: 'T-05', avoid: 'all-natural', prefer: 'made with natural flavours', severity: 'high', reason: '"All-natural" is a regulated term we cannot support.', source: SRC + ' §2.5' },
    ],
    facts: [
      { id: 'F-01', text: 'Each serving contains 500 mg of sodium.', validUntil: '2027-06-30', evidence: 'Lab report LR-2026-114' },
      { id: 'F-02', text: 'Tidewell is made in Portland, Oregon.', validUntil: '', evidence: 'Company registration' },
      { id: 'F-03', text: 'Tidewell has been a Certified B Corp since 2022.', validUntil: '', evidence: 'B Lab certificate' },
      { id: 'F-04', text: 'Free shipping on orders over $40.', validUntil: '2026-09-30', evidence: 'Autumn promotion brief' },
      { id: 'F-05', text: 'Orders ship within 2 days.', validUntil: '2026-11-15', evidence: 'Warehouse SLA' },
      { id: 'F-06', text: 'Returns are accepted within 30 days.', validUntil: '', evidence: 'Returns policy' },
      { id: 'F-07', text: 'Shipping rates are calculated at checkout.', validUntil: '', evidence: 'Shop settings', replaces: 'F-04' },
      { id: 'F-08', text: 'Tidewell comes in 4 flavours.', validUntil: '', evidence: 'Product catalogue' },
    ],
    palette: [
      { name: 'Tide Navy', hex: '#14213D' }, { name: 'Wave Teal', hex: '#0F766E' }, { name: 'Sea Foam', hex: '#7FD8CF' },
      { name: 'Salt White', hex: '#FBFBF8' }, { name: 'Buoy Orange', hex: '#E76F51' },
    ],
    confidential: ['Project Marlin', 'Q4 pricing plan'],
    guidelines: [
      { id: 'G-1', text: 'Voice: warm, plain-spoken and confident, never boastful. Speak to one reader as "you".' },
      { id: 'G-2', text: 'Never compare Tidewell to named competitors.' },
      { id: 'G-3', text: 'Never shame people about their bodies, fitness or diet.' },
    ],
  };

  const users = [
    { id: 'u-asha', name: 'Asha Rao', role: 'writer' },
    { id: 'u-ravi', name: 'Ravi Nair', role: 'writer' },
    { id: 'u-dev', name: 'Dev Malhotra', role: 'brand_manager' },
    { id: 'u-meera', name: 'Meera Iyer', role: 'legal' },
    { id: 'u-sam', name: 'Sam Park', role: 'admin' },
  ];
  const roleNames = { writer: 'Writer', brand_manager: 'Brand manager', legal: 'Legal reviewer', admin: 'Admin' };

  const samples = [
    {
      id: 's1', label: 'Launch email (many problems)', title: 'Autumn launch email',
      text: 'Hey guys! Tidewell is the AMAZING new electrolyte powder that is cheap and sugar-free!! Each serving packs 600 mg of sodium. Clinically proven to reduce cramps and recover faster. Enjoy free shipping on every order over $40. Made in Portland, Oregon, and certified as a B Corp since 2022. Tidewell comes in 5 flavours. Questions about Project Marlin? Email priya@tidewell.example or call +91 98765 43210.\n\n![](hero.png)\n\nClick here to order.',
    },
    {
      id: 's2', label: 'Product page (nearly clean)', title: 'Product page copy',
      text: 'Tidewell makes it easy to stay hydrated. Stir one scoop into water and go. Each serving contains 500 mg of sodium. Orders ship within 2 days. Returns are accepted within 30 days. Tidewell is made in Portland, Oregon.',
    },
    {
      id: 's3', label: 'Social post (tone problems)', title: 'Instagram caption',
      text: 'This revolutionary mix is a game-changing way to hydrate! Say goodbye to cramps with the best-in-class formula. Our all-natural recipe is ready for your next run!',
    },
  ];

  /* Labelled test set written by the team. ruleId is the rule that should fire; contains is text the finding should cover. */
  const evalSet = [
    { id: 'E01', text: 'Our cheap electrolyte mix is great for runners.', planted: [{ ruleId: 'T-01', contains: 'cheap' }] },
    { id: 'E02', text: 'Hey guys, welcome to the Tidewell family.', planted: [{ ruleId: 'T-02', contains: 'guys' }] },
    { id: 'E03', text: 'A sugar-free way to hydrate on long runs.', planted: [{ ruleId: 'T-03', contains: 'sugar-free' }] },
    { id: 'E04', text: 'This game-changing blend is made for everyone.', planted: [{ ruleId: 'R-TONE-HYPE', contains: 'game-changing' }] },
    { id: 'E05', text: 'Our new mix is here! Try it today! Share it with a friend!', planted: [{ ruleId: 'R-TONE-EXCL', contains: '!' }, { ruleId: 'R-TONE-EXCL', contains: '!' }] },
    { id: 'E06', text: 'Each serving contains 450 mg of sodium.', planted: [{ ruleId: 'R-CLAIM-1', contains: '450 mg' }] },
    { id: 'E07', text: 'Tidewell is clinically proven to cure cramps.', planted: [{ ruleId: 'R-CLAIM-REG', contains: 'clinically' }] },
    { id: 'E08', text: 'Get free shipping on orders over $40.', planted: [{ ruleId: 'R-FACT-EXPIRED', contains: 'free shipping' }] },
    { id: 'E09', text: '![](team.png)\n\nMeet the team behind Tidewell.', planted: [{ ruleId: 'R-A11Y-ALT', contains: '![](' }] },
    { id: 'E10', text: 'Tidewell is made in Portland, Oregon. Each serving contains 500 mg of sodium. Returns are accepted within 30 days.', planted: [] },
    { id: 'E11', text: 'Project Marlin launches next month.', planted: [{ ruleId: 'R-CONF-1', contains: 'Project Marlin' }] },
    { id: 'E12', text: 'Tidewell was created by a small team of athletes in Portland who wanted a better way to stay hydrated on long trail runs, and they spent years testing every recipe with real runners before they felt ready to share it with the world.', planted: [{ ruleId: 'R-READ-LEN', contains: 'Tidewell was created' }] },
    { id: 'E13', text: 'To order a pack, click here.', planted: [{ ruleId: 'R-A11Y-LINK', contains: 'click here' }] },
    { id: 'E14', text: 'Tidewell makes it easy to stay hydrated. Stir one scoop into water and go.', planted: [] },
    { id: 'E15', text: 'Tidewell has been a Certified B Corp since 2019.', planted: [{ ruleId: 'R-CLAIM-1', contains: '2019' }] },
    { id: 'E16', text: 'Our all-natural recipe is ready for your next run.', planted: [{ ruleId: 'T-05', contains: 'all-natural' }] },
    { id: 'E17', text: 'Tidewell comes in 5 flavours.', planted: [{ ruleId: 'R-CLAIM-1', contains: '5 flavours' }] },
    { id: 'E18', text: 'The mix is AMAZING for hot days.', planted: [{ ruleId: 'R-TONE-CAPS', contains: 'AMAZING' }, { ruleId: 'R-TONE-HYPE', contains: 'AMAZING' }] },
  ];

  /* Sample history so the insights page has something to show. Clearly labelled as sample data in the UI. */
  function seedHistory() {
    const mk = (id, title, author, status, daysAgo, first, fin, versions) => ({
      id, title, author, status, sample: true, createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
      versions: Array.from({ length: versions }, (_, i) => ({ n: i + 1, text: '(sample)', at: new Date(Date.now() - (daysAgo - i) * 86400000).toISOString(), by: author })),
      firstCheck: first.map((r) => ({ ruleId: r })), final: fin, findings: [], comments: [], events: [{ at: new Date(Date.now() - daysAgo * 86400000).toISOString(), by: author, type: 'sample', note: 'Sample history' }], receipts: [], feedback: [],
    });
    const D = (ruleId, status, reason) => ({ ruleId, status, reason });
    return [
      mk('SEED-1', 'Summer hydration blog', 'Asha Rao', 'approved', 21, ['T-03', 'R-TONE-EXCL', 'R-CLAIM-1'], [D('R-CLAIM-1', 'disputed', 'Claim comes from the lab report')], 2),
      mk('SEED-2', 'Marathon sponsor post', 'Ravi Nair', 'approved', 18, ['R-TONE-HYPE', 'R-TONE-EXCL', 'T-02'], [], 2),
      mk('SEED-3', 'Retailer newsletter', 'Asha Rao', 'approved', 14, ['T-03', 'R-TONE-HYPE', 'R-READ-LEN'], [D('R-READ-LEN', 'disputed', 'Legal sentence must stay whole'), D('R-READ-LEN', 'disputed', 'Needs to stay as one line')], 3),
      mk('SEED-4', 'Winter promo email', 'Ravi Nair', 'approved', 9, ['T-03', 'R-READ-LEN', 'R-FACT-EXPIRED'], [D('R-READ-LEN', 'disputed', 'Reads fine aloud')], 2),
      mk('SEED-5', 'Founder interview', 'Asha Rao', 'approved', 6, ['T-03', 'R-TONE-HYPE', 'R-A11Y-ALT'], [], 2),
      mk('SEED-6', 'Instagram carousel', 'Ravi Nair', 'approved', 3, ['R-A11Y-ALT', 'R-TONE-EXCL', 'R-READ-LEN'], [D('R-A11Y-ALT', 'disputed', 'Decorative image')], 2),
    ];
  }
  return { sources, users, roleNames, samples, evalSet, seedHistory };
});
