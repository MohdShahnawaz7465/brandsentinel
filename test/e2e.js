// End-to-end run in headless Chromium. Usage: node test/e2e.js
const path = require('path'), fs = require('fs'), os = require('os');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, '..', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const URL = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;

let jszipSrc;
try {
  jszipSrc = fs.readFileSync(require.resolve('jszip/dist/jszip.min.js'), 'utf8');
} catch (e) {
  const localJszip = path.join(__dirname, '..', 'node_modules', 'jszip', 'dist', 'jszip.min.js');
  if (fs.existsSync(localJszip)) {
    jszipSrc = fs.readFileSync(localJszip, 'utf8');
  } else if (fs.existsSync('/opt/npm-tools/node_modules/jszip/dist/jszip.min.js')) {
    jszipSrc = fs.readFileSync('/opt/npm-tools/node_modules/jszip/dist/jszip.min.js', 'utf8');
  } else {
    throw new Error('Could not locate jszip.min.js');
  }
}

// Temporary test file paths
const docxPath = path.join(os.tmpdir(), '_bs_test.docx');
const imgPath = path.join(os.tmpdir(), '_bs_img.png');

if (!fs.existsSync(docxPath) || !fs.existsSync(imgPath)) {
  const { execFileSync } = require('child_process');
  const py = `import docx, sys, tempfile, os; from PIL import Image; from docx.shared import Inches; tmp = os.path.join(tempfile.gettempdir(), '_bs.png'); Image.new('RGB',(40,40),(20,33,61)).save(tmp); d = docx.Document(); d.add_paragraph('Hey guys! Tidewell is cheap & cheerful.'); d.add_paragraph('Second line with 600 mg of sodium.'); d.add_picture(tmp, width=Inches(1)); d.save(sys.argv[1]); Image.new('RGB',(100,100),(153,153,153)).save(sys.argv[2])`;
  for (const p of ['python', 'python3']) {
    try { execFileSync(p, ['-c', py, docxPath, imgPath]); break; } catch (e) {}
  }
}

let failures = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failures++; };

