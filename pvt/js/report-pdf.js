/*
 * Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. MIT licence (see LICENSE).
 *
 * report-pdf.js -- a PDF report of the current PVT model: an executive
 * summary, the key results, the inputs and correlations, the quality checks,
 * the tuning (when applied), the key plots, worked calculations and the
 * property table.
 *
 * The page stays free of libraries, so the PDF is written directly: a small
 * PDF 1.4 writer (A4 pages, the standard Helvetica fonts in WinAnsi encoding,
 * vector lines, rectangles and text) and a flow layout on top of it. Charts
 * are drawn as vector paths, so they stay sharp at any zoom and print well.
 *
 *   PVTReport.build(model, opts)    -> Uint8Array (the PDF file)
 *   PVTReport.summary(model, opts)  -> [paragraph, ...] executive summary
 *   PVTReport.outline(model, opts)  -> plain-text preview of the report
 *   PVTReport.filename(model, opts) -> suggested file name
 *
 * opts = {
 *   units: 'field' | 'metric',   units of the report (formulas stay in field)
 *   title, project, preparedBy,  cover text (all optional)
 *   plots, calcs, method: bool   include those sections (default true)
 *   now: Date                    report date (default: now)
 * }
 *
 * The model is the object pvt-model.js builds (field units internally).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PVTReport = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TOOL = 'Black-Oil PVT Generator';
  var AUTHOR = 'Ankaj Kumar Sinha';
  var COPYRIGHT = '© 2026 Ankaj Kumar Sinha · MIT licence · github.com/authorankaj-glitch/Black-Oil-PVT-Generator';

  /* ================================================================ *
   * Units: the model is in field units; the report shows either system
   * ================================================================ */
  var ID = function (x) { return x; };
  var UNITS = {
    field: {
      p: { f: ID, u: 'psia', d: 0 }, T: { f: ID, u: '°F', d: 1 },
      rs: { f: ID, u: 'scf/STB', d: 1 }, bo: { f: ID, u: 'bbl/STB', d: 4 },
      bg: { f: ID, u: 'ft³/scf', d: 5 }, rho: { f: ID, u: 'lb/ft³', d: 2 },
      c: { f: ID, u: '1/psi', d: -1 }, mu: { f: ID, u: 'cp', d: 4 },
      cgr: { f: ID, u: 'STB/MMscf', d: 2 }, eg: { f: ID, u: 'scf/ft³', d: 1 },
      none: { f: ID, u: '–', d: 4 }
    },
    metric: {
      p: { f: function (x) { return x * 0.0689475729; }, u: 'bara', d: 1 },
      T: { f: function (x) { return (x - 32) / 1.8; }, u: '°C', d: 1 },
      rs: { f: function (x) { return x * 0.178107607; }, u: 'sm³/sm³', d: 2 },
      bo: { f: ID, u: 'rm³/sm³', d: 4 },
      bg: { f: ID, u: 'rm³/sm³', d: 5 },
      rho: { f: function (x) { return x * 16.0184634; }, u: 'kg/m³', d: 1 },
      c: { f: function (x) { return x / 0.0689475729; }, u: '1/bar', d: -1 },
      mu: { f: ID, u: 'mPa·s', d: 4 },
      cgr: { f: function (x) { return x * 5.614583; }, u: 'sm³/10^6 sm³', d: 2 },
      eg: { f: ID, u: 'sm³/rm³', d: 1 },
      none: { f: ID, u: '–', d: 4 }
    }
  };

  function unitSet(opts) { return UNITS[opts && opts.units === 'metric' ? 'metric' : 'field']; }

  /* number -> string at a fixed number of decimals (d < 0: exponential) */
  function fx(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return d < 0 ? Number(x).toExponential(3) : Number(x).toFixed(d);
  }

  var CORR_NAMES = {
    standing: 'Standing (1947)', vasquezBeggs: 'Vasquez & Beggs (1980)',
    glaso: 'Glaso (1980)', alMarhoun: 'Al-Marhoun (1988)',
    petroskyFarshad: 'Petrosky & Farshad (1993)', lasater: 'Lasater (1958)',
    beggsRobinson: 'Beggs & Robinson (1975)', beal: 'Beal (1946)',
    ngEgbogah: 'Ng & Egbogah (1983)', chewConnally: 'Chew & Connally (1959)',
    mccain: 'McCain et al. (1988)', dak: 'Dranchuk & Abou-Kassem (1975)',
    hallYarborough: 'Hall & Yarborough (1973)', beggsBrill: 'Beggs & Brill (1973)',
    sutton: 'Sutton (1985)', wichertAziz: 'Wichert & Aziz (1972)',
    carr: 'Carr, Kobayashi & Burrows (1954)',
    leeGonzalezEakin: 'Lee, Gonzalez & Eakin (1966)',
    carrKobayashiBurrows: 'Carr, Kobayashi & Burrows (1954)', none: 'constant above Pb'
  };
  function corrName(k) { return CORR_NAMES[k] || k; }

  var MULT_NAMES = {
    pbMult: 'Pb / Rs(p) stretch', boMult: 'Bo expansion', coMult: 'Oil compressibility',
    muodMult: 'Dead-oil viscosity', muobMult: 'Saturated oil viscosity',
    muouMult: 'Undersaturated oil viscosity', tpcMult: 'Pseudo-critical temperature',
    ppcMult: 'Pseudo-critical pressure', mugMult: 'Gas viscosity'
  };

  /* ================================================================ *
   * Minimal PDF writer
   * ================================================================ */

  /* Glyph widths (1/1000 em) of Helvetica and Helvetica-Bold, ASCII 32-126,
     from the Adobe core-font metrics. */
  var W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  var W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

  /* Unicode -> WinAnsi code, with the glyph width (regular, bold). */
  var WIN = {
    0x2013: [150, 556, 556], 0x2014: [151, 1000, 1000], 0x2022: [149, 350, 350],
    0x2018: [145, 222, 278], 0x2019: [146, 222, 278], 0x201c: [147, 333, 500],
    0x201d: [148, 333, 500], 0x2026: [133, 1000, 1000], 0x00b7: [183, 278, 278],
    0x00b0: [176, 400, 400], 0x00b2: [178, 333, 333], 0x00b3: [179, 333, 333],
    0x00b5: [181, 556, 611], 0x03bc: [181, 556, 611], 0x00b1: [177, 584, 584],
    0x00d7: [215, 584, 584], 0x00a9: [169, 737, 737], 0x00a0: [32, 278, 278],
    0x00e9: [233, 556, 556], 0x00f6: [246, 556, 611], 0x00fc: [252, 556, 611]
  };
  /* characters outside WinAnsi, spelled out */
  var SUBST = { '≤': '<=', '≥': '>=', '≈': '~', '−': '-', '→': '->',
                ' ': ' ', ' ': ' ', 'γ': 'g', 'ρ': 'rho', 'Δ': 'd' };

  function normalise(s) {
    s = String(s);
    var out = '';
    for (var i = 0; i < s.length; i++) out += SUBST[s.charAt(i)] !== undefined ? SUBST[s.charAt(i)] : s.charAt(i);
    return out;
  }

  /* text -> WinAnsi byte string, escaped for a PDF literal string */
  function encode(s) {
    s = normalise(s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), b;
      if (c >= 32 && c <= 126) b = c;
      else if (WIN[c]) b = WIN[c][0];
      else b = 63; /* ? */
      if (b === 40 || b === 41 || b === 92) out += '\\' + String.fromCharCode(b);
      else out += String.fromCharCode(b);
    }
    return out;
  }

  function textWidth(s, size, bold) {
    s = normalise(s);
    var w = 0, tab = bold ? W_BOLD : W_REG;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 32 && c <= 126) w += tab[c - 32];
      else if (WIN[c]) w += WIN[c][bold ? 2 : 1];
      else w += 556;
    }
    return w * size / 1000;
  }

  function n2(x) {
    var s = (Math.round(x * 100) / 100).toFixed(2);
    return s.replace(/\.?0+$/, '') || '0';
  }
  function rgb(hex) {
    var h = hex.replace('#', '');
    return [0, 2, 4].map(function (i) { return n2(parseInt(h.substr(i, 2), 16) / 255); }).join(' ');
  }

  var PAGE_W = 595.28, PAGE_H = 841.89;   /* A4 in points */

  function PdfDoc() { this.pages = []; }
  PdfDoc.prototype.addPage = function () {
    var p = new PdfPage();
    this.pages.push(p);
    return p;
  };

  function PdfPage() { this.ops = []; }
  /* All page coordinates are measured from the TOP-left corner, in points. */
  PdfPage.prototype.text = function (x, y, s, o) {
    o = o || {};
    var size = o.size || 10, font = o.font === 'B' ? 'F2' : o.font === 'I' ? 'F3' : 'F1';
    var w = textWidth(s, size, o.font === 'B');
    if (o.align === 'right') x -= w;
    else if (o.align === 'center') x -= w / 2;
    this.ops.push('BT /' + font + ' ' + n2(size) + ' Tf ' + rgb(o.color || '#0f1b2d') + ' rg ' +
      n2(x) + ' ' + n2(PAGE_H - y) + ' Td (' + encode(s) + ') Tj ET');
    return w;
  };
  /* text rotated 90 degrees counter-clockwise (y-axis captions); (x, y) is
     the centre of the caption */
  PdfPage.prototype.textUp = function (x, y, s, o) {
    o = o || {};
    var size = o.size || 9, w = textWidth(s, size, false);
    this.ops.push('BT /F1 ' + n2(size) + ' Tf ' + rgb(o.color || '#46546a') + ' rg 0 1 -1 0 ' +
      n2(x) + ' ' + n2(PAGE_H - y - w / 2) + ' Tm (' + encode(s) + ') Tj ET');
  };
  PdfPage.prototype.stroke = function (o) {
    o = o || {};
    return rgb(o.color || '#0f1b2d') + ' RG ' + n2(o.w || 0.6) + ' w ' +
      (o.dash ? '[' + o.dash.join(' ') + '] 0 d ' : '[] 0 d ');
  };
  PdfPage.prototype.line = function (x1, y1, x2, y2, o) {
    this.ops.push(this.stroke(o) + n2(x1) + ' ' + n2(PAGE_H - y1) + ' m ' + n2(x2) + ' ' + n2(PAGE_H - y2) + ' l S');
  };
  PdfPage.prototype.poly = function (pts, o) {
    if (pts.length < 2) return;
    var s = this.stroke(o) + '1 j 1 J ';
    pts.forEach(function (p, i) { s += n2(p[0]) + ' ' + n2(PAGE_H - p[1]) + (i ? ' l ' : ' m '); });
    this.ops.push(s + 'S 0 j 0 J');
  };
  PdfPage.prototype.rect = function (x, y, w, h, o) {
    o = o || {};
    var r = n2(x) + ' ' + n2(PAGE_H - y - h) + ' ' + n2(w) + ' ' + n2(h) + ' re ';
    if (o.fill && o.stroke) this.ops.push(rgb(o.fill) + ' rg ' + this.stroke({ color: o.stroke, w: o.w }) + r + 'B');
    else if (o.fill) this.ops.push(rgb(o.fill) + ' rg ' + r + 'f');
    else this.ops.push(this.stroke({ color: o.stroke, w: o.w }) + r + 'S');
  };
  PdfPage.prototype.circle = function (cx, cy, r, o) {
    o = o || {};
    var k = 0.5523 * r, y = PAGE_H - cy;
    var path = n2(cx + r) + ' ' + n2(y) + ' m ' +
      n2(cx + r) + ' ' + n2(y + k) + ' ' + n2(cx + k) + ' ' + n2(y + r) + ' ' + n2(cx) + ' ' + n2(y + r) + ' c ' +
      n2(cx - k) + ' ' + n2(y + r) + ' ' + n2(cx - r) + ' ' + n2(y + k) + ' ' + n2(cx - r) + ' ' + n2(y) + ' c ' +
      n2(cx - r) + ' ' + n2(y - k) + ' ' + n2(cx - k) + ' ' + n2(y - r) + ' ' + n2(cx) + ' ' + n2(y - r) + ' c ' +
      n2(cx + k) + ' ' + n2(y - r) + ' ' + n2(cx + r) + ' ' + n2(y - k) + ' ' + n2(cx + r) + ' ' + n2(y) + ' c ';
    this.ops.push(rgb(o.fill || '#ffffff') + ' rg ' + this.stroke({ color: o.stroke || '#0f1b2d', w: o.w || 0.8 }) + path + 'B');
  };
  PdfPage.prototype.clip = function (x, y, w, h) {
    this.ops.push('q ' + n2(x) + ' ' + n2(PAGE_H - y - h) + ' ' + n2(w) + ' ' + n2(h) + ' re W n');
  };
  PdfPage.prototype.unclip = function () { this.ops.push('Q'); };

  function pdfDate(d) {
    function p2(v) { return (v < 10 ? '0' : '') + v; }
    return 'D:' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) +
      p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  }

  /* Serialise the document. Every byte is one character of the string. */
  PdfDoc.prototype.toBytes = function (info) {
    var objs = [], self = this;
    function add(body) { objs.push(body); return objs.length; }
    var catalog = add(null), pagesId = add(null);
    var f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    var f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
    var infoId = add('<< /Title (' + encode(info.title) + ') /Author (' + encode(info.author) + ')' +
      ' /Subject (' + encode(info.subject) + ') /Creator (' + encode(TOOL + ' - ' + AUTHOR) + ')' +
      ' /Producer (' + encode(TOOL) + ') /CreationDate (' + pdfDate(info.date) + ') >>');
    var kids = [];
    self.pages.forEach(function (pg) {
      var content = pg.ops.join('\n');
      var cId = add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      kids.push(add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 ' + PAGE_W + ' ' + PAGE_H + ']' +
        ' /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R /F3 ' + f3 + ' 0 R >> >>' +
        ' /Contents ' + cId + ' 0 R >>'));
    });
    objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
    objs[pagesId - 1] = '<< /Type /Pages /Count ' + kids.length + ' /Kids [' +
      kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] >>';

    var out = '%PDF-1.4\n%âãÏÓ\n', offsets = [];
    objs.forEach(function (body, i) {
      offsets.push(out.length);
      out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { out += ('0000000000' + o).slice(-10) + ' 00000 n \n'; });
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + infoId + ' 0 R >>\n' +
      'startxref\n' + xref + '\n%%EOF\n';
    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  };

  /* ================================================================ *
   * Flow layout: headings, paragraphs, tables, tiles and charts
   * ================================================================ */
  var C = {
    ink: '#0f1b2d', ink2: '#46546a', muted: '#7a8699', rule: '#d5dce6', band: '#f5f7fa',
    accent: '#1f63c6', accentSoft: '#e8f0fb', oil: '#2a78d6', gas: '#eb6834', water: '#1baf7a',
    lab: '#e34948', ok: '#1b8a5a', okSoft: '#e7f5ee', warn: '#b26b00', warnSoft: '#fdf3e1'
  };
  var MARGIN = 46, TOP = 58, BOTTOM = 52, CW = PAGE_W - 2 * MARGIN;

  function Layout(doc, header) {
    this.doc = doc; this.header = header;
    this.page = null; this.y = 0; this.section = 0;
    this.newPage();
  }
  Layout.prototype.newPage = function () {
    this.page = this.doc.addPage();
    this.y = TOP;
    if (this.doc.pages.length > 1) {
      this.page.text(MARGIN, 32, this.header.left, { size: 8, color: C.muted, font: 'B' });
      this.page.text(PAGE_W - MARGIN, 32, this.header.right, { size: 8, color: C.muted, align: 'right' });
      this.page.line(MARGIN, 38, PAGE_W - MARGIN, 38, { color: C.rule, w: 0.5 });
    }
  };
  Layout.prototype.ensure = function (h) {
    if (this.y + h > PAGE_H - BOTTOM) { this.newPage(); return true; }
    return false;
  };
  Layout.prototype.gap = function (h) { this.y += h; };

  /* break a string into lines no wider than w */
  function wrap(s, w, size, bold) {
    var out = [];
    String(s).split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (word) {
        var t = line ? line + ' ' + word : word;
        if (textWidth(t, size, bold) <= w || !line) line = t;
        else { out.push(line); line = word; }
      });
      out.push(line);
    });
    return out;
  }

  Layout.prototype.heading = function (title, o) {
    o = o || {};
    this.ensure(o.keep || 60);
    if (this.y > TOP + 1) this.gap(10);
    this.section++;
    var pg = this.page;
    pg.text(MARGIN, this.y + 13, this.section + '.', { size: 13, font: 'B', color: C.accent });
    pg.text(MARGIN + 20, this.y + 13, title, { size: 13, font: 'B', color: C.ink });
    pg.line(MARGIN, this.y + 20, PAGE_W - MARGIN, this.y + 20, { color: C.accent, w: 0.8 });
    this.y += 30;
  };
  Layout.prototype.subheading = function (title) {
    this.ensure(40);
    this.page.text(MARGIN, this.y + 10, title, { size: 10.5, font: 'B', color: C.ink });
    this.y += 17;
  };
  Layout.prototype.para = function (s, o) {
    o = o || {};
    var size = o.size || 9.5, lh = size * 1.45, x = MARGIN + (o.indent || 0);
    var self = this;
    wrap(s, CW - (o.indent || 0), size, o.font === 'B').forEach(function (ln) {
      self.ensure(lh);
      self.page.text(x, self.y + size, ln, { size: size, color: o.color || C.ink, font: o.font });
      self.y += lh;
    });
    this.y += o.after === undefined ? 5 : o.after;
  };
  Layout.prototype.bullets = function (items, o) {
    o = o || {};
    var size = o.size || 9.5, lh = size * 1.45, self = this;
    items.forEach(function (it) {
      var lines = wrap(it, CW - 14, size, false);
      self.ensure(lh * Math.min(lines.length, 2));
      self.page.text(MARGIN + 3, self.y + size, '•', { size: size, color: C.accent, font: 'B' });
      lines.forEach(function (ln) {
        self.ensure(lh);
        self.page.text(MARGIN + 14, self.y + size, ln, { size: size, color: o.color || C.ink });
        self.y += lh;
      });
      self.y += 2;
    });
    this.y += 4;
  };
  /* a coloured note: kind 'ok' | 'warn' | 'info' */
  Layout.prototype.notice = function (kind, s) {
    var size = 9, lh = size * 1.45;
    var lines = wrap(s, CW - 34, size, false), h = lines.length * lh + 10;
    this.ensure(h + 4);
    var fill = kind === 'ok' ? C.okSoft : kind === 'warn' ? C.warnSoft : C.accentSoft;
    var mark = kind === 'ok' ? C.ok : kind === 'warn' ? C.warn : C.accent;
    var pg = this.page, y0 = this.y;
    pg.rect(MARGIN, y0, CW, h, { fill: fill });
    pg.rect(MARGIN, y0, 3, h, { fill: mark });
    pg.text(MARGIN + 14, y0 + 5 + size, kind === 'ok' ? 'OK' : kind === 'warn' ? '!' : 'i', { size: size, font: 'B', color: mark });
    lines.forEach(function (ln, i) { pg.text(MARGIN + 30, y0 + 5 + size + i * lh, ln, { size: size, color: C.ink }); });
    this.y += h + 5;
  };

  /* Key-result tiles, three to a row. items: [{label, value, unit, hero}] */
  Layout.prototype.tiles = function (items) {
    var cols = 3, gapX = 8, gapY = 8, w = (CW - gapX * (cols - 1)) / cols, h = 46, self = this;
    for (var r = 0; r < items.length; r += cols) {
      this.ensure(h + gapY);
      items.slice(r, r + cols).forEach(function (it, i) {
        var x = MARGIN + i * (w + gapX), y = self.y, pg = self.page;
        pg.rect(x, y, w, h, { fill: it.hero ? C.accentSoft : C.band, stroke: it.hero ? C.accent : C.rule, w: 0.5 });
        pg.text(x + 9, y + 14, it.label, { size: 7.8, color: C.ink2 });
        var vw = pg.text(x + 9, y + 34, it.value, { size: 14, font: 'B', color: it.hero ? C.accent : C.ink });
        if (it.unit) pg.text(x + 13 + vw, y + 34, it.unit, { size: 8, color: C.ink2 });
      });
      this.y += h + gapY;
    }
    this.y += 2;
  };

  /* Table. cols: [{head, w (fraction of the content width), align}];
     a head may carry a second line (the unit) after '\n'. */
  Layout.prototype.table = function (cols, rows, o) {
    o = o || {};
    var size = o.size || 8.6, lh = size * 1.32, pad = 5, self = this;
    var widths = cols.map(function (c) { return c.w * CW; });
    var headLines = Math.max.apply(null, cols.map(function (c) { return String(c.head).split('\n').length; }));
    var headH = headLines * (size + 2) + 8;
    function head() {
      var pg = self.page, x = MARGIN;
      pg.rect(MARGIN, self.y, CW, headH, { fill: C.band });
      pg.line(MARGIN, self.y + headH, PAGE_W - MARGIN, self.y + headH, { color: C.ink2, w: 0.6 });
      cols.forEach(function (c, i) {
        String(c.head).split('\n').forEach(function (t, k) {
          var tx = c.align === 'right' ? x + widths[i] - pad : x + pad;
          pg.text(tx, self.y + 5 + size + k * (size + 2), t,
            { size: k ? size - 1 : size, font: k ? 'R' : 'B', color: k ? C.muted : C.ink, align: c.align === 'right' ? 'right' : 'left' });
        });
        x += widths[i];
      });
      self.y += headH;
    }
    this.ensure(headH + lh * Math.min(rows.length, 3) + 8);
    head();
    rows.forEach(function (row, ri) {
      var cells = row.map(function (v, i) { return wrap(v === null || v === undefined ? '—' : v, widths[i] - 2 * pad, size, false); });
      var n = Math.max.apply(null, cells.map(function (c) { return c.length; }));
      var h = n * lh + 5;
      if (self.ensure(h)) head();
      var pg = self.page, x = MARGIN;
      if (o.highlight && o.highlight(ri)) pg.rect(MARGIN, self.y, CW, h, { fill: C.accentSoft });
      else if (ri % 2) pg.rect(MARGIN, self.y, CW, h, { fill: '#fafbfd' });
      cells.forEach(function (lines, i) {
        var c = cols[i];
        lines.forEach(function (t, k) {
          var tx = c.align === 'right' ? x + widths[i] - pad : x + pad;
          pg.text(tx, self.y + 3 + size + k * lh, t,
            { size: size, color: i === 0 && o.firstMuted ? C.ink2 : C.ink, align: c.align === 'right' ? 'right' : 'left' });
        });
        x += widths[i];
      });
      self.y += h;
      pg.line(MARGIN, self.y, PAGE_W - MARGIN, self.y, { color: C.rule, w: 0.4 });
    });
    this.y += 8;
  };

  /* ---------------- charts ---------------- */
  function niceTicks(lo, hi, count) {
    if (!(hi > lo)) hi = lo + 1;
    var raw = (hi - lo) / Math.max(count, 1);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var out = [];
    for (var v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    out.step = step;
    return out;
  }
  function tickLabel(v, step) {
    if (v === 0) return '0';
    var a = Math.abs(v);
    if (a < 1e-3 || a >= 1e7) return v.toExponential(1);
    var d = Math.max(0, Math.min(6, -Math.floor(Math.log(step) / Math.LN10 + 1e-9)));
    /* a 2.5 step needs one more digit than its magnitude (0.025, not 0.03) */
    while (d < 6 && Math.abs(Number(step.toFixed(d)) - step) > step * 1e-6) d++;
    return v.toFixed(d);
  }

  /* spec = { title, subtitle, xLabel, yLabel, yMinZero, marker: {x, label},
              series: [{ name, color, points: [[x, y]], scatter }] } */
  function drawChart(pg, x, y, w, h, spec) {
    pg.rect(x, y, w, h, { stroke: C.rule, w: 0.5 });
    pg.text(x + 9, y + 15, spec.title, { size: 9.5, font: 'B', color: C.ink });
    if (spec.subtitle) pg.text(x + 9, y + 26, spec.subtitle, { size: 7, color: C.muted });
    var top = y + (spec.subtitle ? 36 : 26);
    var legend = spec.series.length > 1;
    if (legend) {
      var lx = x + 9;
      spec.series.forEach(function (s) {
        if (s.scatter) pg.circle(lx + 5, top + 3, 2.2, { stroke: s.color, w: 0.9 });
        else pg.line(lx, top + 3, lx + 12, top + 3, { color: s.color, w: 1.6 });
        lx += 17 + pg.text(lx + 16, top + 5.6, s.name, { size: 7, color: C.ink2 }) + 10;
      });
      top += 12;
    }
    var L = x + 48, R = x + w - 12, T = top + 4, B = y + h - 30;

    var xs = [], ys = [];
    spec.series.forEach(function (s) { s.points.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    if (!xs.length) return;
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (spec.yMinZero) y0 = Math.min(0, y0);
    var span = y1 - y0 || Math.abs(y1) * 0.1 || 1;
    /* pad the range, but never push a positive property below zero */
    if (!spec.yMinZero || y0 < 0) y0 = y0 >= 0 ? Math.max(0, y0 - span * 0.06) : y0 - span * 0.06;
    y1 += span * 0.06;
    /* pressure axis: from zero (or the first pressure) to the last table
       pressure, ticks inside it; the y axis is extended to whole ticks so
       its frame ends on a labelled value */
    if (x0 > 0 && x0 < 0.15 * (x1 - x0)) x0 = 0;
    var xt = niceTicks(x0, x1, 5), yt = niceTicks(y0, y1, 5);
    if (yt[0] > y0 + yt.step * 1e-9) yt.unshift(yt[0] - yt.step);
    if (yt[yt.length - 1] < y1 - yt.step * 1e-9) yt.push(yt[yt.length - 1] + yt.step);
    y0 = yt[0]; y1 = yt[yt.length - 1];
    if (x1 <= x0) x1 = x0 + 1;
    var sx = function (v) { return L + (v - x0) / (x1 - x0) * (R - L); };
    var sy = function (v) { return B - (v - y0) / (y1 - y0) * (B - T); };

    yt.forEach(function (v) {
      pg.line(L, sy(v), R, sy(v), { color: '#e6eaf0', w: 0.4 });
      pg.text(L - 4, sy(v) + 2.6, tickLabel(v, yt.step), { size: 6.8, color: C.muted, align: 'right' });
    });
    xt.forEach(function (v) {
      pg.line(sx(v), B, sx(v), B + 3, { color: C.ink2, w: 0.5 });
      pg.text(sx(v), B + 11, tickLabel(v, xt.step), { size: 6.8, color: C.muted, align: 'center' });
    });
    pg.line(L, B, R, B, { color: C.ink2, w: 0.6 });
    pg.line(L, T, L, B, { color: C.ink2, w: 0.6 });
    pg.text((L + R) / 2, B + 23, spec.xLabel, { size: 7.4, color: C.ink2, align: 'center' });
    pg.textUp(x + 11, (T + B) / 2, spec.yLabel, { size: 7.4 });

    if (spec.marker && spec.marker.x > x0 && spec.marker.x < x1) {
      var mx = sx(spec.marker.x);
      pg.line(mx, T, mx, B, { color: C.ink2, w: 0.6, dash: [2.5, 2] });
      pg.text(mx + 3, T + 7, spec.marker.label, { size: 7, font: 'B', color: C.ink2 });
    }
    pg.clip(L, T - 2, R - L + 2, B - T + 4);
    spec.series.forEach(function (s) {
      if (s.scatter) return;
      pg.poly(s.points.map(function (p) { return [sx(p[0]), sy(p[1])]; }), { color: s.color, w: 1.5 });
    });
    spec.series.forEach(function (s) {
      if (!s.scatter) return;
      s.points.forEach(function (p) { pg.circle(sx(p[0]), sy(p[1]), 2.4, { stroke: s.color, w: 0.9 }); });
    });
    pg.unclip();
  }

  Layout.prototype.charts = function (specs) {
    var gapX = 10, w = (CW - gapX) / 2, h = 205, self = this;
    for (var i = 0; i < specs.length; i += 2) {
      this.ensure(h + 10);
      specs.slice(i, i + 2).forEach(function (s, k) { drawChart(self.page, MARGIN + k * (w + gapX), self.y, w, h, s); });
      this.y += h + 10;
    }
  };

  /* ================================================================ *
   * Report content
   * ================================================================ */
  function nearestRow(rows, p) {
    var best = rows[0];
    rows.forEach(function (r) { if (Math.abs(r.p - p) < Math.abs(best.p - p)) best = r; });
    return best;
  }
  function satRow(model) {
    var s = model.oil.filter(function (r) { return r.saturated; });
    return s.length ? s[s.length - 1] : model.oil[0];
  }

  /* McCain's field classification from the stock-tank gravity and GOR */
  function oilClass(model) {
    var api = model.input.api;
    if (api < 22.3) return 'heavy oil';
    if (model.rsb >= 1750 || model.bob >= 2) return 'volatile oil';
    return 'black oil';
  }

  function tuningFit(model) {
    var i = model.input, fit = model.tuning && i.tuning && i.tuning.fit;
    if (!fit || !fit.length) return null;
    var n = 0, b = 0, a = 0;
    fit.forEach(function (r) {
      if (isFinite(r.before) && isFinite(r.after)) { n += r.n; b += r.before * r.n; a += r.after * r.n; }
    });
    return n ? { n: n, before: b / n, after: a / n, rows: fit, source: i.tuning.source } : null;
  }

  function v(U, kind, x) { return fx(U[kind].f(x), U[kind].d); }
  function vu(U, kind, x) { return v(U, kind, x) + ' ' + U[kind].u; }

  /* Executive summary, as plain paragraphs. */
  function summary(model, opts) {
    var U = unitSet(opts), i = model.input, c = i.corr, P = [];
    var first = model.fluid === 'gas' ? model.gas : model.oil;
    var pmin = first[0].p, pmax = first[first.length - 1].p;
    var fit = tuningFit(model);

    if (model.fluid === 'gas') {
      var wet = model.gasKind === 'wet', g = model.gas, top = g[g.length - 1];
      P.push('This report documents a black-oil PVT model for a ' + (wet ? 'wet' : 'dry') + ' gas reservoir at ' +
        vu(U, 'T', i.tempF) + '. The separator gas has a gravity of ' + fx(i.gammaG, 3) + ' (air = 1)' +
        (wet ? ', and the well stream carries ' + vu(U, 'cgr', model.cgr) + ' of ' + fx(model.apiC, 1) +
          ' °API condensate, which gives a reservoir-gas gravity of ' + fx(model.gammaW, 3) + '.' : '.') +
        ' Non-hydrocarbons: CO2 ' + fx(i.yCO2 * 100, 1) + '%, H2S ' + fx(i.yH2S * 100, 1) + '%, N2 ' + fx(i.yN2 * 100, 1) + '%.');
      P.push('At the highest table pressure (' + vu(U, 'p', top.p) + ') the gas deviation factor is ' + fx(top.z, 4) +
        ', the gas formation volume factor ' + vu(U, 'bg', top.bg) + ' (expansion factor ' + vu(U, 'eg', top.eg) + '), the viscosity ' +
        vu(U, 'mu', top.mug) + ' and the density ' + vu(U, 'rho', top.rhoG) + '. ' +
        'The gas remains single-phase in the reservoir at every table pressure' + (wet ? '; its liquid drops out at the separator.' : '.'));
      P.push('Tables span ' + vu(U, 'p', pmin) + ' to ' + vu(U, 'p', pmax) + ' in ' + g.length + ' pressure steps, using ' +
        corrName(c.pcrit) + ' pseudo-criticals with the ' + corrName(c.inertCorr) + ' correction, ' + corrName(c.z) +
        ' for z and ' + corrName(c.mug) + ' for the gas viscosity.');
    } else {
      var sr = satRow(model), last = model.oil[model.oil.length - 1], low = model.oil[0];
      var pbNote = i.spec === 'pb'
        ? ' (entered as measured; the solution GOR is back-calculated from it)'
        : (model.pbFactor !== 1 ? ' (calibrated; the correlation alone gives ' + vu(U, 'p', model.pbCalc) + ')' : '');
      P.push('This report documents a black-oil PVT model for an oil reservoir at ' + vu(U, 'T', i.tempF) + '. ' +
        'The stock-tank oil is ' + fx(i.api, 1) + ' °API, classed as a ' + oilClass(model) + ', with a solution-gas gravity of ' +
        fx(i.gammaG, 3) + ' (air = 1) and a solution gas-oil ratio of ' + vu(U, 'rs', model.rsb) + ' at the bubble point.');
      var t = 'The model places the bubble point at ' + vu(U, 'p', model.pb) + pbNote + '. There the oil formation volume factor is ' +
        vu(U, 'bo', model.bob) + ', the oil viscosity ' + vu(U, 'mu', model.muob) + ' and the live-oil density ' + vu(U, 'rho', sr.rhoO) + '.';
      if (last.p > model.pb + 1) {
        t += ' Above it the oil is undersaturated: its compressibility at the bubble point is ' + fx(U.c.f(model.cob), -1) + ' ' + U.c.u +
          ', and Bₒ falls to ' + vu(U, 'bo', last.bo).replace('Bₒ', 'Bo') + ' at ' + vu(U, 'p', last.p) + '.';
      }
      if (low.p < model.pb - 1) {
        t += ' Below it gas leaves solution: at ' + vu(U, 'p', low.p) + ' the solution GOR is ' + vu(U, 'rs', low.rs) +
          ' and the oil viscosity rises to ' + vu(U, 'mu', low.muo) + '.';
      }
      P.push(t.replace(/Bₒ/g, 'Bo'));
      P.push('Tables span ' + vu(U, 'p', pmin) + ' to ' + vu(U, 'p', pmax) + ' in ' + model.oil.length + ' pressure steps. ' +
        'The bubble point and Rs use ' + corrName(c.pb) + ', the saturated Bo ' + corrName(c.bo) + ', the oil viscosity ' +
        corrName(c.muod) + ' (dead oil) and ' + corrName(c.muob) + ' (live oil), and the gas z-factor ' + corrName(c.z) + '.');
    }

    if (fit) {
      P.push('The correlations were tuned to laboratory data' + (fit.source ? ' (' + fit.source + ')' : '') + ': across ' + fit.n +
        ' measured value' + (fit.n === 1 ? '' : 's') + ' the average absolute relative error falls from ' + fx(fit.before, 1) +
        '% with the published correlations to ' + fx(fit.after, 1) + '% after tuning.');
    } else if (model.tuning) {
      P.push('The correlations were tuned to laboratory data; the multipliers are listed in this report.');
    } else {
      P.push('No laboratory data were applied: the tables are correlation estimates. They should be tuned to, or replaced by, a laboratory PVT study ' +
        (model.fluid === 'gas' ? '' : '(CCE, differential liberation and separator tests) ') +
        'before reserves estimation or full-field simulation work.');
    }
    if (!model.warnings.length) {
      P.push('Quality checks: all inputs lie inside the published range of the selected correlations, and the tables pass the monotonicity checks a reservoir simulator applies.');
    } else {
      P.push('Quality checks: ' + model.warnings.length + ' warning' + (model.warnings.length === 1 ? ' was' : 's were') +
        ' raised. ' + (model.warnings.length === 1 ? 'It is' : 'They are') + ' listed in the quality-check section and should be reviewed before the tables are used.');
    }
    return P;
  }

  function keyTiles(model, U) {
    var T = [];
    function t(label, kind, x, hero) { T.push({ label: label, value: v(U, kind, x), unit: U[kind].u, hero: hero }); }
    if (model.fluid === 'gas') {
      var g = model.gas, top = g[g.length - 1], wet = model.gasKind === 'wet';
      T.push({ label: 'Fluid type', value: wet ? 'Wet gas' : 'Dry gas', hero: true });
      T.push({ label: 'z at ' + vu(U, 'p', top.p), value: fx(top.z, 4), unit: '' });
      t('Bg at max pressure', 'bg', top.bg);
      T.push({ label: 'Eg at max pressure', value: fx(top.eg, 1), unit: U.eg.u });
      t('Gas viscosity at max pressure', 'mu', top.mug);
      t('Gas density at max pressure', 'rho', top.rhoG);
      if (wet) {
        t('Condensate-gas ratio', 'cgr', model.cgr);
        T.push({ label: 'Condensate gravity', value: fx(model.apiC, 1), unit: '°API' });
      }
      T.push({ label: 'Reservoir-gas gravity', value: fx(model.gammaW, 4), unit: 'air = 1' });
    } else {
      t('Bubble-point pressure', 'p', model.pb, true);
      t('Solution GOR at Pb', 'rs', model.rsb);
      t('Oil FVF at Pb', 'bo', model.bob);
      t('Oil viscosity at Pb', 'mu', model.muob);
      t('Dead-oil viscosity', 'mu', model.muod);
      t('Oil density at Pb', 'rho', satRow(model).rhoO);
      T.push({ label: 'Oil compressibility at Pb', value: fx(U.c.f(model.cob), -1), unit: U.c.u });
      t('Stock-tank oil density', 'rho', model.rhoOsc);
      T.push({ label: 'Gas Tpc / Ppc', value: fx(model.pcrit.tpc, 0) + ' / ' + fx(model.pcrit.ppc, 0), unit: '°R, psia' });
    }
    return T;
  }

  function inputRows(model, U) {
    var i = model.input, R = [];
    function r(label, kind, x, note) { R.push([label, (kind ? v(U, kind, x) : x) + (note ? '  ' + note : ''), kind ? U[kind].u : '']); }
    if (model.fluid === 'gas') {
      R.push(['Fluid type', model.gasKind === 'wet' ? 'Wet gas' : 'Dry gas', '']);
      r('Reservoir temperature', 'T', i.tempF);
      R.push(['Separator gas gravity', fx(i.gammaG, 4), 'air = 1']);
      if (model.gasKind === 'wet') {
        r('Condensate-gas ratio', 'cgr', model.cgr);
        R.push(['Condensate gravity', fx(model.apiC, 2), '°API']);
        R.push(['Reservoir-gas gravity (recombined)', fx(model.gammaW, 4), 'air = 1']);
      }
    } else {
      r('Reservoir temperature', 'T', i.tempF);
      R.push(['Stock-tank oil gravity', fx(i.api, 2) + '  (SG ' + fx(141.5 / (i.api + 131.5), 4) + ')', '°API']);
      R.push(['Solution gas gravity', fx(i.gammaG, 4), 'air = 1']);
      r('Solution GOR at Pb (Rsb)', 'rs', model.rsb, i.spec === 'pb' ? '(back-calculated)' : '(input)');
      r('Bubble-point pressure', 'p', model.pb, i.spec === 'pb' ? '(measured input)' : '(calculated)');
    }
    r('Separator pressure', 'p', i.pSepPsia);
    r('Separator temperature', 'T', i.tSepF);
    R.push(['Non-hydrocarbons CO2 / H2S / N2', fx(i.yCO2 * 100, 2) + ' / ' + fx(i.yH2S * 100, 2) + ' / ' + fx(i.yN2 * 100, 2), 'mol %']);
    R.push(['Brine salinity', fx(i.salinity * 1e4, 0), 'ppm NaCl']);
    R.push(['Gas pseudo-criticals Tpc / Ppc', fx(model.pcrit.tpc, 1) + ' / ' + fx(model.pcrit.ppc, 1), '°R / psia']);
    var rows = model.fluid === 'gas' ? model.gas : model.oil;
    R.push(['Table pressure range', v(U, 'p', rows[0].p) + ' – ' + v(U, 'p', rows[rows.length - 1].p) + '  (' + rows.length + ' steps)', U.p.u]);
    return R;
  }

  function corrRows(model) {
    var c = model.input.corr, R = [];
    if (model.fluid !== 'gas') {
      R.push(['Bubble point and Rs(p)', corrName(c.pb)], ['Oil FVF, saturated', corrName(c.bo)],
        ['Oil compressibility, undersaturated', corrName(c.co)], ['Dead-oil viscosity', corrName(c.muod)],
        ['Live-oil viscosity, saturated', corrName(c.muob)], ['Oil viscosity, undersaturated', corrName(c.muou)]);
    }
    R.push(['Gas pseudo-critical properties', corrName(c.pcrit) + ' + ' + corrName(c.inertCorr)],
      ['Gas z-factor', corrName(c.z)], ['Gas viscosity', corrName(c.mug)]);
    if (model.fluid === 'gas' && model.gasKind === 'wet') R.push(['Well-stream recombination', 'McCain (1990)']);
    R.push(['Formation water', 'McCain (1991) / Osif (1988)']);
    return R;
  }

  /* chart specifications in report units */
  function chartSpecs(model, U) {
    var gas = model.fluid === 'gas';
    var lab = (model.input.lab && model.input.lab.rows) || [];
    var pLabel = 'Pressure (' + U.p.u + ')';
    var marker = model.psat > 0 ? { x: U.p.f(model.psat), label: 'Pb' } : null;
    function spec(title, sub, src, key, kind, color, labKey, yMinZero) {
      var rows = model[src];
      var conv = kind && kind !== 'eg' ? U[kind].f : ID;
      var s = [{ name: 'Model', color: color, points: rows.map(function (r) { return [U.p.f(r.p), conv(r[key])]; }) }];
      if (labKey) {
        var pts = lab.filter(function (r) { return r.p !== null && r[labKey] !== null && r[labKey] !== undefined && isFinite(r[labKey]); })
          .map(function (r) { return [U.p.f(r.p), conv(r[labKey])]; });
        if (pts.length) s.push({ name: 'Laboratory', color: C.lab, points: pts, scatter: true });
      }
      return { title: title, subtitle: sub, xLabel: pLabel, yLabel: kind === 'eg' ? 'Eg (' + U.eg.u + ')' : (kind ? title.split(' (')[0] + ' (' + U[kind].u + ')' : 'z (–)'),
               series: s, marker: marker, yMinZero: yMinZero };
    }
    if (gas) {
      return [
        spec('Gas deviation factor', 'z-factor of the reservoir gas', 'gas', 'z', null, C.gas, 'z'),
        spec('Gas FVF', 'Reservoir volume per standard volume of separator gas', 'gas', 'bg', 'bg', C.gas),
        spec('Gas viscosity', 'Rises with pressure as the gas densifies', 'gas', 'mug', 'mu', C.gas, 'mug'),
        spec('Gas density', 'Reservoir-condition gas density', 'gas', 'rhoG', 'rho', C.gas),
        spec('Gas compressibility', 'Isothermal compressibility, about 1/p at low pressure', 'gas', 'cg', 'c', C.gas),
        spec('Gas expansion factor', 'Standard volume per reservoir volume', 'gas', 'eg', 'eg', C.gas, null, true),
        spec('Water FVF', 'McCain (1991)', 'water', 'bw', 'bo', C.water),
        spec('Water viscosity', 'Brine viscosity at the stated salinity', 'water', 'muw', 'mu', C.water)
      ];
    }
    return [
      spec('Solution gas-oil ratio', 'Gas dissolved in the oil; constant above Pb', 'oil', 'rs', 'rs', C.oil, 'rs', true),
      spec('Oil FVF', 'Peaks at Pb, then falls as the oil is compressed', 'oil', 'bo', 'bo', C.oil, 'bo'),
      spec('Oil viscosity', 'Minimum at Pb', 'oil', 'muo', 'mu', C.oil, 'muo'),
      spec('Oil density', 'Reservoir-condition live-oil density', 'oil', 'rhoO', 'rho', C.oil),
      spec('Gas deviation factor', 'Liberated gas, from the selected correlation', 'gas', 'z', null, C.gas, 'z'),
      spec('Gas FVF', 'Free gas shrinks sharply as pressure rises', 'gas', 'bg', 'bg', C.gas),
      spec('Gas viscosity', 'Rises monotonically with pressure', 'gas', 'mug', 'mu', C.gas, 'mug'),
      spec('Water FVF', 'McCain (1991)', 'water', 'bw', 'bo', C.water)
    ];
  }

  /* Worked calculations: the relation, the numbers substituted (field
     units, as the correlations are written) and the result. */
  function workedRows(model, U) {
    var i = model.input, R = [], metric = U === UNITS.metric, TR = i.tempF + 459.67;
    function res(kind, x, d) {
      var s = fx(x, d === undefined ? UNITS.field[kind].d : d) + ' ' + UNITS.field[kind].u;
      return metric && UNITS.field[kind].u !== U[kind].u ? s + '  (' + vu(U, kind, x) + ')' : s;
    }
    if (model.fluid === 'gas') {
      var g = model.gas, top = g[g.length - 1], gw = model.gammaW;
      if (model.gasKind === 'wet') {
        R.push(['Reservoir-gas gravity', 'Separator gas recombined with the condensate, McCain (1990), Mo = 5954 / (API − 8.811)', fx(gw, 4)]);
      }
      R.push(['Pseudo-criticals', corrName(i.corr.pcrit) + ' at gravity ' + fx(gw, 4) + ', ' + corrName(i.corr.inertCorr) + ' correction',
        'Tpc ' + fx(model.pcrit.tpc, 1) + ' °R, Ppc ' + fx(model.pcrit.ppc, 1) + ' psia']);
      R.push(['Reduced conditions at max pressure', 'Tpr = (' + fx(i.tempF, 1) + ' + 459.67) / ' + fx(model.pcrit.tpc, 1) + ';  Ppr = ' + fx(top.p, 0) + ' / ' + fx(model.pcrit.ppc, 1),
        'Tpr ' + fx(TR / model.pcrit.tpc, 3) + ', Ppr ' + fx(top.p / model.pcrit.ppc, 3)]);
      R.push(['z-factor at max pressure', corrName(i.corr.z) + ' at (Tpr, Ppr)', fx(top.z, 4)]);
      R.push(['Gas FVF (well stream)', 'Bg = 0.0282793 z T / p = 0.0282793 × ' + fx(top.z, 4) + ' × ' + fx(TR, 2) + ' / ' + fx(top.p, 0), res('bg', top.bgw)]);
      if (model.gasKind === 'wet') R.push(['Gas FVF (separator-gas basis)', 'Bg,sep = Bg × fws, fws = ' + fx(model.fws, 4), res('bg', top.bg)]);
      R.push(['Gas expansion factor', 'Eg = 1 / Bg', fx(top.eg, 1) + ' scf/ft³']);
      R.push(['Gas density at max pressure', 'ρg = 2.69882 g p / (z T) = 2.69882 × ' + fx(gw, 4) + ' × ' + fx(top.p, 0) + ' / (' + fx(top.z, 4) + ' × ' + fx(TR, 2) + ')', res('rho', top.rhoG, 3)]);
      R.push(['Gas viscosity at max pressure', corrName(i.corr.mug), res('mu', top.mug)]);
      return R;
    }
    var sgO = 141.5 / (131.5 + i.api), sr = satRow(model), gpb = nearestRow(model.gas, model.pb), last = model.oil[model.oil.length - 1];
    R.push(['Stock-tank oil specific gravity', 'γo = 141.5 / (131.5 + API) = 141.5 / (131.5 + ' + fx(i.api, 2) + ')', fx(sgO, 4)]);
    R.push(['Stock-tank oil density', 'ρo,sc = 62.428 γo = 62.428 × ' + fx(sgO, 4), res('rho', model.rhoOsc, 3)]);
    if (i.spec === 'pb') {
      R.push(['Bubble-point pressure', 'Measured value entered', res('p', model.pb, 1)]);
      R.push(['Solution GOR at Pb', corrName(i.corr.pb) + ' solved for Rsb at the measured Pb', res('rs', model.rsb)]);
    } else {
      R.push(['Bubble-point pressure', corrName(i.corr.pb) + ': Pb = f(Rsb = ' + fx(model.rsb, 1) + ', γg = ' + fx(i.gammaG, 4) + ', API = ' + fx(i.api, 2) + ', T = ' + fx(i.tempF, 1) + ' °F)' +
        (model.pbFactor !== 1 ? '; correlation ' + fx(model.pbCalc, 1) + ' psia, calibrated' : ''), res('p', model.pb, 1)]);
    }
    R.push(['Oil FVF at Pb', corrName(i.corr.bo) + ': Bob = f(Rsb, γg, γo, T)', res('bo', model.bob)]);
    R.push(['Live-oil density at Pb', 'ρo = (62.428 γo + 0.01357 Rs γg) / Bo = (62.428 × ' + fx(sgO, 4) + ' + 0.01357 × ' + fx(sr.rs, 1) + ' × ' + fx(i.gammaG, 4) + ') / ' + fx(sr.bo, 4), res('rho', sr.rhoO, 3)]);
    R.push(['Dead-oil and live-oil viscosity', corrName(i.corr.muod) + ' (dead oil at T), then ' + corrName(i.corr.muob) + ' with Rsb', 'μod ' + res('mu', model.muod) + ';  μob ' + res('mu', model.muob)]);
    if (last.p > model.pb + 1) {
      R.push(['Undersaturated Bo at max pressure', 'Bo = Bob exp(−∫ co dp) from Pb to ' + fx(last.p, 0) + ' psia, ' + corrName(i.corr.co), res('bo', last.bo)]);
    }
    R.push(['Gas pseudo-criticals', corrName(i.corr.pcrit) + ' at γg = ' + fx(i.gammaG, 4) + ', ' + corrName(i.corr.inertCorr) + ' correction',
      'Tpc ' + fx(model.pcrit.tpc, 1) + ' °R, Ppc ' + fx(model.pcrit.ppc, 1) + ' psia']);
    R.push(['Reduced conditions at Pb', 'Tpr = (' + fx(i.tempF, 1) + ' + 459.67) / ' + fx(model.pcrit.tpc, 1) + ';  Ppr = ' + fx(gpb.p, 0) + ' / ' + fx(model.pcrit.ppc, 1),
      'Tpr ' + fx(TR / model.pcrit.tpc, 3) + ', Ppr ' + fx(gpb.p / model.pcrit.ppc, 3)]);
    R.push(['Gas z-factor at Pb', corrName(i.corr.z), fx(gpb.z, 4)]);
    R.push(['Gas FVF at Pb', 'Bg = 0.0282793 z T / p = 0.0282793 × ' + fx(gpb.z, 4) + ' × ' + fx(TR, 2) + ' / ' + fx(gpb.p, 0), res('bg', gpb.bg)]);
    return R;
  }
  /* WinAnsi has no Greek letters but the micro sign: spell the rest out */
  function greek(s) { return String(s).replace(/γ/g, 'SG').replace(/ρ/g, 'rho').replace(/∫/g, 'integral '); }

  /* the full property table, one row per pressure */
  function propertyTable(model, U) {
    var cols, rows;
    function hd(name, kind) { return name + '\n' + (kind ? U[kind].u : '–'); }
    if (model.fluid === 'gas') {
      cols = [{ head: hd('p', 'p') }, { head: hd('z') }, { head: hd('Bg', 'bg') }, { head: hd('Eg', 'eg') },
        { head: hd('µg', 'mu') }, { head: hd('ρg', 'rho') }, { head: hd('cg', 'c') }, { head: hd('Bw', 'bo') }, { head: hd('µw', 'mu') }];
      rows = model.gas.map(function (g, k) {
        var w = model.water[k];
        return [v(U, 'p', g.p), fx(g.z, 4), v(U, 'bg', g.bg), fx(g.eg, 1), v(U, 'mu', g.mug), v(U, 'rho', g.rhoG),
          fx(U.c.f(g.cg), -1), v(U, 'bo', w.bw), v(U, 'mu', w.muw)];
      });
    } else {
      cols = [{ head: hd('p', 'p') }, { head: hd('Rs', 'rs') }, { head: hd('Bo', 'bo') }, { head: hd('µo', 'mu') },
        { head: hd('ρo', 'rho') }, { head: hd('z') }, { head: hd('Bg', 'bg') }, { head: hd('µg', 'mu') }, { head: hd('Bw', 'bo') }];
      rows = model.oil.map(function (o, k) {
        var g = model.gas[k], w = model.water[k];
        return [v(U, 'p', o.p), v(U, 'rs', o.rs), v(U, 'bo', o.bo), v(U, 'mu', o.muo), v(U, 'rho', o.rhoO),
          fx(g.z, 4), v(U, 'bg', g.bg), v(U, 'mu', g.mug), v(U, 'bo', w.bw)];
      });
    }
    cols = cols.map(function (c) { c.head = c.head.replace(/ρ/g, 'rho '); c.w = 1 / 9; c.align = 'right'; return c; });
    return { cols: cols, rows: rows };
  }

  function methodBullets(model) {
    var B = [];
    if (model.fluid === 'gas') {
      B.push('z-factor from the pseudo-reduced temperature and pressure of the reservoir gas; Bg = 0.0282793 zT/p (ft³/scf, T in °R) and gas density from the real-gas law.',
        'For a wet gas the separator gas is recombined with the condensate to the well-stream gravity; Bg is reported per standard volume of separator gas, the basis a simulator uses.',
        'The reservoir is modelled as single-phase gas at every table pressure. Retrograde gas condensates are out of scope: they need a CCE/CVD study or a compositional model.');
    } else {
      B.push('Pb from Rsb (or Rsb back-solved from a measured Pb); Rs(p) below Pb by numerical inversion of the same equation, so Rs(Pb) = Rsb exactly.',
        'Bo and oil viscosity on the saturated branch from Rs(p); above Pb, Bo = Bob exp(−integral of co dp), integrated by the trapezoid rule, and the oil viscosity from the undersaturated correlation.',
        'Liberated-gas properties from the solution-gas gravity: pseudo-criticals with the non-hydrocarbon correction, z-factor, Bg = 0.0282793 zT/p and the gas viscosity.');
    }
    B.push('Formation-water FVF, viscosity and compressibility from McCain (1991) and Osif (1988) at the stated salinity.',
      'Correlation-based properties are estimates whose uncertainty is the spread between correlations (the Correlation spread tab). Tune the model to, or replace it with, laboratory PVT data before reserves or full-field simulation work.',
      'Tables are checked for the monotonicity a simulator requires; every range and table warning raised is reported in the quality-check section.');
    return B;
  }

  function dateText(d) {
    var m = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return d.getDate() + ' ' + m[d.getMonth()] + ' ' + d.getFullYear();
  }

  function fluidLabel(model) {
    return model.fluid === 'gas' ? (model.gasKind === 'wet' ? 'Wet gas reservoir' : 'Dry gas reservoir') : 'Oil reservoir';
  }

  function withDefaults(opts) {
    opts = opts || {};
    return {
      units: opts.units === 'metric' ? 'metric' : 'field',
      title: (opts.title && String(opts.title).trim()) || 'PVT Study Report',
      project: opts.project ? String(opts.project).trim() : '',
      preparedBy: opts.preparedBy ? String(opts.preparedBy).trim() : '',
      plots: opts.plots !== false, calcs: opts.calcs !== false, method: opts.method !== false,
      now: opts.now instanceof Date ? opts.now : new Date()
    };
  }

  /* ---------------- the report ---------------- */
  function build(model, options) {
    var o = withDefaults(options), U = unitSet(o), doc = new PdfDoc();
    var L = new Layout(doc, { left: o.title + (o.project ? ' – ' + o.project : ''), right: fluidLabel(model) + ' · ' + dateText(o.now) });
    var pg = L.page;

    /* cover band */
    pg.rect(0, 0, PAGE_W, 118, { fill: C.accent });
    pg.rect(MARGIN, 30, 22, 22, { fill: '#ffffff' });
    pg.circle(MARGIN + 11, 44, 5.4, { fill: C.accent, stroke: C.accent, w: 0.1 });
    pg.text(MARGIN + 32, 47, TOOL.toUpperCase(), { size: 8.5, font: 'B', color: '#cfe0f7' });
    pg.text(MARGIN, 82, o.title, { size: 22, font: 'B', color: '#ffffff' });
    pg.text(MARGIN, 102, (o.project ? o.project + '  ·  ' : '') + fluidLabel(model) + ' – black-oil PVT model', { size: 10.5, color: '#e3edfb' });
    var meta = [['Date', dateText(o.now)], ['Units', o.units === 'metric' ? 'Metric' : 'Field'],
      ['Basis', model.tuning ? 'Tuned to laboratory data' : 'Published correlations']];
    if (o.preparedBy) meta.push(['Prepared by', o.preparedBy]);
    var mx = MARGIN;
    meta.forEach(function (m) {
      pg.text(mx, 138, m[0].toUpperCase(), { size: 7, font: 'B', color: C.muted });
      var w = pg.text(mx, 151, m[1], { size: 9.5, color: C.ink });
      mx += Math.max(w, textWidth(m[0].toUpperCase(), 7, true)) + 28;
    });
    pg.line(MARGIN, 162, PAGE_W - MARGIN, 162, { color: C.rule, w: 0.5 });
    L.y = 176;

    /* 1. executive summary */
    L.heading('Executive summary');
    summary(model, o).forEach(function (p) { L.para(p); });
    L.gap(2);
    L.subheading('Key results');
    L.tiles(keyTiles(model, U));

    /* 2. inputs and basis */
    L.heading('Inputs and basis');
    L.table([{ head: 'Parameter', w: 0.42 }, { head: 'Value', w: 0.4 }, { head: 'Unit', w: 0.18 }], inputRows(model, U), { firstMuted: true });
    L.subheading('Correlations');
    L.table([{ head: 'Property', w: 0.42 }, { head: 'Correlation', w: 0.58 }], corrRows(model), { firstMuted: true });

    /* 3. quality checks */
    L.heading('Quality checks', { keep: 80 });
    if (!model.warnings.length) {
      L.notice('ok', 'All inputs lie inside the published range of the selected correlations, and the generated tables pass the monotonicity checks a simulator applies.');
    } else {
      model.warnings.forEach(function (w) { L.notice('warn', w); });
    }

    /* 4. tuning */
    if (model.tuning) {
      var fit = tuningFit(model), t = model.tuning;
      L.heading('Tuning to laboratory data', { keep: 120 });
      if (fit && fit.source) L.para('Source: ' + fit.source + '.', { color: C.ink2 });
      L.para('Each multiplier scales one correlation; 1 is the published correlation. The fit is the average absolute relative error (AARE) against the laboratory values before and after tuning.', { color: C.ink2 });
      var mrows = Object.keys(MULT_NAMES).filter(function (k) { return t[k] !== undefined && t[k] !== 1; })
        .map(function (k) { return [MULT_NAMES[k], '× ' + fx(t[k], 4)]; });
      if (mrows.length) L.table([{ head: 'Tuned property', w: 0.6 }, { head: 'Multiplier', w: 0.4, align: 'right' }], mrows, { firstMuted: true });
      if (fit) {
        L.table([{ head: 'Property', w: 0.46 }, { head: 'Points', w: 0.14, align: 'right' },
          { head: 'AARE untuned\n%', w: 0.2, align: 'right' }, { head: 'AARE tuned\n%', w: 0.2, align: 'right' }],
          fit.rows.map(function (r) { return [r.label, String(r.n), fx(r.before, 2), fx(r.after, 2)]; }), { firstMuted: true });
      }
    }

    /* 5. key plots */
    if (o.plots) {
      L.heading('Key plots', { keep: 260 });
      var hasLab = ((model.input.lab && model.input.lab.rows) || []).length > 0;
      L.para('Properties against pressure' + (model.psat > 0 ? '; the dashed line marks the bubble point' : '') +
        (hasLab ? '. Open circles are the laboratory values entered on the Lab data & tuning tab' : '') + '.', { color: C.ink2, size: 9 });
      L.charts(chartSpecs(model, U));
    }

    /* 6. key calculations */
    if (o.calcs) {
      L.heading('Key calculations', { keep: 140 });
      L.para('The main steps of the calculation with the numbers substituted. The correlations are written in field units (p in psia, T in °F or °R)' +
        (o.units === 'metric' ? '; metric equivalents are shown in brackets' : '') + '.', { color: C.ink2, size: 9 });
      L.table([{ head: 'Quantity', w: 0.25 }, { head: 'Relation and values', w: 0.47 }, { head: 'Result', w: 0.28 }],
        workedRows(model, U).map(function (r) { return r.map(greek); }), { size: 8.2, firstMuted: true });
      L.subheading('PVT property table');
      var pt = propertyTable(model, U), sat = model.psat;
      L.table(pt.cols, pt.rows, {
        size: 7.8,
        highlight: function (ri) { return sat > 0 && model.oil && Math.abs(model.oil[ri].p - sat) < 1e-6; }
      });
      if (model.psat > 0) L.para('The shaded row is the bubble point.', { color: C.muted, size: 8 });
    }

    /* 7. method */
    if (o.method) {
      L.heading('Method and limitations', { keep: 120 });
      L.bullets(methodBullets(model), { size: 9 });
    }

    /* footers, now that the page count is known */
    var n = doc.pages.length;
    doc.pages.forEach(function (p, k) {
      p.line(MARGIN, PAGE_H - 36, PAGE_W - MARGIN, PAGE_H - 36, { color: C.rule, w: 0.5 });
      p.text(MARGIN, PAGE_H - 24, TOOL + ' · ' + COPYRIGHT, { size: 7, color: C.muted });
      p.text(PAGE_W - MARGIN, PAGE_H - 24, 'Page ' + (k + 1) + ' of ' + n, { size: 7, color: C.muted, align: 'right' });
    });

    return doc.toBytes({
      title: o.title + (o.project ? ' - ' + o.project : ''),
      author: o.preparedBy || AUTHOR,
      subject: fluidLabel(model) + ' - black-oil PVT model',
      date: o.now
    });
  }

  /* Plain-text preview for the export panel. */
  function outline(model, options) {
    var o = withDefaults(options), U = unitSet(o), s = 0;
    var L = [o.title.toUpperCase() + (o.project ? '  -  ' + o.project : ''),
      fluidLabel(model) + ' - black-oil PVT model  |  ' + dateText(o.now) + '  |  ' + (o.units === 'metric' ? 'Metric' : 'Field') + ' units' +
        (o.preparedBy ? '  |  Prepared by ' + o.preparedBy : ''), ''];
    function sec(t) { L.push('', (++s) + '. ' + t.toUpperCase()); }
    sec('Executive summary');
    /* the preview is monospaced: wrap the paragraphs at 96 characters */
    summary(model, o).forEach(function (p) {
      var line = '';
      p.split(' ').forEach(function (w) {
        if (line && (line + ' ' + w).length > 96) { L.push(line); line = w; } else line = line ? line + ' ' + w : w;
      });
      L.push(line, '');
    });
    L.push('Key results');
    keyTiles(model, U).forEach(function (t) { L.push('  ' + t.label + ': ' + t.value + (t.unit ? ' ' + t.unit : '')); });
    sec('Inputs and basis');
    L.push('  Inputs table (' + inputRows(model, U).length + ' rows) and the correlations used');
    sec('Quality checks');
    L.push(model.warnings.length ? '  ' + model.warnings.length + ' warning(s)' : '  All checks pass');
    if (model.tuning) { sec('Tuning to laboratory data'); L.push('  Multipliers and the fit before and after tuning'); }
    if (o.plots) {
      sec('Key plots');
      chartSpecs(model, U).forEach(function (c) { L.push('  - ' + c.title + (c.series.length > 1 ? ' (with laboratory points)' : '')); });
    }
    if (o.calcs) {
      sec('Key calculations');
      workedRows(model, U).forEach(function (r) { L.push('  - ' + r[0] + ': ' + r[2]); });
      L.push('  - PVT property table (' + (model.fluid === 'gas' ? model.gas : model.oil).length + ' pressures)');
    }
    if (o.method) sec('Method and limitations');
    L.push('', TOOL + ' - ' + COPYRIGHT);
    return L.join('\n');
  }

  function filename(model, options) {
    var o = withDefaults(options);
    var base = (o.project || 'PVT') + '_report';
    return base.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') + '.pdf';
  }

  return { build: build, summary: summary, outline: outline, filename: filename,
           textWidth: textWidth, wrap: wrap, encode: encode };
});
