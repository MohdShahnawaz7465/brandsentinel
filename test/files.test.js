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
Image.new('RGB',(40,40),(20,33,61)).save('/tmp/_bs.png')
d = docx.Document()
d.add_paragraph('Hey guys! Tidewell is cheap & cheerful.')
d.add_paragraph('Second line with 600 mg of sodium.')
d.add_picture('/tmp/_bs.png', width=Inches(1))
d.save(sys.argv[1])`;
  const out = '/tmp/_bs_test.docx';
  execFileSync('python3', ['-c', py, out]);
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
