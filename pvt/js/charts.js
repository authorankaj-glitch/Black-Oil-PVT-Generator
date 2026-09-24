/*
 * charts.js -- small dependency-free SVG line-chart component.
 *
 * Every chart ships a crosshair + tooltip (pointer and keyboard), a legend
 * when there is more than one series, selective end labels, and hairline
 * gridlines. Series colours come from CSS custom properties so the light and
 * dark palettes swap without re-rendering.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PVTChart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var M = { top: 14, right: 20, bottom: 36, left: 62 };

  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function niceTicks(lo, hi, count) {
    if (!(hi > lo)) { hi = lo + 1; }
    var span = hi - lo;
    var raw = span / Math.max(count, 1);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var start = Math.ceil(lo / step) * step;
    var out = [];
    for (var v = start; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    out.step = step;
    return out;
  }
  /* Tick labels carry only the digits the step actually resolves, so a 200-unit
     step reads "600" rather than "600.00". */
  function fmtTick(v, step) {
    if (v === 0) return '0';
    var a = Math.abs(v);
    if (a < 1e-4 || a >= 1e7) return v.toExponential(1);
    var d = Math.max(0, Math.min(8, -Math.floor(Math.log(step) / Math.LN10 + 1e-9)));
    return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtNum(v) {
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a < 1e-4 || a >= 1e6) return v.toExponential(2);
    if (a < 0.01) return v.toFixed(5);
    if (a < 1) return v.toFixed(4);
    if (a < 10) return v.toFixed(3);
    if (a < 1000) return v.toFixed(2);
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  /*
   * opts = {
   *   title, subtitle, xLabel, yLabel,
   *   series: [{ name, slot (1-8), points: [{x, y}], scatter }],
   *                                  scatter: true draws markers only (laboratory
   *                                  points); the crosshair tooltip follows the
   *                                  line series; dashed: true for a reference
   *                                  curve (the untuned correlation); bold: true
   *                                  and muted: true to single out one curve
   *                                  among several alternatives
   *   marker: { x, label },          vertical annotation (e.g. Pb)
   *   fmtX, fmtY                     value formatters for the tooltip
   * }
   */
  function Chart(container, opts) {
    this.root = container;
    this.opts = opts;
    this.build();
  }

  Chart.prototype.build = function () {
    var o = this.opts, self = this;
    this.root.textContent = '';
    this.root.classList.add('chart');

    var head = document.createElement('div');
    head.className = 'chart-head';
    var h = document.createElement('h3');
    h.textContent = o.title;
    head.appendChild(h);
    if (o.subtitle) {
      var sub = document.createElement('p');
      sub.className = 'chart-sub';
      sub.textContent = o.subtitle;
      head.appendChild(sub);
    }
    this.root.appendChild(head);

    if (o.series.length > 1) {
      var leg = document.createElement('ul');
      leg.className = 'legend';
      o.series.forEach(function (s) {
        var li = document.createElement('li');
        var key = document.createElement('span');
        key.className = 'legend-key slot-' + s.slot + (s.scatter ? ' scatter' : s.dashed ? ' dashed' : '');
        li.appendChild(key);
        var txt = document.createElement('span');
        txt.textContent = s.name;
        li.appendChild(txt);
        leg.appendChild(li);
      });
      this.root.appendChild(leg);
    }

    this.plot = document.createElement('div');
    this.plot.className = 'chart-plot';
    this.root.appendChild(this.plot);

    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.tip.setAttribute('role', 'status');
    this.tip.hidden = true;
    this.plot.appendChild(this.tip);

    this.draw();
    /* redraw on width changes only - the height changes as a result of the
       redraw, so watching it would loop */
    if (window.ResizeObserver) {
      if (this._ro) this._ro.disconnect();
      this._lastW = this.plot.clientWidth;
      this._ro = new ResizeObserver(function () {
        var w = self.plot.clientWidth;
        if (Math.abs(w - self._lastW) < 1) return;
        self._lastW = w;
        self.draw();
      });
      this._ro.observe(this.plot);
    }
  };

  Chart.prototype.draw = function () {
    var o = this.opts, self = this;
    var w = Math.max(this.plot.clientWidth || this.root.clientWidth || 520, 280);
    var hPlot = o.height || 230;
    var h = hPlot + M.top + M.bottom;
    if (this.svg) this.svg.remove();

    var pts = [];
    o.series.forEach(function (s) { s.points.forEach(function (p) { pts.push(p); }); });
    if (!pts.length) return;
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (o.yZero) y0 = Math.min(y0, 0);
    var padY = (y1 - y0) * 0.08 || Math.abs(y1) * 0.08 || 1;
    y0 -= padY; y1 += padY;
    if (o.yMinZero && y0 < 0) y0 = 0;

    var sx = function (v) { return M.left + (v - x0) / (x1 - x0 || 1) * (w - M.left - M.right); };
    var sy = function (v) { return M.top + hPlot - (v - y0) / (y1 - y0 || 1) * hPlot; };
    this._sx = sx; this._sy = sy;

    var svg = el('svg', { width: w, height: h, viewBox: '0 0 ' + w + ' ' + h,
      role: 'img', tabindex: '0',
      'aria-label': o.title + (o.subtitle ? '. ' + o.subtitle : '') });
    this.svg = svg;

    /* gridlines + y ticks */
    var yTicks = niceTicks(y0, y1, 5);
    yTicks.forEach(function (t) {
      svg.appendChild(el('line', { class: 'grid', x1: M.left, x2: w - M.right, y1: sy(t), y2: sy(t) }));
      var lb = el('text', { class: 'tick', x: M.left - 8, y: sy(t) + 4, 'text-anchor': 'end' });
      lb.textContent = fmtTick(t, yTicks.step);
      svg.appendChild(lb);
    });
    /* x ticks + baseline */
    var xTicks = niceTicks(x0, x1, Math.max(3, Math.floor(w / 110)));
    xTicks.forEach(function (t) {
      var lb = el('text', { class: 'tick', x: sx(t), y: M.top + hPlot + 18, 'text-anchor': 'middle' });
      lb.textContent = fmtTick(t, xTicks.step);
      svg.appendChild(lb);
    });
    svg.appendChild(el('line', { class: 'axis', x1: M.left, x2: w - M.right,
      y1: M.top + hPlot, y2: M.top + hPlot }));

    /* axis titles */
    var xt = el('text', { class: 'axis-label', x: (M.left + w - M.right) / 2, y: h - 2, 'text-anchor': 'middle' });
    xt.textContent = o.xLabel;
    svg.appendChild(xt);
    var yt = el('text', { class: 'axis-label', x: 12, y: M.top + hPlot / 2,
      'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (M.top + hPlot / 2) + ')' });
    yt.textContent = o.yLabel;
    svg.appendChild(yt);

    /* bubble-point (or other) annotation */
    if (o.marker && o.marker.x >= x0 && o.marker.x <= x1) {
      svg.appendChild(el('line', { class: 'marker-line', x1: sx(o.marker.x), x2: sx(o.marker.x),
        y1: M.top, y2: M.top + hPlot }));
      var mt = el('text', { class: 'marker-label', x: sx(o.marker.x) + 5, y: M.top + 11 });
      mt.textContent = o.marker.label;
      svg.appendChild(mt);
    }

    /* series: laboratory points as open markers, everything else as lines */
    var lines = o.series.filter(function (s) { return !s.scatter && s.points.length; });
    o.series.forEach(function (s) {
      if (s.scatter) {
        s.points.forEach(function (p) {
          svg.appendChild(el('circle', { class: 'lab-dot slot-' + s.slot,
            cx: sx(p.x), cy: sy(p.y), r: 4.5 }));
        });
        return;
      }
      if (!s.points.length) return;
      var d = s.points.map(function (p, i) {
        return (i ? 'L' : 'M') + sx(p.x).toFixed(2) + ' ' + sy(p.y).toFixed(2);
      }).join(' ');
      svg.appendChild(el('path', { class: 'series-line slot-' + s.slot + (s.dashed ? ' dashed' : '') +
        (s.bold ? ' bold' : '') + (s.muted ? ' muted' : ''), d: d }));
      var last = s.points[s.points.length - 1];
      svg.appendChild(el('circle', { class: 'series-dot slot-' + s.slot,
        cx: sx(last.x), cy: sy(last.y), r: 4 }));
    });

    /* selective end labels: only when they will not collide */
    var ends = lines.map(function (s) {
      var last = s.points[s.points.length - 1];
      return { name: s.name, y: sy(last.y), x: sx(last.x) };
    }).sort(function (a, b) { return a.y - b.y; });
    var collide = false;
    for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) collide = true;
    if (!collide && lines.length <= 4 && o.endLabels !== false) {
      ends.forEach(function (e) {
        var t = el('text', { class: 'end-label', x: e.x - 8, y: e.y - 10, 'text-anchor': 'end' });
        t.textContent = e.name;
        svg.appendChild(t);
      });
    }

    /* hover layer */
    this.cross = el('line', { class: 'crosshair', y1: M.top, y2: M.top + hPlot, x1: -99, x2: -99 });
    svg.appendChild(this.cross);
    this.hoverDots = lines.map(function (s) {
      var c = el('circle', { class: 'hover-dot slot-' + s.slot, r: 4.5, cx: -99, cy: -99 });
      svg.appendChild(c);
      return c;
    });
    var overlay = el('rect', { x: M.left, y: M.top, width: Math.max(w - M.left - M.right, 1),
      height: hPlot, fill: 'transparent', class: 'overlay' });
    svg.appendChild(overlay);

    var idx = -1;
    function show(i, clientX) {
      if (!lines.length) return;
      var base = lines[0].points;
      idx = Math.max(0, Math.min(base.length - 1, i));
      var px = base[idx].x;
      self.cross.setAttribute('x1', sx(px));
      self.cross.setAttribute('x2', sx(px));
      self.tip.textContent = '';
      var head = document.createElement('div');
      head.className = 'tip-head';
      head.textContent = (o.fmtX ? o.fmtX(px) : fmtNum(px)) + ' ' + (o.xUnit || '');
      self.tip.appendChild(head);
      lines.forEach(function (s, k) {
        var p = s.points[Math.min(idx, s.points.length - 1)];
        self.hoverDots[k].setAttribute('cx', sx(p.x));
        self.hoverDots[k].setAttribute('cy', sy(p.y));
        var row = document.createElement('div');
        row.className = 'tip-row';
        var key = document.createElement('span');
        key.className = 'tip-key slot-' + s.slot;
        row.appendChild(key);
        var val = document.createElement('strong');
        val.textContent = o.fmtY ? o.fmtY(p.y) : fmtNum(p.y);
        row.appendChild(val);
        var nm = document.createElement('span');
        nm.className = 'tip-name';
        nm.textContent = s.name;
        row.appendChild(nm);
        self.tip.appendChild(row);
      });
      self.tip.hidden = false;
      var left = sx(px) + 14;
      if (left + 190 > w) left = sx(px) - 190;
      self.tip.style.left = Math.max(4, left) + 'px';
      self.tip.style.top = (M.top + 6) + 'px';
      /* broadcast the hovered x so cursor-linked visuals follow the pointer */
      if (o.onCursor) o.onCursor(px);
    }
    function hide() {
      self.tip.hidden = true;
      self.cross.setAttribute('x1', -99);
      self.cross.setAttribute('x2', -99);
      self.hoverDots.forEach(function (d) { d.setAttribute('cx', -99); });
    }
    function nearest(clientX) {
      var rect = svg.getBoundingClientRect();
      var xv = x0 + (clientX - rect.left - M.left) / Math.max(w - M.left - M.right, 1) * (x1 - x0);
      var base = lines.length ? lines[0].points : [], best = 0, bd = Infinity;
      base.forEach(function (p, i) {
        var d = Math.abs(p.x - xv);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }
    overlay.addEventListener('pointermove', function (ev) { show(nearest(ev.clientX)); });
    overlay.addEventListener('pointerleave', hide);
    svg.addEventListener('focus', function () { show(idx < 0 ? 0 : idx); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight') { show(idx + 1); ev.preventDefault(); }
      else if (ev.key === 'ArrowLeft') { show(idx - 1); ev.preventDefault(); }
      else if (ev.key === 'Escape') { hide(); }
    });

    this.plot.insertBefore(svg, this.tip);
  };

  Chart.prototype.update = function (opts) {
    this.opts = opts;
    this.build();
  };

  return {
    create: function (container, opts) { return new Chart(container, opts); },
    fmtNum: fmtNum, fmtTick: fmtTick, niceTicks: niceTicks
  };
});
