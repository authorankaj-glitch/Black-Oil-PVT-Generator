/*
 * visuals.js -- the two cursor-linked pictures.
 *
 *   Barrel        one stock-tank barrel of oil plus its solution gas, held at
 *                 the cursor pressure: dissolved gas as specks inside the
 *                 liquid, evolved gas as a growing gas cap with rising bubbles.
 *   PhaseDiagram  a schematic pressure-temperature envelope anchored to the
 *                 computed bubble point, with the reservoir isotherm and the
 *                 cursor position on it.
 *
 * Both take pressures in FIELD units and use the caller's fmt/label helpers so
 * the readouts follow the page's unit system. Colours come from CSS custom
 * properties, so the light and dark palettes swap without a re-render.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PVTVisuals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function text(parent, x, y, cls, str, anchor) {
    var t = el('text', { x: x, y: y, class: cls, 'text-anchor': anchor || 'start' });
    t.textContent = str;
    parent.appendChild(t);
    return t;
  }
  function card(host, title, subtitle) {
    host.textContent = '';
    host.classList.add('chart');
    var head = document.createElement('div');
    head.className = 'chart-head';
    var h = document.createElement('h3');
    h.textContent = title;
    head.appendChild(h);
    var sub = document.createElement('p');
    sub.className = 'chart-sub';
    sub.textContent = subtitle;
    head.appendChild(sub);
    host.appendChild(head);
    return head;
  }

  /* ================================================================== *
   * Barrel
   * ================================================================== */
  var BW = 470, BH = 330;                 /* viewBox */
  var X0 = 26, Y0 = 44, BARW = 138, BARH = 232, BULGE = 15, RIM = 13;
  var XL = X0, XR = X0 + BARW, YT = Y0, YB = Y0 + BARH, RX = BARW / 2, CX = X0 + RX;
  var KAPPA = RIM * 1.34;
  var NBUB = 16;

  function bodyPath() {
    return 'M ' + XL + ' ' + YT +
      ' C ' + (XL - BULGE) + ' ' + (YT + 0.3 * BARH) + ' ' + (XL - BULGE) + ' ' + (YT + 0.7 * BARH) + ' ' + XL + ' ' + YB +
      ' C ' + XL + ' ' + (YB + KAPPA) + ' ' + XR + ' ' + (YB + KAPPA) + ' ' + XR + ' ' + YB +
      ' C ' + (XR + BULGE) + ' ' + (YT + 0.7 * BARH) + ' ' + (XR + BULGE) + ' ' + (YT + 0.3 * BARH) + ' ' + XR + ' ' + YT +
      ' C ' + XR + ' ' + (YT - KAPPA) + ' ' + XL + ' ' + (YT - KAPPA) + ' ' + XL + ' ' + YT + ' Z';
  }
  /* front half of the ellipse at height y - the visible meniscus */
  function meniscusPath(y) {
    var w = halfWidth(y);
    return 'M ' + (CX - w) + ' ' + y +
      ' C ' + (CX - w) + ' ' + (y + KAPPA * 0.8) + ' ' + (CX + w) + ' ' + (y + KAPPA * 0.8) + ' ' + (CX + w) + ' ' + y;
  }
  /* the barrel bulges, so the half-width depends on height */
  function halfWidth(y) {
    var f = (y - YT) / BARH;
    return RX + BULGE * 0.75 * Math.sin(Math.PI * Math.max(0, Math.min(1, f)));
  }

  function Barrel(host, opts) {
    this.host = host;
    this.opts = opts;
    this.build();
  }

  Barrel.prototype.build = function () {
    var o = this.opts;
    card(this.host,
      'Gas coming out of solution',
      'One stock-tank barrel of oil with its solution gas, at the cursor pressure');

    var wrap = document.createElement('div');
    wrap.className = 'barrel-wrap';
    this.host.appendChild(wrap);

    var svg = el('svg', { viewBox: '0 0 ' + BW + ' ' + BH, class: 'barrel-svg',
      role: 'img', 'aria-label': 'Barrel showing the oil and free gas split at the cursor pressure' });
    this.svg = svg;
    wrap.appendChild(svg);

    var uid = 'bar' + Math.random().toString(36).slice(2, 8);
    var defs = el('defs');
    var clipBody = el('clipPath', { id: uid + '-body' });
    clipBody.appendChild(el('path', { d: bodyPath() }));
    defs.appendChild(clipBody);
    this.clipOil = el('clipPath', { id: uid + '-oil' });
    this.clipOilRect = el('rect', { x: XL - BULGE - 2, y: YT, width: BARW + 2 * BULGE + 4, height: BARH });
    this.clipOil.appendChild(this.clipOilRect);
    defs.appendChild(this.clipOil);
    svg.appendChild(defs);

    var contents = el('g', { 'clip-path': 'url(#' + uid + '-body)' });
    svg.appendChild(contents);

    this.gasRect = el('rect', { class: 'barrel-gas', x: XL - BULGE - 2, y: YT - KAPPA,
      width: BARW + 2 * BULGE + 4, height: 1 });
    contents.appendChild(this.gasRect);
    this.oilRect = el('rect', { class: 'barrel-oil', x: XL - BULGE - 2, y: YT,
      width: BARW + 2 * BULGE + 4, height: BARH });
    contents.appendChild(this.oilRect);

    /* dissolved gas: specks inside the liquid, thinning as gas comes out */
    var speckG = el('g', { 'clip-path': 'url(#' + uid + '-oil)', class: 'speck-group' });
    this.specks = [];
    var i, seed = 1;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    for (i = 0; i < 38; i++) {
      var sy = YT + 10 + rnd() * (BARH - 16);
      var sw = halfWidth(sy) - 10;
      var c = el('circle', { class: 'speck', cx: CX + (rnd() * 2 - 1) * sw, cy: sy, r: 1.5 + rnd() });
      speckG.appendChild(c);
      this.specks.push(c);
    }
    contents.appendChild(speckG);

    /* free gas in the cap */
    this.clipGas = el('clipPath', { id: uid + '-gas' });
    this.clipGasRect = el('rect', { x: XL - BULGE - 2, y: YT - KAPPA, width: BARW + 2 * BULGE + 4, height: 1 });
    this.clipGas.appendChild(this.clipGasRect);
    defs.appendChild(this.clipGas);
    var gasG = el('g', { 'clip-path': 'url(#' + uid + '-gas)', class: 'gas-specks' });
    for (i = 0; i < 26; i++) {
      var gy = YT + rnd() * BARH;
      var gw = halfWidth(gy) - 12;
      gasG.appendChild(el('circle', { cx: CX + (rnd() * 2 - 1) * gw, cy: gy, r: 1.2 + rnd() * 1.6 }));
    }
    contents.appendChild(gasG);

    /* evolved gas: bubbles rising through the liquid */
    var bubG = el('g', { 'clip-path': 'url(#' + uid + '-oil)', class: 'bubble-group' });
    this.bubbles = [];
    for (i = 0; i < NBUB; i++) {
      var bx = CX + (rnd() * 2 - 1) * (RX - 14);
      var g = el('g', { class: 'bubble', style: 'animation-delay:' + (-rnd() * 5).toFixed(2) + 's;' +
        'animation-duration:' + (3.2 + rnd() * 2.6).toFixed(2) + 's;' +
        '--y:' + (60 + rnd() * 200).toFixed(0) + 'px' });
      g.appendChild(el('circle', { cx: bx, cy: 0, r: 2.2 + rnd() * 3.4 }));
      bubG.appendChild(g);
      this.bubbles.push(g);
    }
    contents.appendChild(bubG);

    this.meniscus = el('path', { class: 'barrel-meniscus', d: meniscusPath(YT) });
    contents.appendChild(this.meniscus);

    /* barrel shell: hoops, then the outline and the open rim */
    var hoops = el('g', { class: 'barrel-hoops', 'clip-path': 'url(#' + uid + '-body)' });
    [0.3, 0.7].forEach(function (f) {
      var y = YT + f * BARH, w = halfWidth(y);
      hoops.appendChild(el('path', { d: 'M ' + (CX - w) + ' ' + y +
        ' C ' + (CX - w) + ' ' + (y + 7) + ' ' + (CX + w) + ' ' + (y + 7) + ' ' + (CX + w) + ' ' + y }));
    });
    svg.appendChild(hoops);
    svg.appendChild(el('path', { class: 'barrel-shell', d: bodyPath() }));
    svg.appendChild(el('ellipse', { class: 'barrel-rim', cx: CX, cy: YT, rx: RX, ry: RIM }));

    /* direct labels for the two phases */
    this.gasLabel = text(svg, XR + BULGE + 16, YT + 18, 'barrel-label', '');
    this.gasSub = text(svg, XR + BULGE + 16, YT + 34, 'barrel-sublabel', '');
    this.oilLabel = text(svg, XR + BULGE + 16, YB - 34, 'barrel-label', '');
    this.oilSub = text(svg, XR + BULGE + 16, YB - 18, 'barrel-sublabel', '');
    this.gasKey = el('rect', { class: 'key-swatch key-gas', x: XR + BULGE + 2, y: YT + 8, width: 8, height: 8, rx: 2 });
    svg.appendChild(this.gasKey);
    this.oilKey = el('rect', { class: 'key-swatch key-oil', x: XR + BULGE + 2, y: YB - 44, width: 8, height: 8, rx: 2 });
    svg.appendChild(this.oilKey);
    this.stateLabel = text(svg, X0, BH - 10, 'barrel-state', '');

    /* numeric readout - the picture never carries a value alone */
    this.read = document.createElement('dl');
    this.read.className = 'readout';
    wrap.appendChild(this.read);
    this.rows = {};
    var self = this;
    [['p', 'Pressure'], ['rs', 'Dissolved gas Rs'], ['free', 'Evolved free gas'],
     ['bo', 'Oil volume Bo'], ['gasv', 'Free gas volume'], ['tot', 'Total cell volume'],
     ['liq', 'Liquid by volume']].forEach(function (r) {
      var dt = document.createElement('dt');
      dt.textContent = r[1];
      var dd = document.createElement('dd');
      self.read.appendChild(dt);
      self.read.appendChild(dd);
      self.rows[r[0]] = dd;
    });
  };

  Barrel.prototype.update = function (p) {
    var o = this.opts, s = o.state(p);
    var gasFrac = Math.max(0, Math.min(1, s.gasFrac));
    var yInt = YT + gasFrac * BARH;

    this.gasRect.setAttribute('y', YT - KAPPA);
    this.gasRect.setAttribute('height', Math.max(yInt - YT + KAPPA, 0.001));
    this.oilRect.setAttribute('y', yInt);
    this.oilRect.setAttribute('height', Math.max(YB - yInt + KAPPA, 0.001));
    this.clipOilRect.setAttribute('y', yInt);
    this.clipOilRect.setAttribute('height', Math.max(YB - yInt + KAPPA, 0.001));
    this.clipGasRect.setAttribute('height', Math.max(yInt - YT + KAPPA, 0.001));
    this.meniscus.setAttribute('d', meniscusPath(yInt));
    this.meniscus.style.opacity = gasFrac > 0.002 ? 1 : 0;

    /* dissolved gas thins out as it leaves solution */
    var dens = Math.max(0, Math.min(1, s.dissolvedFrac));
    this.specks.forEach(function (c, i) {
      c.style.opacity = (i / 38) < dens ? 0.5 : 0;
    });
    /* bubble count tracks how much gas has evolved */
    var nb = Math.round(NBUB * Math.min(1, Math.pow(1 - dens, 0.6)));
    this.bubbles.forEach(function (b, i) { b.style.display = i < nb ? '' : 'none'; });

    var gasPct = (gasFrac * 100), oilPct = (s.liquidFrac * 100);
    this.gasLabel.textContent = 'Free gas  ' + gasPct.toFixed(1) + ' %';
    this.gasSub.textContent = o.fmt('rs', s.freeGasScf) + ' ' + o.label('rs') + ' evolved';
    this.oilLabel.textContent = 'Oil  ' + oilPct.toFixed(1) + ' %';
    this.oilSub.textContent = o.fmt('rs', s.rs) + ' ' + o.label('rs') + ' still dissolved';
    this.gasKey.style.opacity = gasFrac > 0.002 ? 1 : 0.25;
    this.gasLabel.style.opacity = gasFrac > 0.002 ? 1 : 0.45;
    this.gasSub.style.opacity = gasFrac > 0.002 ? 1 : 0.45;
    this.stateLabel.textContent = o.atBubblePoint(p)
      ? 'At Pb — the first bubble of gas is about to appear'
      : (s.saturated
        ? 'Below Pb — saturated: gas is coming out of solution'
        : 'Above Pb — undersaturated: all gas stays dissolved');

    this.rows.p.textContent = o.fmt('p', p) + ' ' + o.label('p');
    this.rows.rs.textContent = o.fmt('rs', s.rs) + ' ' + o.label('rs');
    this.rows.free.textContent = o.fmt('rs', s.freeGasScf) + ' ' + o.label('rs');
    this.rows.bo.textContent = o.fmt('bo', s.oilRb) + ' ' + o.label('bo');
    this.rows.gasv.textContent = o.fmt('bo', s.freeGasRb) + ' ' + o.label('bo');
    this.rows.tot.textContent = o.fmt('bo', s.totalRb) + ' ' + o.label('bo') +
      '   (V/Vb ' + s.relVol.toFixed(2) + ')';
    this.rows.liq.textContent = oilPct.toFixed(1) + ' %';
  };

  /* ================================================================== *
   * Phase diagram
   * ================================================================== */
  var PW = 470, PH = 330, PM = { top: 18, right: 16, bottom: 40, left: 60 };

  function PhaseDiagram(host, opts) {
    this.host = host;
    this.opts = opts;
    this.build();
  }

  PhaseDiagram.prototype.build = function () {
    var o = this.opts, env = o.env, self = this;
    card(this.host, 'Pressure-temperature phase envelope',
      'Schematic envelope anchored to the computed bubble point — a true envelope needs a compositional EOS');

    var wrap = document.createElement('div');
    wrap.className = 'phase-wrap';
    this.host.appendChild(wrap);

    var svg = el('svg', { viewBox: '0 0 ' + PW + ' ' + PH, class: 'phase-svg', tabindex: '0',
      role: 'img', 'aria-label': 'Schematic pressure-temperature phase envelope with the reservoir isotherm' });
    this.svg = svg;
    wrap.appendChild(svg);

    var tPad = (env.tMax - env.tMin) * 0.04;
    var t0 = env.tMin - tPad, t1 = env.tMax + tPad;
    var p1 = env.pMaxPlot;
    var xw = PW - PM.left - PM.right, yh = PH - PM.top - PM.bottom;
    var sx = this.sx = function (t) { return PM.left + (o.convT(t) - o.convT(t0)) / (o.convT(t1) - o.convT(t0) || 1) * xw; };
    var sy = this.sy = function (p) { return PM.top + yh - (p / p1) * yh; };
    this.pTop = p1;

    /* gridlines and ticks */
    /* ticks are generated in display units and placed back through sy() */
    var yTicks = o.ticks(0, o.convP(p1), 5), xTicks = o.ticks(o.convT(t0), o.convT(t1), 5);
    yTicks.forEach(function (v) {
      var yy = sy(o.invP(v));
      if (yy < PM.top - 2 || yy > PM.top + yh + 2) return;
      svg.appendChild(el('line', { class: 'grid', x1: PM.left, x2: PW - PM.right, y1: yy, y2: yy }));
      text(svg, PM.left - 8, yy + 4, 'tick', o.fmtTick(v, yTicks.step), 'end');
    });
    xTicks.forEach(function (v) {
      text(svg, PM.left + (v - o.convT(t0)) / (o.convT(t1) - o.convT(t0) || 1) * xw,
        PM.top + yh + 18, 'tick', o.fmtTick(v, xTicks.step), 'middle');
    });
    svg.appendChild(el('line', { class: 'axis', x1: PM.left, x2: PW - PM.right, y1: PM.top + yh, y2: PM.top + yh }));
    text(svg, PM.left + xw / 2, PH - 6, 'axis-label', 'Temperature (' + o.label('T') + ')', 'middle');
    var yl = text(svg, 14, PM.top + yh / 2, 'axis-label', 'Pressure (' + o.label('p') + ')', 'middle');
    yl.setAttribute('transform', 'rotate(-90 14 ' + (PM.top + yh / 2) + ')');

    /* two-phase region */
    function d(points, move) {
      return points.map(function (q, i) {
        return (i === 0 && move !== false ? 'M' : 'L') + sx(q.t).toFixed(1) + ' ' + sy(q.p).toFixed(1);
      }).join(' ');
    }
    var region = d(env.bubble) + ' ' + d(env.dew, false) + ' Z';
    svg.appendChild(el('path', { class: 'phase-fill', d: region }));

    env.quality.forEach(function (q, i) {
      svg.appendChild(el('path', { class: 'quality-line', d: d(q.points) }));
      /* label near the critical end, where the fan is widest and nothing else sits */
      var at = q.points[Math.round(q.points.length * (0.26 + 0.05 * i))];
      text(svg, sx(at.t) + 4, sy(at.p) + 10, 'quality-label halo-text', (q.q * 100).toFixed(0) + '%');
    });

    svg.appendChild(el('path', { class: 'bubble-line', d: d(env.bubble) }));
    svg.appendChild(el('path', { class: 'dew-line', d: d(env.dew) }));

    /* critical point - label away from the right edge */
    svg.appendChild(el('circle', { class: 'critical-dot', cx: sx(env.tc), cy: sy(env.pc), r: 5 }));
    var cRight = sx(env.tc) > PW * 0.66;
    text(svg, sx(env.tc) + (cRight ? -9 : 9), sy(env.pc) - 8, 'phase-annot halo-text',
      'Critical point', cRight ? 'end' : 'start');

    /* region labels, placed inside the region they name */
    text(svg, PM.left + 10, PM.top + 22, 'region-label halo-text', 'Single-phase liquid');
    text(svg, PM.left + 10, PM.top + 36, 'region-sublabel halo-text', 'undersaturated oil');

    /* the two-phase label sits low and right of the fan, where the isotherm
       callout never reaches */
    var mid = env.quality[1].points[Math.round(env.quality[1].points.length * 0.55)];
    text(svg, sx(mid.t) + 20, sy(mid.p) + 26, 'region-label halo-text', 'Two-phase', 'middle');
    text(svg, sx(mid.t) + 20, sy(mid.p) + 40, 'region-sublabel halo-text', 'oil + free gas', 'middle');

    text(svg, PW - PM.right - 6, sy(0.13 * env.pc), 'region-label halo-text', 'Single-phase gas', 'end');

    /* the reservoir isotherm: the depletion path this model walks down */
    svg.appendChild(el('line', { class: 'isotherm', x1: sx(env.tres), x2: sx(env.tres),
      y1: sy(0), y2: PM.top }));
    text(svg, sx(env.tres) + 5, PM.top + 10, 'phase-annot',
      'Reservoir T = ' + o.fmt('T', env.tres) + ' ' + o.label('T'));

    this.track = el('line', { class: 'isotherm-track', x1: sx(env.tres), x2: sx(env.tres),
      y1: sy(o.pMinTable), y2: sy(o.pMaxTable) });
    svg.appendChild(this.track);
    svg.appendChild(el('circle', { class: 'pb-dot', cx: sx(env.tres), cy: sy(env.pb), r: 4 }));
    text(svg, sx(env.tres) - 8, sy(env.pb) + 4, 'phase-annot', 'Pb', 'end');

    this.halo = el('circle', { class: 'cursor-halo', cx: sx(env.tres), cy: sy(env.pb), r: 11 });
    svg.appendChild(this.halo);
    this.dot = el('circle', { class: 'cursor-dot', cx: sx(env.tres), cy: sy(env.pb), r: 5.5 });
    svg.appendChild(this.dot);
    this.callBg = el('rect', { class: 'cursor-chip', rx: 6, x: -99, y: -99, width: 1, height: 1 });
    svg.appendChild(this.callBg);
    this.cursorLabel = text(svg, sx(env.tres) + 12, sy(env.pb) - 10, 'cursor-label', '');
    this.cursorState = text(svg, sx(env.tres) + 12, sy(env.pb) + 4, 'cursor-sublabel', '');

    /* the diagram is also a control: drag along the isotherm to set pressure */
    var overlay = el('rect', { x: PM.left, y: PM.top, width: xw, height: yh,
      fill: 'transparent', class: 'overlay' });
    svg.appendChild(overlay);
    function fromEvent(ev) {
      var r = svg.getBoundingClientRect();
      var yPix = (ev.clientY - r.top) / r.height * PH;
      var p = (PM.top + yh - yPix) / yh * p1;
      o.onPressure(Math.max(o.pMinTable, Math.min(o.pMaxTable, p)));
    }
    overlay.addEventListener('pointermove', fromEvent);
    overlay.addEventListener('pointerdown', function (ev) { fromEvent(ev); overlay.setPointerCapture(ev.pointerId); });
    svg.addEventListener('keydown', function (ev) {
      var step = (o.pMaxTable - o.pMinTable) / 40;
      if (ev.key === 'ArrowUp') { o.onPressure(Math.min(o.pMaxTable, self._p + step)); ev.preventDefault(); }
      else if (ev.key === 'ArrowDown') { o.onPressure(Math.max(o.pMinTable, self._p - step)); ev.preventDefault(); }
    });

    var legend = document.createElement('ul');
    legend.className = 'legend';
    [['bubble-line', 'Bubble-point line'], ['dew-line', 'Dew-point line'],
     ['quality-line', 'Iso-liquid volume %']].forEach(function (l) {
      var li = document.createElement('li');
      var k = document.createElement('span');
      k.className = 'legend-key key-' + l[0];
      li.appendChild(k);
      var s = document.createElement('span');
      s.textContent = l[1];
      li.appendChild(s);
      legend.appendChild(li);
    });
    this.host.appendChild(legend);

    var note = document.createElement('p');
    note.className = 'hint phase-note';
    note.textContent = 'Classified as a ' + env.fluidType + ': the critical temperature sits about ' +
      o.convDeltaT(env.dT).toFixed(0) + ' ' + o.label('T') + ' above the reservoir temperature.';
    this.host.appendChild(note);
  };

  PhaseDiagram.prototype.update = function (p) {
    var o = this.opts, env = o.env;
    this._p = p;
    var y = this.sy(p), x = this.sx(env.tres);
    this.dot.setAttribute('cy', y);
    this.halo.setAttribute('cy', y);
    var above = p > env.pb + 1e-6;
    /* keep the two-line callout inside the plot at either end of the track */
    var lowEdge = y > PH - PM.bottom - 34;
    var flip = y < PM.top + 40;
    var yTop = flip ? y + 26 : (lowEdge ? y - 26 : y - 12);
    this.cursorLabel.setAttribute('y', yTop);
    this.cursorState.setAttribute('y', yTop + 14);
    this.cursorLabel.textContent = o.fmt('p', p) + ' ' + o.label('p');
    var s = o.state(p);
    this.cursorState.textContent = o.atBubblePoint(p)
      ? 'At the bubble point — first bubble of gas'
      : (above
        ? 'Single phase — undersaturated oil'
        : 'Two phase — ' + (s.liquidFrac * 100).toFixed(0) + '% liquid by volume');
    this.dot.setAttribute('class', 'cursor-dot ' + (above ? 'is-liquid' : 'is-twophase'));
    this.halo.setAttribute('class', 'cursor-halo ' + (above ? 'is-liquid' : 'is-twophase'));

    /* size the chip to the text, and pull the callout left if it would run off */
    try {
      var a = this.cursorLabel.getBBox(), b = this.cursorState.getBBox();
      var w = Math.max(a.width, b.width), left = x + 12;
      if (left + w + 10 > PW - PM.right) {
        left = x - 12 - w;
        this.cursorLabel.setAttribute('text-anchor', 'start');
        this.cursorState.setAttribute('text-anchor', 'start');
      }
      this.cursorLabel.setAttribute('x', left);
      this.cursorState.setAttribute('x', left);
      this.callBg.setAttribute('x', left - 6);
      this.callBg.setAttribute('y', yTop - 13);
      this.callBg.setAttribute('width', w + 12);
      this.callBg.setAttribute('height', 32);
    } catch (e) { /* getBBox is unavailable before layout - the text still shows */ }
  };

  return {
    createBarrel: function (host, opts) { return new Barrel(host, opts); },
    createPhaseDiagram: function (host, opts) { return new PhaseDiagram(host, opts); }
  };
});
