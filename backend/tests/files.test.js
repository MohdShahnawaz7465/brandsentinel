const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const JSZip = require('jszip');
const F = require('../src/files.js');

test('docx: text and missing image alt text are extracted', async () => {
  const py = `
import docx, sys
from docx.shared import Inches
from PIL import Image
import tempfile, os
tmp = os.path.join(tempfile.gettempdir(), '_bs.png')
Image.new('RGB',(40,40),(20,33,61)).save(tmp)
d = docx.Document()
d.add_paragraph('Hey guys! Tidewell is cheap & cheerful.')
d.add_paragraph('Second line with 600 mg of sodium.')
d.add_picture(tmp, width=Inches(1))
d.save(sys.argv[1])`;
  const out = require('node:path').join(require('node:os').tmpdir(), '_bs_test.docx');
  // Windows usually has "python", Linux and macOS "python3". Try both.
  let ran = false, lastErr;
  for (const exe of ['python3', 'python']) { try { execFileSync(exe, ['-c', py, out], { stdio: 'pipe' }); ran = true; break; } catch (e) { lastErr = e; } }
  if (!ran) throw lastErr;
  const text = await F.readDocx(JSZip, fs.readFileSync(out));
  assert.match(text, /Hey guys! Tidewell is cheap & cheerful\./);
  assert.match(text, /600 mg of sodium/);
  assert.match(text, /!\[\]\(image\)/);
});

test('docx: not a docx gives a clear error', async () => {
  const z = new JSZip(); z.file('x.txt', 'hi');
  await assert.rejects(F.readDocx(JSZip, await z.generateAsync({ type: 'nodebuffer' })), /Word \(\.docx\)/);
});

test('dominantColours finds the main colour', () => {
  const px = new Uint8ClampedArray(4 * 100);
  for (let i = 0; i < 100; i++) { const navy = i < 70; px.set(navy ? [20, 33, 61, 255] : [255, 0, 255, 255], i * 4); }
  const d = F.dominantColours(px, 2);
  assert.strictEqual(d[0].hex, '#14213D');
  assert.ok(Math.abs(d[0].share - 0.7) < 0.001);
  assert.strictEqual(d[1].hex, '#FF00FF');
});

test('pdf: text pieces become clean lines', () => {
  const items = [{ str: 'Our drink is', hasEOL: false }, { str: 'clinically  proven.', hasEOL: true }, { str: '', hasEOL: true }, { str: 'Buy now', hasEOL: false }, { str: 'and save 50%.', hasEOL: true }];
  assert.strictEqual(F.pdfItemsToText(items), 'Our drink is clinically proven.\nBuy now and save 50%.');
  assert.strictEqual(F.pdfItemsToText(null), '');
});

test('ocr: noise lines are dropped and spacing is tidied', () => {
  assert.strictEqual(F.cleanOcrText('Hello   world\r\n~~ --\r\n\r\nBuy now!  \n'), 'Hello world\nBuy now!');
  assert.strictEqual(F.cleanOcrText(undefined), '');
});

test('pages: joined text remembers which page each part came from', () => {
  const j = F.joinPages([{ label: 'Page 1', text: 'First page.' }, { label: 'Page 2', text: '  ' }, { label: 'Page 3', text: 'Third page.' }]);
  assert.strictEqual(j.text, 'First page.\n\nThird page.');
  assert.strictEqual(F.pageOfOffset(j.pageMap, 0), 'Page 1');
  assert.strictEqual(F.pageOfOffset(j.pageMap, j.text.indexOf('Third')), 'Page 3');
  assert.strictEqual(F.pageOfOffset(j.pageMap, 5000), '');
  assert.strictEqual(F.pageOfOffset(null, 3), '');
});