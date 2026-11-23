/*
 * PhaseWiz - Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. PolyForm Noncommercial License 1.0.0 (see LICENSE).
 *
 * compare.js -- side-by-side comparison of PVT reports (the Samples tab).
 *
 * Turns the reports of one fluid system into comparable records: the
 * reservoir-fluid composition in a fixed component order, the key properties
 * of the finalised data, the finalised curves against pressure, and the
 * sampling depth and pressure for trend plots. Which reports take part is
 * the engineer's choice: by default only the accepted reports (step 3 of the
 * PVT reports & QC tab), optionally also reports not yet accepted, and
 * optionally reports that fail QC.
 *
 *   PVTCompare.collect(reports, qcOf, opts) -> { samples, components, excluded }
 *   PVTCompare.trend(points)                -> least-squares line { a, b, r2 }
 *
 * qcOf(rep) returns the report's QC result ({ status, final }), as
 * reports.js / gas-reports.js qcReport does. Field units throughout.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PVTCompare = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ORDER = ['N2', 'CO2', 'H2S', 'C1', 'C2', 'C3', 'iC4', 'nC4', 'iC5', 'nC5', 'C6', 'C7+'];
  var ALIAS = { NC4: 'nC4', IC4: 'iC4', NC5: 'nC5', IC5: 'iC5', C7PLUS: 'C7+', C7: 'C7+' };

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function compName(c) {
    var t = String(c || '').replace(/\s/g, '');
    var u = t.toUpperCase();
    if (ALIAS[u]) return ALIAS[u];
    for (var i = 0; i < ORDER.length; i++) if (ORDER[i].toUpperCase() === u) return ORDER[i];
    return null;
  }

  /* Reservoir-fluid composition in ORDER, mol %, normalised to 100. */
  function composition(fin) {
    var c = fin && fin.composition;
    if (!c || !Array.isArray(c.rows)) return null;
    var z = {}, tot = 0;
    c.rows.forEach(function (r) {
      var k = compName(r.c), v = num(r.z);
      if (!k || v === null || v < 0) return;
      z[k] = (z[k] || 0) + v; tot += v;
    });
    if (!(tot > 0)) return null;
    var out = {};
    ORDER.forEach(function (k) { out[k] = z[k] !== undefined ? 100 * z[k] / tot : 0; });
    return { z: out, mw7: num(c.mw7), sg7: num(c.sg7) };
  }

  /* Value of a finalised column at pressure p (linear between rows). */
  function at(rows, p, key) {
    var pts = rows.filter(function (r) { return num(r[key]) !== null; }).sort(function (a, b) { return a.p - b.p; });
    if (!pts.length || p < pts[0].p || p > pts[pts.length - 1].p) return null;
    for (var i = 1; i < pts.length; i++) {
      if (p <= pts[i].p) {
        var a = pts[i - 1], b = pts[i];
        return a[key] + (b[key] - a[key]) * (p - a.p) / (b.p - a.p || 1);
      }
    }
    return pts[pts.length - 1][key];
  }

  /* One comparable record per report. */
  function record(rep, q) {
    var fin = q && q.final || {}, gas = (rep.fluid || 'oil') === 'gas';
    var rows = (fin.rows || []).filter(function (r) { return num(r.p) !== null; }).slice().sort(function (a, b) { return a.p - b.p; });
    var s = fin.sampling || rep.sampling || {};
    var comp = composition(fin);
    var r = {
      id: rep.id, name: rep.name || 'Report', fluid: gas ? 'gas' : 'oil', type: rep.type || null,
      status: q ? q.status : 'na', accepted: !!rep.final,
      depth: num(s.depth), pRes: num(s.pRes), tempF: num(fin.tempF !== undefined ? fin.tempF : fin.fluid && fin.fluid.tempF),
      composition: comp, scn: null, rows: rows
    };
    if (gas) {
      r.props = {
        gammaG: num(fin.gammaG), cgr: num(fin.cgr), apiC: num(fin.apiC),
        zRes: r.pRes !== null ? at(rows, r.pRes, 'z') : null,
        mugRes: r.pRes !== null ? at(rows, r.pRes, 'mug') : null,
        mw7: comp ? comp.mw7 : null, sg7: comp ? comp.sg7 : null
      };
    } else {
      var f = fin.fluid || {};
      r.tempF = num(f.tempF);
      r.props = {
        pb: num(fin.pb), rsb: num(f.rsb), api: num(f.api), gammaG: num(f.gammaG), bob: num(fin.bob),
        muob: num(fin.pb) !== null ? at(rows, fin.pb, 'muo') : null, muod: num(fin.muod),
        mw7: comp ? comp.mw7 : null, sg7: comp ? comp.sg7 : null,
        mudPct: fin.mud ? 100 * fin.mud.c : null
      };
      /* stock-tank oil by carbon number, when the report carries one */
      var mud = rep.mud && Array.isArray(rep.mud.rows) ? rep.mud.rows.filter(function (q2) { return num(q2.n) !== null && num(q2.w) > 0; }) : [];
      if (mud.length >= 5) r.scn = mud.map(function (q2) { return { n: q2.n, w: q2.w }; }).sort(function (a, b) { return a.n - b.n; });
    }
    return r;
  }

  /*
   * opts = { fluid: 'oil' | 'gas', unaccepted: bool, failed: bool }
   * Accepted reports always take part (unless they fail QC and failed is
   * off); unaccepted ones only when asked. Returns the records, the
   * components that appear in any composition, and the left-out reports
   * with the reason.
   */
  function collect(reports, qcOf, opts) {
    opts = opts || {};
    var fluid = opts.fluid || 'oil', samples = [], excluded = [];
    (reports || []).forEach(function (rep) {
      if ((rep.fluid || 'oil') !== fluid) return;
      var q = null;
      try { q = qcOf(rep); } catch (e) { q = { status: 'fail', final: null }; }
      if (!rep.final && !opts.unaccepted) { excluded.push({ name: rep.name, why: 'not accepted yet' }); return; }
      if (q && q.status === 'fail' && !opts.failed) { excluded.push({ name: rep.name, why: 'fails QC' }); return; }
      var r = record(rep, q);
      if (!r.rows.length && !r.composition) { excluded.push({ name: rep.name, why: 'no finalised data or composition' }); return; }
      samples.push(r);
    });
    var comps = ORDER.filter(function (k) { return samples.some(function (s) { return s.composition && s.composition.z[k] > 0; }); });
    return { samples: samples, components: comps, excluded: excluded };
  }

  /* Least-squares line y = a + b x with R2 (null under 3 points). */
  function trend(points) {
    var p = points.filter(function (q) { return num(q.x) !== null && num(q.y) !== null; });
    if (p.length < 3) return null;
    var n = p.length, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    p.forEach(function (q) { sx += q.x; sy += q.y; sxx += q.x * q.x; sxy += q.x * q.y; syy += q.y * q.y; });
    var d = n * sxx - sx * sx;
    if (!(Math.abs(d) > 1e-12)) return null;
    var b = (n * sxy - sx * sy) / d, a = (sy - b * sx) / n;
    var st = syy - sy * sy / n, sr = 0;
    p.forEach(function (q) { var e = q.y - a - b * q.x; sr += e * e; });
    return { a: a, b: b, r2: st > 0 ? 1 - sr / st : 1, n: n,
             resid: p.map(function (q) { return q.y - a - b * q.x; }), sd: Math.sqrt(sr / Math.max(1, n - 2)) };
  }

  return { ORDER: ORDER, compName: compName, composition: composition, at: at, record: record, collect: collect, trend: trend };
});
