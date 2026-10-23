/* File helpers: .docx text extraction (with image alt text) and dominant colours of an image. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BSFiles = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function decode(s) {
    return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function docxXmlToText(xml) {
    const out = [];
    for (const p of xml.split(/<\/w:p>/)) {
      let line = '';
      const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<wp:docPr\b([^>]*)>/g;
      let m;
      while ((m = re.exec(p))) {
        if (m[1] !== undefined) line += decode(m[1]);
        else if (m[2] !== undefined) {
          const d = /\bdescr="([^"]*)"/.exec(m[2]);
          line += (line ? ' ' : '') + '![' + (d ? decode(d[1]).trim() : '') + '](image) ';
        } else line += m[0].startsWith('<w:tab') ? '\t' : '\n';
      }
      line = line.trim();
      if (line) out.push(line);
    }
    return out.join('\n');
  }
  async function readDocx(JSZip, buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const f = zip.file('word/document.xml');
    if (!f) throw new Error('This does not look like a Word (.docx) file.');
    return docxXmlToText(await f.async('string'));
  }
  /* data: RGBA Uint8ClampedArray. Buckets colours coarsely and returns the biggest groups. */
  function dominantColours(data, topN) {
    const buckets = new Map(); let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      const r = data[i] >> 5, g = data[i + 1] >> 5, b = data[i + 2] >> 5, k = (r << 6) | (g << 3) | b;
      const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; buckets.set(k, e); total++;
    }
    const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
    return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, topN || 4)
      .map((e) => ({ hex: ('#' + hex(e.r / e.n) + hex(e.g / e.n) + hex(e.b / e.n)).toUpperCase(), share: total ? e.n / total : 0 }));
  }
  return { docxXmlToText, readDocx, dominantColours, decode };
});