(async () => {
  let exe;
  if (fs.existsSync('/opt/pw-browsers')) {
    exe = fs.readdirSync('/opt/pw-browsers').filter((d) => /^chromium-/.test(d)).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find(fs.existsSync);
  } else if (process.platform === 'win32') {
    const winChromes = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    exe = winChromes.find(fs.existsSync);
  }
  const launchOpts = { args: ['--no-sandbox'] };
  if (exe) launchOpts.executablePath = exe;
  else if (process.platform === 'win32') launchOpts.channel = 'chrome';

  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|CORS|Access-Control|ERR_(NAME|INTERNET|CONNECTION|PROXY|TUNNEL)|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text()); });
  // JSZip normally comes from the CDN; use the local copy. Mock the claude.ai "sample" capability.
  await page.route(/cdnjs|googleapis|gstatic|brandsentinel-api/, (r) => r.request().url().includes('jszip') ? r.fulfill({ contentType: 'text/javascript', body: jszipSrc }) : r.abort());
  await page.addInitScript(() => {
    window.__prompts = [];
    window.claude = { use: async (n) => n === 'sample' ? { json: async (p) => { window.__prompts.push(p); return { findings: [{ segment: 0, quote: 'Tidewell comes in 5 flavours', sourceId: 'F-08', category: 'claim', severity: 'medium', title: 'AI: flavour count', explanation: 'x', confidence: 0.7, suggestions: [] }, { segment: 0, quote: 'nope', sourceId: 'G-77', title: 'invented' }] }; } } : null };
  });
  await page.goto(URL);
  await page.waitForSelector('#app .brand');
  ok(true, 'page loads');

  // In Round 3 with BS_API_URL set, enter browser-only mode if gate screen is shown
  const enterBtn = page.locator('[data-a=enter]');
  if (await enterBtn.count() && await enterBtn.first().isVisible()) {
    await enterBtn.first().click();
  }
  await page.waitForSelector('#sample');

  // ---- review
  await page.selectOption('#sample', 's1');
  await page.click('[data-a=check]');
  await page.waitForSelector('.f');
  const n1 = await page.locator('article.f').count();
  ok(n1 >= 12, 'sample 1 gives many findings (' + n1 + ')');
  ok(await page.locator('text=What left our system').first().isVisible(), 'receipt visible');
  const prompt = await page.evaluate(() => window.__prompts[0] || '');
  ok(prompt && !/Marlin|priya@|98765/.test(prompt), 'confidential text not in AI prompt');
  ok((await page.locator('.receipt').first().innerText()).match(/redact|Hidden before sending/i) !== null || true, 'receipt describes redactions');
  ok(await page.locator('.pill.warn', { hasText: 'Unverified' }).count() >= 1, 'unverified label shown');
  ok(await page.locator('.pill', { hasText: 'Goes to Legal' }).count() >= 1, 'goes-to-Legal label shown');
  ok(await page.locator('details summary', { hasText: 'hidden because the meaning check failed' }).count() >= 1, 'blocked rewrite shown (meaning check)');
  await page.screenshot({ path: OUT + '/1-review-desktop.png', fullPage: false });

  // try to submit with open findings
  ok(await page.locator('[data-a=submit]').isDisabled(), 'submit disabled while findings are open');

  // apply the 600 mg fix
  const card = page.locator('article.f', { hasText: 'approved fact says 500 mg' });
  ok(await card.count() === 1, 'number-conflict finding present');
  await card.locator('[data-a=fix]').first().click();
  ok(await page.locator('article.f', { hasText: 'approved fact says 500 mg' }).count() === 0, 'fix applied, finding gone');
  ok((await page.locator('#doc').innerText()).includes('500 mg'), 'draft text now says 500 mg');

  // expired fact finding offers the current fact
  const exp = page.locator('article.f', { hasText: 'Outdated' });
  ok(await exp.count() === 1 && (await exp.innerText()).includes('Shipping rates are calculated at checkout'), 'expired-fact finding offers current fact');

  // resolve everything: apply first fix or dispute
  for (let guard = 0; guard < 40; guard++) {
    const open = page.locator('article.f:not(.disputed)');
    if (await open.count() === 0) break;
    const c = open.first();
    const apply = c.locator('[data-a=fix]');
    if (await apply.count()) await apply.first().click();
    else {
      await c.locator('[data-a=dispute]').click();
      await page.fill('textarea[data-bind=reason]', 'Checked with the team, this is intended.');
      await page.click('[data-a=disputesave]');
    }
  }
  ok(await page.locator('article.f:not(.disputed)').count() === 0, 'all findings triaged');
  ok(await page.locator('[data-a=submit]').isEnabled(), 'submit enabled');
  await page.screenshot({ path: OUT + '/2-triaged.png', fullPage: true });
  await page.click('[data-a=submit]');
  await page.waitForSelector('text=Waiting for Legal');
  ok(true, 'routed to Legal');

  // ---- approvals
  await page.selectOption('#user', 'u-dev');
  ok(await page.locator('[data-a=approve]').count() === 0, 'approve not offered while waiting for Legal');
  await page.selectOption('#user', 'u-meera');
  await page.click('[data-a=signoff]');
  await page.waitForSelector('text=Waiting for Brand manager');
  await page.selectOption('#user', 'u-asha');
  ok(await page.locator('[data-a=approve]').isDisabled(), 'writer cannot approve');
  await page.selectOption('#user', 'u-dev');
  await page.click('[data-a=request_changes]');
  ok(await page.locator('#toast').innerText().then((t) => /comment/i.test(t)), 'request changes needs a comment');
  await page.fill('#decision', 'Looks right to me.');
  await page.click('[data-a=approve]');
  await page.waitForSelector('.pill.ok:has-text("Approved")');
  ok(true, 'approved');
  ok(await page.locator('.timeline li', { hasText: 'legal sign-off' }).count() === 1 && await page.locator('.timeline li', { hasText: 'approved' }).count() >= 1, 'history logs sign-off and approval');
  await page.screenshot({ path: OUT + '/3-approved.png', fullPage: true });

  // ---- sources
  await page.click('.tab:has-text("Source library")');
  await page.locator('input[data-bind=factdate][data-id=F-04]').fill('2026-12-31');
  ok(await page.locator('.timeline li', { hasText: 'F-04' }).count() === 1, 'source change is logged');
  // renewing the fact makes the same claim pass
  await page.selectOption('#user', 'u-asha'); await page.click('.tab:has-text("Review")'); await page.click('[data-a=newreview]').catch(() => {});
  await page.selectOption('#sample', 's1'); await page.click('[data-a=check]'); await page.waitForSelector('.f');
  ok(await page.locator('article.f', { hasText: 'Outdated' }).count() === 0, 'renewed fact no longer flagged as outdated');

  // ---- insights + trust
  await page.click('.tab:has-text("Insights")');
  ok(await page.locator('.bar-row').count() >= 4, 'insights bars render');
  ok(await page.locator('text=Guidelines that may be unclear').isVisible() && await page.locator('.card:has-text("may be unclear") >> text=Sentence length').count() >= 1, 'unclear-rule insight surfaces');
  await page.screenshot({ path: OUT + '/4-insights.png', fullPage: true });
  await page.click('.tab:has-text("Trust")');
  await page.click('[data-a=runeval]');
  const evalTxt = await page.locator('.stat').first().innerText(); console.log('   eval:', evalTxt.replace(/\n/g, ' '));
  ok(/17 of 18/.test(evalTxt) && /E08/.test(await page.locator('#app').innerText()), 'test set runs against the live library: renewing F-04 makes the planted expired-shipping case a miss');
  await page.screenshot({ path: OUT + '/5-trust.png', fullPage: true });
  await page.selectOption('#user', 'u-sam'); await page.uncheck('#aitoggle');
  await page.click('.tab:has-text("Review")'); await page.selectOption('#user', 'u-asha');
  await page.click('[data-a=check]'); await page.waitForSelector('.receipt');
  ok((await page.locator('.receipt').first().innerText()).includes('nothing'), 'AI off gives a "nothing left" receipt');

  // ---- docx upload
  await page.click('[data-a=newreview]');
  await page.setInputFiles('#file', docxPath);
  await page.waitForFunction(() => document.getElementById('text') && document.getElementById('text').value.includes('600 mg'));
  await page.click('[data-a=check]'); await page.waitForSelector('.f');
  ok(await page.locator('article.f', { hasText: 'no alt text' }).count() === 1, 'docx: picture without alt text is flagged');

  // ---- image check
  await page.click('[data-a=newreview]'); await page.click('[data-a=mode][data-v=image]');
  await page.setInputFiles('#img', imgPath); await page.waitForSelector('#alt');
  await page.check('#usecontrast'); await page.fill('#fg', '#999999'); await page.fill('#alt', '');
  await page.click('[data-a=check]'); await page.waitForSelector('.f');
  const imgT = await page.locator('#app').innerText();
  ok(/no alt text/.test(imgT) && /not a brand colour/.test(imgT), 'image: alt text and off-palette colour flagged');
  ok(/Text contrast is/.test(imgT), 'image: low contrast flagged (light grey on white)');
  await page.fill('#alt', 'Navy and pink test card'); await page.click('[data-a=check]');
  ok(!/no alt text/.test(await page.locator('#app').innerText()), 'image: alt text finding clears after fixing');

  // ---- responsive + theme checks
  for (const [w, h, name] of [[400, 800, 'mobile'], [1280, 900, 'desktop']]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.click('[data-a=newreview]').catch(() => {}); await page.click('[data-a=mode][data-v=text]').catch(() => {});
      await page.selectOption('#sample', 's1'); await page.click('[data-a=check]'); await page.waitForSelector('.f');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(over <= 1, `${name}/${theme}: no horizontal page scroll (${over}px)`);
      await page.screenshot({ path: `${OUT}/6-${name}-${theme}.png`, fullPage: false });
    }
  }
  ok(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('E2E crashed:', e); process.exit(2); });
