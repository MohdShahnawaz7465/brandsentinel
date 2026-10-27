/* File helpers: .docx text extraction (with image alt text), dominant colours of an image, and helpers for PDF and OCR text. */
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
  /* ---------- PDFs and images with text (read in the browser; see app.js for the loaders) ---------- */
  /* items: the text pieces pdf.js returns for one page ({ str, hasEOL }). Returns the page as plain lines. */
  function pdfItemsToText(items) {
    let out = '';
    for (const it of items || []) {
      if (!it || typeof it.str !== 'string') continue;
      out += it.str + (it.hasEOL ? '\n' : ' ');
    }
    return out.split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
  }
  /* OCR output is noisy: tidy line endings, drop lines with no letters or digits, and collapse blank runs. */
  function cleanOcrText(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim());
    const out = []; let cur = '';
    for (const l of lines) {
      if (!/[A-Za-z0-9\u00c0-\u024f\u0900-\u097f]/.test(l)) { if (cur) out.push(cur); cur = ''; continue; }
      // A line that stops without a full stop and is followed by a lowercase line is one wrapped sentence.
      if (cur && !/[.!?:\u0964]["')\]]*$/.test(cur) && /^[a-z]/.test(l)) cur += ' ' + l;
      else { if (cur) out.push(cur); cur = l; }
    }
    if (cur) out.push(cur);
    return out.join('\n');
  }
  /* pages: [{ label, text }]. Joins them with a blank line and remembers where each page starts, so a finding
     can say which page it came from. */
  function joinPages(pages) {
    let text = ''; const map = [];
    for (const p of pages) {
      const t = (p.text || '').trim(); if (!t) continue;
      if (text) text += '\n\n';
      map.push({ label: p.label, start: text.length, end: text.length + t.length });
      text += t;
    }
    return { text, pageMap: map };
  }
  function pageOfOffset(pageMap, offset) {
    if (!Array.isArray(pageMap) || typeof offset !== 'number' || offset < 0) return '';
    const hit = pageMap.find((p) => offset >= p.start && offset <= p.end);
    return hit ? hit.label : '';
  }
  return { docxXmlToText, readDocx, dominantColours, decode, pdfItemsToText, cleanOcrText, joinPages, pageOfOffset };
});