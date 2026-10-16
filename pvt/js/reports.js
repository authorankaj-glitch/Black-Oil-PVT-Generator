/*
 * Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. MIT licence (see LICENSE).
 *
 * reports.js -- raw PVT laboratory tests: quality control, corrections and
 * the finalised data set that the correlation tuning uses.
 *
 * A PVT report rarely arrives in the form a black-oil model needs. The
 * differential liberation (DL) is reported per barrel of residual oil, the
 * separator test describes the surface process, the constant composition
 * expansion (CCE) carries the bubble point and the undersaturated volumes,
 * and the viscosities sit in a table of their own. Before any of it is used
 * to tune a correlation, each test is checked for internal consistency and
 * the DL is converted to the separator (flash) basis a simulator uses.
 *
 * Report (field units throughout; oil density in g/cm3 as laboratories
 * report it):
 *   {
 *     id, fluid: 'oil', name, type: 'bhs' | 'sep', tempF, pbReported,
 *     sampling: { pRes, pwf, gor, depth },
 *     comp:  { rows: [{ c, z, y, x }], mw7, sg7 }
 *            mol % of the reservoir fluid (z), separator gas (y) and
 *            separator liquid (x); C7+ molecular weight and specific gravity
 *     cce:   { rows: [{ p, v, rho, use }] }          v = V / Vsat
 *     dl:    { rows: [{ p, rs, bo, rho, z, gg, use }], apiResidual }
 *            rs scf / bbl residual oil, bo bbl / bbl residual oil, gg the
 *            gravity of the gas liberated at that stage
 *     sep:   { tests: [{ name, api, bofb, stages: [{ p, t, gor, gg }] }], pick }
 *            stage GOR in scf / STB; the last stage is the stock tank
 *     visc:  { rows: [{ p, muo, mug, use }], muod }
 *     settings: { method: 'amyx' | 'ratio' | 'none',
 *                 pbSource: 'cce' | 'dl' | 'report',
 *                 smoothCce: bool, normalise: bool }
 *     final: bool    the engineer has accepted the finalised data
 *   }
 *
 * Checks (status 'pass' | 'warn' | 'fail' | 'na'):
 *   pbAgree    CCE, DL and reported bubble points agree
 *   cceMono    relative volume falls as pressure rises
 *   yFunc      Y = (Pb - p) / [p (V/Vsat - 1)] is a straight line in p
 *              below Pb (Standing, 1977); points off the line are bad
 *              readings, a bend near Pb a mis-picked bubble point
 *   cceCo      undersaturated compressibility from the CCE in a sound range
 *   cceRho     undersaturated densities consistent with rho_b / (V/Vsat)
 *   dlMono     Rsd and Bod fall with pressure, liberated gas gets heavier
 *   dlRho      DL oil density against a stage-by-stage mass balance
 *   dlBt       total FVF rises as pressure falls
 *   sepFlash   flash liberates less gas and shrinks the oil less than DL
 *   sepRho     separator test against the bubble-point density (mass
 *              balance: rho_ob = (350.17 g_o + 0.0764 Rsfb g_g) / 5.615 Bofb)
 *   compSum    composition sums to 100 mol %
 *   compC7     C7+ molecular weight, specific gravity and Watson K plausible
 *   compGas    separator gas gravity from its composition
 *   compPb     bubble point the composition gives (Peng-Robinson, eos.js)
 *              against the measured one: a composition that does not
 *              belong to the sample is 25 % or more out
 *   hoffman    log(K p) linear in the Hoffman characterisation factor
 *              (Hoffman, Crump and Hocott, 1953): separator equilibrium
 *   viscTrend  oil viscosity falls to Pb and rises above it, no point out
 *              of line, dead oil the most viscous
 *   ineq       the finalised Bo and Rs satisfy dBo/dp < Bg dRs/dp below Pb
 *              (a positive total compressibility, which simulators need)
 *
 * Corrections (finalise):
 *   DL -> separator basis below Pb, with f = Bofb / Bodb:
 *     'amyx'   Bo = Bod f,  Rs = Rsfb - (Rsdb - Rsd) f   (Amyx, Bass and
 *              Whiting, 1960; the usual textbook form - it can turn Rs
 *              negative at low pressure, which is clipped and reported)
 *     'ratio'  Bo = Bod f,  Rs = Rsd Rsfb / Rsdb          (keeps Rs >= 0)
 *     'none'   DL values as they are (not the basis a simulator expects)
 *   Above Pb: Bo = (V/Vsat) Bofb, optionally from the fitted (smoothed)
 *   undersaturated volume curve; Rs = Rsfb.
 *   Composition normalised to 100 mol %.
 *   Rows the engineer unticks are left out of every check and the result.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./eos.js'));
  else root.PVTReports = factory(root.PVTEos);
})(typeof self !== 'undefined' ? self : this, function (Eos) {
  'use strict';

  var CHECKS = [
    { key: 'pbAgree', label: 'Bubble point agreement', test: 'pb' },
    { key: 'cceMono', label: 'CCE relative volume trend', test: 'cce' },
    { key: 'yFunc', label: 'CCE Y-function', test: 'cce' },
    { key: 'cceCo', label: 'Undersaturated compressibility', test: 'cce' },
    { key: 'cceRho', label: 'Undersaturated density', test: 'cce' },
    { key: 'dlMono', label: 'Differential liberation trends', test: 'dl' },
    { key: 'dlRho', label: 'DL density mass balance', test: 'dl' },
    { key: 'dlBt', label: 'DL total formation volume factor', test: 'dl' },
    { key: 'sepFlash', label: 'Separator test against DL', test: 'sep' },
    { key: 'sepRho', label: 'Separator test mass balance', test: 'sep' },
    { key: 'compSum', label: 'Composition total', test: 'comp' },
    { key: 'compC7', label: 'C7+ properties', test: 'comp' },
    { key: 'compGas', label: 'Separator gas gravity from composition', test: 'comp' },
    { key: 'compPb', label: 'Bubble point from the composition', test: 'comp' },
    { key: 'hoffman', label: 'Hoffman plot of the separator', test: 'comp' },
    { key: 'viscTrend', label: 'Viscosity trends', test: 'visc' },
    { key: 'ineq', label: 'Bo / Rs thermodynamic consistency', test: 'final' }
  ];
  var RANK = { na: 0, pass: 1, warn: 2, fail: 3 };

  /* Physical constants (field units). */
  var LB_PER_BBL_WATER = 350.17;   /* lb of water per bbl at 60 degF */
  var LB_PER_SCF_AIR = 0.0764;     /* lb of air per scf at 14.7 psia, 60 degF */
  var FT3_PER_BBL = 5.614583;
  var GCC_TO_LBFT3 = 62.428;
  var M_AIR = 28.97;
  var P_ATM_STAGE = 50;            /* psia: a DL stage below this is the atmospheric flash */

  /* Hydrocarbon and non-hydrocarbon components: molecular weight, critical
     temperature (degR), critical pressure (psia) and normal boiling point
     (degR) - GPSA Engineering Data Book values. */
  var COMPONENTS = [
    { c: 'N2', m: 28.013, tc: 227.2, pc: 492.8, tb: 139.3 },
    { c: 'CO2', m: 44.010, tc: 547.4, pc: 1069.5, tb: 350.4 },
    { c: 'H2S', m: 34.082, tc: 672.1, pc: 1300.0, tb: 383.1 },
    { c: 'C1', m: 16.043, tc: 343.0, pc: 667.8, tb: 201.0 },
    { c: 'C2', m: 30.070, tc: 549.8, pc: 707.8, tb: 332.2 },
    { c: 'C3', m: 44.097, tc: 665.7, pc: 616.3, tb: 416.0 },
    { c: 'iC4', m: 58.123, tc: 734.7, pc: 529.1, tb: 470.6 },
    { c: 'nC4', m: 58.123, tc: 765.3, pc: 550.7, tb: 490.8 },
    { c: 'iC5', m: 72.150, tc: 828.8, pc: 490.4, tb: 541.8 },
    { c: 'nC5', m: 72.150, tc: 845.4, pc: 488.6, tb: 556.6 },
    { c: 'C6', m: 86.177, tc: 913.4, pc: 436.9, tb: 615.4 },
    { c: 'C7+', m: null, tc: null, pc: null, tb: null }
  ];
  var COMP_BY = {};
  COMPONENTS.forEach(function (k) { COMP_BY[k.c] = k; });

  /* Table columns (field units). kind is the unit kind the page converts. */
  var COLS = {
    cce: [{ k: 'p', kind: 'p', head: 'Pressure' }, { k: 'v', kind: null, unit: 'V/Vsat', head: 'Relative volume' },
          { k: 'rho', kind: null, unit: 'g/cm³', head: 'Oil density' }],
    dl: [{ k: 'p', kind: 'p', head: 'Pressure' }, { k: 'rs', kind: 'rs', resid: true, head: 'Rsd' }, { k: 'bo', kind: 'bo', resid: true, head: 'Bod' },
         { k: 'rho', kind: null, unit: 'g/cm³', head: 'Oil density' }, { k: 'z', kind: null, unit: '–', head: 'Gas z' },
         { k: 'gg', kind: null, unit: 'air = 1', head: 'Gas gravity' }],
    stage: [{ k: 'p', kind: 'p', head: 'Pressure' }, { k: 't', kind: 'T', head: 'Temperature' },
            { k: 'gor', kind: 'rs', head: 'GOR' }, { k: 'gg', kind: null, unit: 'air = 1', head: 'Gas gravity' }],
    visc: [{ k: 'p', kind: 'p', head: 'Pressure' }, { k: 'muo', kind: 'mu', head: 'Oil viscosity' },
           { k: 'mug', kind: 'mu', head: 'Gas viscosity' }],
    comp: [{ k: 'c', text: true, head: 'Component' }, { k: 'z', kind: null, unit: 'mol %', head: 'Reservoir fluid' },
           { k: 'y', kind: null, unit: 'mol %', head: 'Separator gas' }, { k: 'x', kind: null, unit: 'mol %', head: 'Separator liquid' }]
  };

  /* ------------------------------------------------------------ helpers */

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function used(r) { return r && r.use !== false; }
  function pct(x, d) { return (100 * x).toFixed(d === undefined ? 1 : d) + ' %'; }
  function f0(v) { return Math.round(v).toLocaleString('en-US'); }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : null;
  }
  function worst(list) { return list.reduce(function (a, s) { return RANK[s] > RANK[a] ? s : a; }, 'na'); }
  function gammaO(api) { return 141.5 / (131.5 + api); }
  function newId() { return 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* Least squares y = a + b x; r2 the coefficient of determination. */
  function linFit(pts) {
    var n = pts.length;
    if (n < 2) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    pts.forEach(function (q) { sx += q.x; sy += q.y; sxx += q.x * q.x; sxy += q.x * q.y; syy += q.y * q.y; });
    var d = n * sxx - sx * sx;
    if (!(Math.abs(d) > 0)) return null;
    var b = (n * sxy - sx * sy) / d, a = (sy - b * sx) / n;
    var ssTot = syy - sy * sy / n, ssRes = 0;
    pts.forEach(function (q) { var e = q.y - a - b * q.x; ssRes += e * e; });
    return { a: a, b: b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, n: n };
  }

  /* Theil-Sen line: the median of the pairwise slopes, so a single bad
     reading cannot pull the line towards itself before it is judged. */
  function theilSen(pts) {
    var sl = [];
    for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
      if (pts[j].x !== pts[i].x) sl.push((pts[j].y - pts[i].y) / (pts[j].x - pts[i].x));
    }
    if (!sl.length) return null;
    var b = median(sl);
    return { a: median(pts.map(function (q) { return q.y - b * q.x; })), b: b };
  }

  /* Points whose residual stands out from the rest: robust (MAD) spread,
     and a floor so lab repeatability is not flagged. */
  function outliers(resid, floor, k) {
    var abs = resid.map(Math.abs);
    var s = 1.4826 * median(abs.map(function (v) { return v; }));
    var lim = Math.max((k || 3.5) * s, floor);
    return resid.map(function (e) { return Math.abs(e) > lim; });
  }

  /* ------------------------------------------------------------ the data model */

  function emptyComp() {
    return { rows: COMPONENTS.map(function (k) { return { c: k.c, z: null, y: null, x: null }; }), mw7: null, sg7: null };
  }
  function emptySepTest(name) { return { name: name || 'Test 1', api: null, bofb: null, stages: [] }; }

  function emptyReport(name) {
    return {
      id: newId(), fluid: 'oil', name: name || 'PVT report', type: 'bhs', tempF: null, pbReported: null,
      sampling: { pRes: null, pwf: null, gor: null, depth: null },
      comp: emptyComp(),
      cce: { rows: [] },
      dl: { rows: [], apiResidual: null },
      sep: { tests: [emptySepTest()], pick: 0 },
      visc: { rows: [], muod: null },
      settings: { method: 'amyx', pbSource: 'cce', smoothCce: false, normalise: true },
      final: false
    };
  }

  function cleanRows(rows, keys) {
    return (Array.isArray(rows) ? rows : []).map(function (r) {
      if (Array.isArray(r)) { var o = {}; keys.forEach(function (k, i) { o[k] = r[i]; }); r = o; }
      var out = {};
      keys.forEach(function (k) { out[k] = num(r[k]); });
      out.use = r.use !== false;
      return out;
    });
  }

  /* Make any stored, imported or hand-edited report safe to use. */
  function cleanReport(o) {
    o = o || {};
    var r = emptyReport(String(o.name || 'PVT report').slice(0, 80));
    if (o.id) r.id = String(o.id);
    r.fluid = 'oil';
    r.type = o.type === 'sep' ? 'sep' : 'bhs';
    r.tempF = num(o.tempF); r.pbReported = num(o.pbReported);
    var sm = o.sampling || {};
    r.sampling = { pRes: num(sm.pRes), pwf: num(sm.pwf), gor: num(sm.gor), depth: num(sm.depth) };
    var cp = o.comp || {};
    if (Array.isArray(cp.rows) && cp.rows.length) {
      r.comp.rows = cp.rows.map(function (x) {
        return { c: normComp(x.c) || String(x.c || '').slice(0, 12), z: num(x.z), y: num(x.y), x: num(x.x) };
      });
    }
    r.comp.mw7 = num(cp.mw7); r.comp.sg7 = num(cp.sg7);
    r.cce.rows = cleanRows((o.cce || {}).rows, ['p', 'v', 'rho']);
    r.dl.rows = cleanRows((o.dl || {}).rows, ['p', 'rs', 'bo', 'rho', 'z', 'gg']);
    r.dl.apiResidual = num((o.dl || {}).apiResidual);
    var sp = o.sep || {};
    if (Array.isArray(sp.tests) && sp.tests.length) {
      r.sep.tests = sp.tests.map(function (t, i) {
        return { name: String(t.name || 'Test ' + (i + 1)).slice(0, 60), api: num(t.api), bofb: num(t.bofb),
                 stages: cleanRows(t.stages, ['p', 't', 'gor', 'gg']).map(function (s) { delete s.use; return s; }) };
      });
    }
    r.sep.pick = Math.min(Math.max(0, parseInt(sp.pick, 10) || 0), r.sep.tests.length - 1);
    r.visc.rows = cleanRows((o.visc || {}).rows, ['p', 'muo', 'mug']);
    r.visc.muod = num((o.visc || {}).muod);
    var st = o.settings || {};
    r.settings = {
      method: ['amyx', 'ratio', 'none'].indexOf(st.method) >= 0 ? st.method : 'amyx',
      pbSource: ['cce', 'dl', 'report'].indexOf(st.pbSource) >= 0 ? st.pbSource : 'cce',
      smoothCce: !!st.smoothCce, normalise: st.normalise !== false
    };
    r.final = !!o.final;
    return r;
  }

  /* Component names as laboratories spell them. */
  function normComp(s) {
    var t = String(s || '').replace(/[\s_\-()]/g, '').toUpperCase();
    var map = {
      N2: 'N2', NITROGEN: 'N2', CO2: 'CO2', CARBONDIOXIDE: 'CO2', H2S: 'H2S', HYDROGENSULFIDE: 'H2S', HYDROGENSULPHIDE: 'H2S',
      C1: 'C1', METHANE: 'C1', C2: 'C2', ETHANE: 'C2', C3: 'C3', PROPANE: 'C3',
      IC4: 'iC4', ISOBUTANE: 'iC4', NC4: 'nC4', NBUTANE: 'nC4', IC5: 'iC5', ISOPENTANE: 'iC5', NC5: 'nC5', NPENTANE: 'nC5',
      C6: 'C6', HEXANES: 'C6', HEXANE: 'C6', NC6: 'C6', C7: 'C7+', 'C7+': 'C7+', C7PLUS: 'C7+', HEPTANESPLUS: 'C7+'
    };
    return map[t] || null;
  }

  /* ------------------------------------------------------------ test summaries */

  /* Separator test: Rsfb is the sum of the stage GORs (scf/STB), the gas
     gravity the GOR-weighted average of the stage gases - the total
     surface gas the correlations expect. */
  function sepSummary(t) {
    if (!t) return null;
    var st = (t.stages || []).filter(function (s) { return num(s.gor) !== null; });
    if (!st.length) return null;
    var rs = 0, w = 0, wg = 0;
    st.forEach(function (s) { rs += s.gor; if (num(s.gg) !== null) { w += s.gor; wg += s.gor * s.gg; } });
    var first = st[0];
    return {
      name: t.name, rsfb: rs, gg: w > 0 ? wg / w : null, ggComplete: w > 0 && Math.abs(w - rs) < 1e-9,
      api: num(t.api), bofb: num(t.bofb), pSep: num(first.p), tSep: num(first.t), nStages: st.length
    };
  }

  /* The CCE bubble point: where V/Vsat = 1, interpolated between the
     readings either side of it. */
  function ccePb(rows) {
    var r = rows.filter(function (q) { return used(q) && num(q.p) !== null && num(q.v) !== null; })
      .sort(function (a, b) { return b.p - a.p; });
    if (!r.length) return null;
    /* the reading nearest V/Vsat = 1, not the first one within tolerance:
       a reading just above Pb (V/Vsat 0.9996) must not pass for it */
    var sat = satReading(r);
    if (sat) return sat.p;
    for (var i = 0; i < r.length; i++) {
      if (i && r[i - 1].v < 1 && r[i].v > 1) {
        var a = r[i - 1], b = r[i];
        return a.p + (1 - a.v) * (b.p - a.p) / (b.v - a.v);
      }
    }
    return null;
  }

  /* The CCE reading at saturation: V/Vsat within 5e-4 of 1, the closest
     one when several are. get(o) reads the row from a wrapper. */
  function satReading(list, get) {
    get = get || function (o) { return o; };
    var best = null;
    list.forEach(function (o) {
      var d = Math.abs(get(o).v - 1);
      if (d < 5e-4 && (!best || d < Math.abs(get(best).v - 1))) best = o;
    });
    return best;
  }

  function dlRowsUsed(rep) {
    return rep.dl.rows.filter(function (q) { return used(q) && num(q.p) !== null; })
      .sort(function (a, b) { return b.p - a.p; });
  }
  function dlPb(rep) {
    var r = dlRowsUsed(rep).filter(function (q) { return num(q.rs) !== null; });
    return r.length ? r[0].p : null;
  }

  /* The three bubble points a report can carry. */
  function pbCandidates(rep) {
    return { cce: ccePb(rep.cce.rows), dl: dlPb(rep), report: num(rep.pbReported) };
  }
  function chosenPb(rep) {
    var c = pbCandidates(rep), s = rep.settings.pbSource;
    var order = s === 'cce' ? ['cce', 'dl', 'report'] : s === 'dl' ? ['dl', 'cce', 'report'] : ['report', 'cce', 'dl'];
    for (var i = 0; i < order.length; i++) if (c[order[i]] !== null) return { pb: c[order[i]], from: order[i] };
    return { pb: null, from: null };
  }

  /* ------------------------------------------------------------ CCE */

  /* Y-function below Pb: Y = (Pb - p) / [p (V/Vsat - 1)], a straight line
     in p for a sound test. Returns the fit, per-point residuals and flags,
     and the smoothed relative volume from the fitted line. */
  function yFunction(rows, pb) {
    if (!(pb > 0)) return null;
    var pts = [];
    rows.forEach(function (q, i) {
      if (!used(q) || num(q.p) === null || num(q.v) === null) return;
      if (q.p < pb * 0.999 && q.v > 1) pts.push({ i: i, x: q.p, y: (pb - q.p) / (q.p * (q.v - 1)) });
    });
    if (pts.length < 3) return { pts: pts, fit: null };
    var fit = theilSen(pts) || linFit(pts);
    var resid = pts.map(function (q) { return (q.y - fit.a - fit.b * q.x) / (fit.a + fit.b * q.x); });
    var bad = outliers(resid, 0.03, 3.5);
    fit = linFit(pts);
    /* refit without the outliers, so one bad reading does not bend the line */
    var keep = pts.filter(function (q, k) { return !bad[k]; });
    if (keep.length >= 3 && keep.length < pts.length) {
      fit = linFit(keep);
      resid = pts.map(function (q) { return (q.y - fit.a - fit.b * q.x) / (fit.a + fit.b * q.x); });
      bad = outliers(resid, 0.03, 3.5);
    }
    pts.forEach(function (q, k) { q.resid = resid[k]; q.bad = bad[k]; q.nearPb = q.x > 0.9 * pb; });
    return { pts: pts, fit: fit, vSmooth: function (p) { return 1 + (pb - p) / (p * (fit.a + fit.b * p)); } };
  }

  /* Undersaturated branch: ln(V/Vsat) = a1 (p - Pb) + a2 (p - Pb)^2, fitted
     through V/Vsat = 1 at Pb. co(p) = -(a1 + 2 a2 (p - Pb)). */
  function undersat(rows, pb) {
    if (!(pb > 0)) return null;
    var pts = [];
    rows.forEach(function (q, i) {
      if (!used(q) || num(q.p) === null || num(q.v) === null) return;
      if (q.p > pb * 1.001) pts.push({ i: i, d: q.p - pb, y: Math.log(q.v), p: q.p, v: q.v });
    });
    if (!pts.length) return { pts: pts, a1: null, a2: 0 };
    var a1, a2 = 0;
    if (pts.length >= 3) {
      var s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0;
      pts.forEach(function (q) { var d = q.d, d2 = d * d; s11 += d2; s12 += d2 * d; s22 += d2 * d2; t1 += d * q.y; t2 += d2 * q.y; });
      var det = s11 * s22 - s12 * s12;
      if (Math.abs(det) > 0) { a1 = (t1 * s22 - t2 * s12) / det; a2 = (s11 * t2 - s12 * t1) / det; }
    }
    if (a1 === undefined) {
      var n = 0, d = 0;
      pts.forEach(function (q) { n += q.d * q.y; d += q.d * q.d; });
      a1 = n / d; a2 = 0;
    }
    pts.forEach(function (q) { q.fitV = Math.exp(a1 * q.d + a2 * q.d * q.d); q.resid = q.v / q.fitV - 1; });
    var bad = pts.length >= 4 ? outliers(pts.map(function (q) { return q.resid; }), 0.0015, 3.5) : pts.map(function () { return false; });
    pts.forEach(function (q, k) { q.bad = bad[k]; });
    return {
      pts: pts, a1: a1, a2: a2,
      vAt: function (p) { var dd = p - pb; return Math.exp(a1 * dd + a2 * dd * dd); },
      coAt: function (p) { return -(a1 + 2 * a2 * (p - pb)); }
    };
  }

  /* ------------------------------------------------------------ DL */

  /* Oil density at each DL stage from a mass balance on one barrel of
     residual oil: the residual oil (350.17 g_or lb) plus the gas still in
     solution, which is the gas liberated at every later (lower-pressure)
     stage at that stage's gravity, in Bod barrels. */
  function dlDensity(rep) {
    var r = dlRowsUsed(rep).filter(function (q) { return num(q.rs) !== null && num(q.bo) !== null; });
    var api = num(rep.dl.apiResidual);
    if (!r.length || api === null) return null;
    var gor = gammaO(api), out = [], missing = false;
    var dissolved = new Array(r.length).fill(0);
    for (var k = r.length - 2; k >= 0; k--) {
      var lib = r[k].rs - r[k + 1].rs, gg = num(r[k + 1].gg);
      if (gg === null) { missing = true; gg = NaN; }
      dissolved[k] = dissolved[k + 1] + LB_PER_SCF_AIR * lib * gg;
    }
    /* any gas left at the last stage was never weighed */
    r.forEach(function (q, k) {
      var calc = (LB_PER_BBL_WATER * gor + dissolved[k]) / (FT3_PER_BBL * q.bo) / GCC_TO_LBFT3;
      out.push({ p: q.p, meas: num(q.rho), calc: isFinite(calc) ? calc : null, row: q });
    });
    return { rows: out, missingGg: missing, residualRs: r[r.length - 1].rs };
  }

  /* Bg in bbl/scf from z at T (degF) and p (psia). */
  function bgBbl(z, tempF, p) { return 14.696 / 519.67 * z * (tempF + 459.67) / p / FT3_PER_BBL; }

  /* ------------------------------------------------------------ composition */

  function compRows(rep) { return rep.comp.rows.filter(function (q) { return q.c; }); }

  function compSum(rep, key) {
    var s = 0, n = 0;
    compRows(rep).forEach(function (q) { if (num(q[key]) !== null) { s += q[key]; n++; } });
    return n ? s : null;
  }

  /* Watson characterisation factor from MW and SG (Whitson, 1983). */
  function watsonK(mw, sg) { return 4.5579 * Math.pow(mw, 0.15178) / Math.pow(sg, 0.84573); }

  /* Hoffman, Crump and Hocott (1953): log10(K p) against
     F = b (1/Tb - 1/T), b = log10(Pc/14.7) / (1/Tb - 1/Tc), for the
     separator gas and liquid at separator conditions. */
  function hoffman(rep, pSep, tSep) {
    if (!(pSep > 0) || num(tSep) === null) return null;
    var T = tSep + 459.67, pts = [];
    compRows(rep).forEach(function (q) {
      var k = COMP_BY[normComp(q.c)];
      if (!k || !k.tc || num(q.y) === null || num(q.x) === null || !(q.y > 0) || !(q.x > 0)) return;
      var b = Math.log10(k.pc / 14.7) / (1 / k.tb - 1 / k.tc);
      pts.push({ c: k.c, x: b * (1 / k.tb - 1 / T), y: Math.log10(q.y / q.x * pSep), inert: k.c === 'N2' || k.c === 'CO2' || k.c === 'H2S' });
    });
    /* the Hoffman line is a hydrocarbon correlation: N2, CO2 and H2S are
       plotted but neither fitted nor judged */
    var inert = pts.filter(function (q) { return q.inert; });
    pts = pts.filter(function (q) { return !q.inert; });
    if (pts.length < 4) return { pts: pts, fit: null, inert: inert };
    var fit = theilSen(pts) || linFit(pts);
    var resid = pts.map(function (q) { return q.y - fit.a - fit.b * q.x; });
    var bad = outliers(resid, 0.08, 3.5);
    fit = linFit(pts);
    var keep = pts.filter(function (q, i) { return !bad[i]; });
    if (keep.length >= 4 && keep.length < pts.length) {
      fit = linFit(keep);
      resid = pts.map(function (q) { return q.y - fit.a - fit.b * q.x; });
      bad = outliers(resid, 0.08, 3.5);
    }
    pts.forEach(function (q, i) { q.resid = resid[i]; q.bad = bad[i]; });
    return { pts: pts, fit: fit, inert: inert, r2Keep: linFit(pts.filter(function (q) { return !q.bad; })) };
  }

  function gasGravityFromComp(rep, key) {
    var s = 0, m = 0;
    compRows(rep).forEach(function (q) {
      var v = num(q[key]); if (v === null) return;
      var k = COMP_BY[normComp(q.c)];
      var mw = k && k.m ? k.m : (normComp(q.c) === 'C7+' ? (num(rep.comp.mw7) || 100) : null);
      if (mw === null) return;
      s += v; m += v * mw;
    });
    return s > 0 ? m / s / M_AIR : null;
  }

  /* ------------------------------------------------------------ QC */

  function check(key, status, detail, extra) {
    var def = CHECKS.filter(function (c) { return c.key === key; })[0];
    var o = { key: key, label: def.label, test: def.test, status: status, detail: detail };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  /* The composition handed to the equation of state: reservoir fluid,
     normalised, with the C7+ description. null when incomplete. */
  function eosComposition(rep) {
    var rows = compRows(rep).filter(function (q) { return num(q.z) !== null && q.z > 0; })
      .map(function (q) { return { c: normComp(q.c) || q.c, z: q.z }; });
    var has7 = rows.some(function (q) { return q.c === 'C7+'; });
    if (rows.length < 3 || (has7 && (num(rep.comp.mw7) === null || num(rep.comp.sg7) === null))) return null;
    return { rows: rows, mw7: num(rep.comp.mw7), sg7: num(rep.comp.sg7) };
  }

  /* Bubble point at Tres from the composition alone (default C1 - C7+
     interaction), against the bubble point in use. A Peng-Robinson model
     with a C7+ characterised from MW and SG is good to 10-15 %. */
  var eosCache = {};
  function eosPb(comp, tempF) {
    var key = JSON.stringify([comp, tempF]);
    if (!(key in eosCache)) {
      var mx = Eos.mixture(comp), s = mx ? Eos.satPressure(mx, tempF, 12000) : null;
      eosCache[key] = s;
    }
    return eosCache[key];
  }
  function compPbCheck(rep, pb) {
    var comp = eosComposition(rep), t = num(rep.tempF);
    if (!Eos) return check('compPb', 'na', 'The equation of state is not loaded.');
    if (!comp || t === null || !pb) return check('compPb', 'na', 'Needs the reservoir-fluid composition with the C7+ MW and SG, the temperature and a bubble point.');
    var s = eosPb(comp, t);
    if (!s || s.kind !== 'bubble') {
      return check('compPb', 'warn', 'The composition gives ' + (s ? 'a dew point (' + f0(s.p) + ' psia), not a bubble point,' : 'no saturation pressure') +
        ' at ' + f0(t) + ' °F - it does not describe an oil. Check the C1 and C7+ values and the C7+ MW.');
    }
    var dev = s.p / pb - 1, a = Math.abs(dev);
    return check('compPb', a <= 0.15 ? 'pass' : a <= 0.25 ? 'warn' : 'fail',
      'Peng-Robinson bubble point of the reservoir-fluid composition ' + f0(s.p) + ' psia against ' + f0(pb) + ' psia: ' + pct(dev) + '.' +
      (a <= 0.15 ? ' Within what an untuned equation of state gives; the composition belongs to this sample.' :
        a <= 0.25 ? ' On the edge of what an untuned equation of state gives: check C1, the C7+ fraction and its MW.' :
          ' Too far for the equation of state alone - the composition, the C7+ MW or the bubble point is wrong, or they come from different samples.'),
      { value: dev, eosPb: s.p });
  }

  /* Every check on one report, plus the derived curves the page plots.
     flags: { test, row, text } marks single rows in the editor. */
  function qcReport(rep) {
    rep = cleanReport(rep);
    var out = [], flags = [];
    var pbc = pbCandidates(rep), pick = chosenPb(rep), pb = pick.pb;
    var sep = sepSummary(rep.sep.tests[rep.sep.pick]);
    var dl = dlRowsUsed(rep);
    var dlTop = dl.filter(function (q) { return num(q.rs) !== null; })[0] || null;

    /* ---- bubble points */
    var pbs = [['CCE', pbc.cce], ['DL', pbc.dl], ['reported', pbc.report]].filter(function (x) { return x[1] !== null; });
    if (pbs.length < 2) {
      out.push(check('pbAgree', 'na', pbs.length ? 'Only one bubble point (' + pbs[0][0] + ', ' + f0(pbs[0][1]) +
        ' psia) - nothing to compare it with.' : 'No bubble point yet: enter the CCE, the DL or the reported value.'));
    } else {
      var lo = Math.min.apply(null, pbs.map(function (x) { return x[1]; })), hi = Math.max.apply(null, pbs.map(function (x) { return x[1]; }));
      var spread = (hi - lo) / lo;
      out.push(check('pbAgree', spread <= 0.01 ? 'pass' : spread <= 0.03 ? 'warn' : 'fail',
        pbs.map(function (x) { return x[0] + ' ' + f0(x[1]); }).join(', ') + ' psia: spread ' + pct(spread) +
        (spread <= 0.01 ? '.' : spread <= 0.03 ? '. Check which pressure the DL and the CCE started from.' :
          '. The tests may not be on the same sample, or one was mis-read; pick the source with care.') +
        ' Using ' + pick.from.toUpperCase().replace('REPORT', 'the reported value') + ' (' + f0(pb) + ' psia).', { value: spread }));
    }

    /* ---- CCE */
    var cce = rep.cce.rows.map(function (q, i) { return { q: q, i: i }; })
      .filter(function (o) { return used(o.q) && num(o.q.p) !== null && num(o.q.v) !== null; })
      .sort(function (a, b) { return b.q.p - a.q.p; });
    var yf = null, us = null;
    if (cce.length < 2) {
      ['cceMono', 'yFunc', 'cceCo', 'cceRho'].forEach(function (k) { out.push(check(k, 'na', 'No CCE data.')); });
    } else {
      var rev = [];
      for (var i = 1; i < cce.length; i++) if (cce[i].q.v <= cce[i - 1].q.v) rev.push(cce[i]);
      rev.forEach(function (o) { flags.push({ test: 'cce', row: o.i, text: 'Relative volume does not rise as pressure falls.' }); });
      out.push(check('cceMono', rev.length ? 'fail' : 'pass', rev.length
        ? rev.length + ' reading' + (rev.length > 1 ? 's' : '') + ' where V/Vsat does not grow as pressure falls (' +
          rev.map(function (o) { return f0(o.q.p); }).join(', ') + ' psia) - a typo or a leak.'
        : 'V/Vsat rises steadily as pressure falls.'));

      yf = yFunction(rep.cce.rows, pbc.cce || pb);
      if (!yf || !yf.fit) {
        out.push(check('yFunc', 'na', 'Needs three or more CCE readings below the bubble point.'));
      } else {
        var badY = yf.pts.filter(function (q) { return q.bad; });
        var nearBad = badY.filter(function (q) { return q.nearPb; });
        badY.forEach(function (q) {
          flags.push({ test: 'cce', row: q.i, text: 'Off the Y-function line by ' + pct(q.resid) + (q.nearPb ? ' (near Pb)' : '') + '.' });
        });
        var st = yf.fit.b < 0 ? 'warn' : badY.length > Math.max(1, yf.pts.length / 3) ? 'fail' : badY.length ? 'warn' : yf.fit.r2 >= 0.9 || yf.pts.length < 5 ? 'pass' : 'warn';
        out.push(check('yFunc', st,
          'Y = ' + yf.fit.a.toFixed(3) + ' + ' + yf.fit.b.toExponential(3) + ' p over ' + yf.pts.length + ' points (R² ' + yf.fit.r2.toFixed(3) + ').' +
          (yf.fit.b < 0 ? ' The slope is negative, which a black oil should not show - check the bubble point and the volumes.' : '') +
          (nearBad.length ? ' Points just below Pb leave the line: the bubble point may be mis-picked - check the CCE break.' : '') +
          (badY.length - nearBad.length > 0 ? ' ' + (badY.length - nearBad.length) + ' reading' + (badY.length - nearBad.length > 1 ? 's' : '') +
            ' further from Pb off the line: untick them or correct them.' : '') +
          (!badY.length && yf.fit.b >= 0 ? ' The two-phase readings are consistent with the bubble point.' : ''),
          { value: yf.fit.r2 }));
      }

      us = undersat(rep.cce.rows, pbc.cce || pb);
      if (!us || !us.pts.length) {
        out.push(check('cceCo', 'na', 'No CCE readings above the bubble point.'));
        out.push(check('cceRho', 'na', 'No CCE readings above the bubble point.'));
      } else {
        var hiP = us.pts.reduce(function (a, q) { return Math.max(a, q.p); }, 0);
        var coB = us.coAt(pbc.cce || pb), coH = us.coAt(hiP);
        var coBad = !(coB > 2e-6 && coB < 6e-5) || !(coH > 1e-6 && coH < 6e-5);
        us.pts.filter(function (q) { return q.bad; }).forEach(function (q) {
          flags.push({ test: 'cce', row: q.i, text: 'Off the undersaturated volume curve by ' + pct(q.resid, 2) + '.' });
        });
        var nb = us.pts.filter(function (q) { return q.bad; }).length;
        out.push(check('cceCo', coBad || nb ? 'warn' : 'pass',
          'cₒ ' + coB.toExponential(2) + ' 1/psi at Pb, ' + coH.toExponential(2) + ' at ' + f0(hiP) + ' psia.' +
          (coBad ? ' Outside the usual 2e-6 to 6e-5 1/psi for black oils - check the volumes above Pb.' : '') +
          (nb ? ' ' + nb + ' reading' + (nb > 1 ? 's' : '') + ' off the smooth curve.' : ' The readings follow a smooth curve.'),
          { value: coB }));
        /* density above Pb: mass is conserved, so rho = rho_b / (V/Vsat) */
        var rhoB = null, from = '';
        var atPb = satReading(cce.filter(function (o) { return num(o.q.rho) !== null; }), function (o) { return o.q; });
        if (atPb) { rhoB = atPb.q.rho; from = 'the CCE at Pb'; }
        else if (dlTop && num(dlTop.rho) !== null) { rhoB = dlTop.rho; from = 'the first DL stage'; }
        var dens = us.pts.filter(function (q) { return num(rep.cce.rows[q.i].rho) !== null; });
        if (rhoB === null || !dens.length) {
          out.push(check('cceRho', 'na', 'Needs the oil density at Pb and at least one density above it.'));
        } else {
          var devs = dens.map(function (q) { return { q: q, d: rep.cce.rows[q.i].rho / (rhoB / q.v) - 1 }; });
          var mx = devs.reduce(function (a, o) { return Math.max(a, Math.abs(o.d)); }, 0);
          devs.filter(function (o) { return Math.abs(o.d) > 0.01; }).forEach(function (o) {
            flags.push({ test: 'cce', row: o.q.i, text: 'Density ' + pct(o.d) + ' from ρb / (V/Vsat).' });
          });
          out.push(check('cceRho', mx <= 0.01 ? 'pass' : mx <= 0.03 ? 'warn' : 'fail',
            'Measured densities against ρb / (V/Vsat), ρb ' + rhoB.toFixed(4) + ' g/cm³ from ' + from +
            ': largest difference ' + pct(mx) + '.', { value: mx }));
        }
      }
    }

    /* ---- DL */
    var dlr = dl.filter(function (q) { return num(q.rs) !== null && num(q.bo) !== null; });
    var dlIdx = function (q) { return rep.dl.rows.indexOf(q); };
    var dens = null;
    if (dlr.length < 2) {
      ['dlMono', 'dlRho', 'dlBt'].forEach(function (k) { out.push(check(k, 'na', 'No differential liberation data.')); });
    } else {
      var badRs = [], badBo = [], badGg = [];
      for (var j = 1; j < dlr.length; j++) {
        if (dlr[j].rs >= dlr[j - 1].rs) badRs.push(dlr[j]);
        if (dlr[j].bo >= dlr[j - 1].bo) badBo.push(dlr[j]);
        if (num(dlr[j].gg) !== null && num(dlr[j - 1].gg) !== null && j > 1 && dlr[j].gg < dlr[j - 1].gg - 0.01) badGg.push(dlr[j]);
      }
      badRs.forEach(function (q) { flags.push({ test: 'dl', row: dlIdx(q), text: 'Rsd does not fall with pressure.' }); });
      badBo.forEach(function (q) { flags.push({ test: 'dl', row: dlIdx(q), text: 'Bod does not fall with pressure.' }); });
      badGg.forEach(function (q) { flags.push({ test: 'dl', row: dlIdx(q), text: 'Liberated gas lighter than at the stage before.' }); });
      var zBad = dlr.filter(function (q) { return num(q.z) !== null && !(q.z > 0.3 && q.z < 1.2); });
      zBad.forEach(function (q) { flags.push({ test: 'dl', row: dlIdx(q), text: 'Gas z outside 0.3 - 1.2.' }); });
      var hard = badRs.length + badBo.length;
      out.push(check('dlMono', hard ? 'fail' : badGg.length || zBad.length ? 'warn' : 'pass',
        hard ? (badRs.length ? badRs.length + ' Rsd and ' : '') + (badBo.length ? badBo.length + ' Bod ' : '') +
          'value(s) that do not fall with pressure - a typo, or rows in the wrong order.'
          : (badGg.length ? 'Liberated gas gets lighter at ' + badGg.map(function (q) { return f0(q.p); }).join(', ') +
             ' psia; normally each stage releases heavier gas. ' : '') +
            (zBad.length ? 'Gas z outside 0.3 - 1.2 at ' + zBad.map(function (q) { return f0(q.p); }).join(', ') + ' psia. ' : '') +
            (badGg.length || zBad.length ? '' : 'Rsd and Bod fall steadily, the liberated gas gets heavier stage by stage.')));

      dens = dlDensity(rep);
      if (!dens) {
        out.push(check('dlRho', 'na', 'Enter the residual oil gravity (API at 60 °F) to run the mass balance.'));
      } else {
        var cmp = dens.rows.filter(function (o) { return o.meas !== null && o.calc !== null; });
        if (!cmp.length) {
          out.push(check('dlRho', 'na', dens.missingGg ? 'Needs the gas gravity of every DL stage.' : 'Needs measured DL oil densities.'));
        } else {
          cmp.forEach(function (o) { o.dev = o.meas / o.calc - 1; });
          var mxd = cmp.reduce(function (a, o) { return Math.max(a, Math.abs(o.dev)); }, 0);
          cmp.filter(function (o) { return Math.abs(o.dev) > 0.02; }).forEach(function (o) {
            flags.push({ test: 'dl', row: dlIdx(o.row), text: 'Density ' + pct(o.dev) + ' from the mass balance.' });
          });
          var worstRow = cmp.reduce(function (a, o) { return Math.abs(o.dev) > Math.abs(a.dev) ? o : a; }, cmp[0]);
          out.push(check('dlRho', mxd <= 0.02 ? 'pass' : mxd <= 0.05 ? 'warn' : 'fail',
            'Measured density against the mass of residual oil plus the gas still in solution, stage by stage: ' +
            'largest difference ' + pct(mxd) + ' at ' + f0(worstRow.p) + ' psia.' +
            (mxd > 0.02 ? ' A single stage off is a density or Bod typo; every stage off points to the residual gravity or the gas gravities.' : '') +
            (dens.residualRs > 0.5 ? ' The last stage still holds ' + f0(dens.residualRs) + ' scf/bbl, which the balance cannot weigh.' : ''),
            { value: mxd }));
        }
      }

      var t = num(rep.tempF), rsdb = dlr[0].rs, bt = [];
      if (t === null) out.push(check('dlBt', 'na', 'Needs the reservoir temperature.'));
      else {
        dlr.forEach(function (q) {
          if (num(q.z) !== null && q.p > 20) bt.push({ q: q, p: q.p, bt: q.bo + (rsdb - q.rs) * bgBbl(q.z, t, q.p) });
        });
        if (bt.length < 3) out.push(check('dlBt', 'na', 'Needs the gas z of three or more stages.'));
        else {
          var btBad = [];
          for (var m = 1; m < bt.length; m++) if (bt[m].bt <= bt[m - 1].bt) btBad.push(bt[m]);
          btBad.forEach(function (o) { flags.push({ test: 'dl', row: dlIdx(o.q), text: 'Total FVF falls as pressure falls.' }); });
          out.push(check('dlBt', btBad.length ? 'fail' : 'pass', btBad.length
            ? 'Bt = Bod + (Rsdb - Rsd) Bg falls as pressure falls at ' + btBad.map(function (o) { return f0(o.p); }).join(', ') +
              ' psia: the liberated-gas volume and the oil shrinkage disagree.'
            : 'Bt rises from ' + bt[0].bt.toFixed(3) + ' to ' + bt[bt.length - 1].bt.toFixed(2) + ' bbl/bbl as pressure falls.'));
        }
      }
    }

    /* ---- separator test */
    if (!sep) {
      out.push(check('sepFlash', 'na', 'No separator test: Rs and Bo stay on the DL basis.'));
      out.push(check('sepRho', 'na', 'No separator test.'));
    } else {
      if (!dlTop || num(sep.bofb) === null) {
        out.push(check('sepFlash', 'na', 'Needs Bofb and the DL at the bubble point.'));
      } else {
        var lessGas = sep.rsfb < dlTop.rs, lessShrink = sep.bofb < dlTop.bo;
        out.push(check('sepFlash', lessGas && lessShrink ? 'pass' : 'warn',
          'Rsfb ' + f0(sep.rsfb) + ' scf/STB against Rsdb ' + f0(dlTop.rs) + '; Bofb ' + sep.bofb.toFixed(4) + ' against Bodb ' + dlTop.bo.toFixed(4) + '. ' +
          (lessGas && lessShrink ? 'The flash liberates less gas and shrinks the oil less, as expected; Bofb/Bodb = ' + (sep.bofb / dlTop.bo).toFixed(4) + '.'
            : 'A separator flash normally gives Rsfb < Rsdb and Bofb < Bodb - check the stage GOR basis (per STB) and Bofb.')));
      }
      var rhoOb = null, src = '';
      var cceAtPb = satReading(cce.filter(function (o) { return num(o.q.rho) !== null; }), function (o) { return o.q; });
      if (dlTop && num(dlTop.rho) !== null) { rhoOb = dlTop.rho; src = 'the first DL stage'; }
      else if (cceAtPb) { rhoOb = cceAtPb.q.rho; src = 'the CCE at Pb'; }
      if (rhoOb === null || sep.api === null || sep.bofb === null || sep.gg === null) {
        out.push(check('sepRho', 'na', 'Needs the stock-tank API, Bofb, every stage gas gravity and the oil density at Pb.'));
      } else {
        var calc = (LB_PER_BBL_WATER * gammaO(sep.api) + LB_PER_SCF_AIR * sep.rsfb * sep.gg) / (FT3_PER_BBL * sep.bofb) / GCC_TO_LBFT3;
        var dev = rhoOb / calc - 1;
        out.push(check('sepRho', Math.abs(dev) <= 0.02 ? 'pass' : Math.abs(dev) <= 0.05 ? 'warn' : 'fail',
          'Bubble-point density from the separator test (stock-tank oil plus its gas, in Bofb barrels) ' + calc.toFixed(4) +
          ' g/cm³ against ' + rhoOb.toFixed(4) + ' measured at ' + src + ': ' + pct(dev) + '.' +
          (Math.abs(dev) > 0.02 ? ' Check Bofb, the stage GORs and gravities, and the stock-tank API.' : '') +
          (!sep.ggComplete ? ' Some stages have no gas gravity; the average uses the others.' : ''), { value: dev }));
      }
    }

    /* ---- composition */
    var zs = compSum(rep, 'z');
    if (zs === null) {
      ['compSum', 'compC7', 'compGas', 'compPb', 'hoffman'].forEach(function (k) { out.push(check(k, 'na', 'No composition entered.')); });
    } else {
      var off = Math.abs(zs - 100);
      out.push(check('compSum', off <= 0.5 ? 'pass' : off <= 2 ? 'warn' : 'fail',
        'Reservoir fluid totals ' + zs.toFixed(2) + ' mol %.' +
        (off > 0.5 ? (rep.settings.normalise ? ' Normalised to 100 for the finalised data.' : ' Tick normalise to rescale it.') +
          (off > 2 ? ' A gap this size usually means a missing component.' : '') : ''), { value: zs }));
      var mw7 = num(rep.comp.mw7), sg7 = num(rep.comp.sg7);
      if (mw7 === null || sg7 === null) out.push(check('compC7', 'na', 'Enter the C7+ molecular weight and specific gravity.'));
      else {
        var kw = watsonK(mw7, sg7);
        var okMw = mw7 > 95 && mw7 < 450, okSg = sg7 > 0.72 && sg7 < 1.0, okK = kw > 11.0 && kw < 12.8;
        out.push(check('compC7', okMw && okSg && okK ? 'pass' : 'warn',
          'MW ' + mw7.toFixed(1) + ', SG ' + sg7.toFixed(4) + ', Watson K ' + kw.toFixed(2) + '.' +
          (okK ? '' : ' A Watson K outside 11.0 - 12.8 is unusual for a crude: the MW and SG may not belong together.') +
          (okMw && okSg ? '' : ' MW or SG outside the range of a C7+ fraction.'), { value: kw }));
      }
      var gy = gasGravityFromComp(rep, 'y');
      var stage1 = rep.sep.tests[rep.sep.pick] && rep.sep.tests[rep.sep.pick].stages.filter(function (s) { return num(s.gg) !== null; })[0];
      if (gy === null || !stage1) out.push(check('compGas', 'na', 'Needs the separator gas composition and the first-stage gas gravity.'));
      else {
        var dg = gy / stage1.gg - 1;
        out.push(check('compGas', Math.abs(dg) <= 0.03 ? 'pass' : Math.abs(dg) <= 0.06 ? 'warn' : 'fail',
          'Gravity of the separator gas from its composition ' + gy.toFixed(3) + ' against ' + stage1.gg.toFixed(3) + ' measured: ' + pct(dg) + '.', { value: dg }));
      }
      var hf = sep ? hoffman(rep, sep.pSep, sep.tSep) : null;
      if (!hf || !hf.fit) {
        out.push(check('hoffman', 'na', 'Needs the separator gas and liquid compositions (four or more components) and the separator conditions.'));
      } else {
        var hb = hf.pts.filter(function (q) { return q.bad; });
        var r2 = hf.fit.r2;
        out.push(check('hoffman', hb.length > 1 || r2 < 0.9 ? 'fail' : hb.length || r2 < 0.98 ? 'warn' : 'pass',
          'log(K p) against the characterisation factor over ' + hf.pts.length + ' hydrocarbons: R² ' + r2.toFixed(3) + '.' +
          (hb.length ? ' Off the line: ' + hb.map(function (q) { return q.c; }).join(', ') + ', an analysis error in the gas or the liquid.' : '') +
          (r2 >= 0.98 && !hb.length ? ' The separator gas and liquid were in equilibrium; the recombination base is sound.' :
            r2 < 0.9 ? ' The separator samples were not in equilibrium (carry-over or a leak), so a recombination built on them is suspect.' : ''),
          { value: r2 }));
      }
      out.push(compPbCheck(rep, pb));
    }

    /* ---- viscosity */
    var vr = rep.visc.rows.map(function (q, i) { return { q: q, i: i }; })
      .filter(function (o) { return used(o.q) && num(o.q.p) !== null && num(o.q.muo) !== null; })
      .sort(function (a, b) { return b.q.p - a.q.p; });
    if (vr.length < 2) out.push(check('viscTrend', 'na', 'No oil viscosity data.'));
    else {
      var vb = [], vMsg = [];
      if (pb) {
        for (var a = 1; a < vr.length; a++) {
          var hiQ = vr[a - 1].q, loQ = vr[a].q;
          if (loQ.p >= pb * 0.999 && loQ.muo > hiQ.muo + 1e-9) vb.push(vr[a]);       /* above Pb: falls with p falling */
          if (hiQ.p <= pb * 1.001 && loQ.muo < hiQ.muo - 1e-9) vb.push(vr[a]);       /* below Pb: rises with p falling */
        }
      }
      vb.forEach(function (o) { flags.push({ test: 'visc', row: o.i, text: 'Against the expected viscosity trend.' }); });
      /* a point out of line with its neighbours on the same branch (ln mu linear in p) */
      var jumps = [], devV = vr.map(function () { return 0; });
      for (var b = 1; b < vr.length - 1; b++) {
        var A = vr[b - 1].q, B = vr[b].q, Cq = vr[b + 1].q;
        if (pb && (A.p > pb * 1.001) !== (Cq.p > pb * 1.001)) continue;
        var w = (B.p - Cq.p) / (A.p - Cq.p), pred = Math.exp(Math.log(Cq.muo) + w * (Math.log(A.muo) - Math.log(Cq.muo)));
        devV[b] = Math.abs(B.muo / pred - 1);
      }
      /* a bad reading also throws its neighbours' predictions: flag only the worst of a run */
      for (var b2 = 1; b2 < vr.length - 1; b2++) {
        if (devV[b2] > 0.12 && devV[b2] >= devV[b2 - 1] && devV[b2] >= devV[b2 + 1]) jumps.push(vr[b2]);
      }
      jumps.forEach(function (o) { if (vb.indexOf(o) < 0) flags.push({ test: 'visc', row: o.i, text: 'Out of line with its neighbours.' }); });
      if (vb.length) vMsg.push(vb.length + ' reading' + (vb.length > 1 ? 's' : '') + ' against the trend (oil viscosity should fall to Pb and rise above it)');
      if (jumps.length) vMsg.push('out of line with neighbours at ' + jumps.map(function (o) { return f0(o.q.p); }).join(', ') + ' psia');
      var muod = num(rep.visc.muod), lowest = vr[vr.length - 1].q;
      if (muod !== null && muod < lowest.muo) vMsg.push('dead-oil viscosity ' + muod.toFixed(3) + ' cp is below the live oil at ' + f0(lowest.p) + ' psia');
      out.push(check('viscTrend', vb.length ? 'fail' : vMsg.length ? 'warn' : 'pass',
        vMsg.length ? vMsg.join('; ') + '.' : 'Oil viscosity falls to a minimum at Pb and rises above it' + (muod !== null ? '; dead oil is the most viscous.' : '.')));
    }

    /* ---- finalised data: Bo / Rs consistency below Pb */
    var fin = finalise(rep);
    var ineq = consistency(fin, rep.tempF);
    out.push(ineq);

    return { checks: out, flags: flags, pb: pick, pbCandidates: pbc, sep: sep, yFunc: yf, undersat: us,
             density: dens, hoffman: sep ? hoffman(rep, sep.pSep, sep.tSep) : null, final: fin,
             status: worst(out.map(function (c) { return c.status; })) };
  }

  /* dBo/dp < Bg dRs/dp on the saturated branch of the finalised data. */
  function consistency(fin, tempF) {
    var sat = (fin.rows || []).filter(function (r) { return fin.pb && r.p <= fin.pb * 1.001 && num(r.rs) !== null && num(r.bo) !== null && num(r.z) !== null; })
      .sort(function (a, b) { return b.p - a.p; });
    if (sat.length < 2 || num(tempF) === null) return check('ineq', 'na', 'Needs finalised Rs, Bo and gas z on two or more saturated rows.');
    var bad = [];
    for (var i = 1; i < sat.length; i++) {
      var h = sat[i - 1], l = sat[i], dp = h.p - l.p;
      if (!(dp > 0)) continue;
      var pm = 0.5 * (h.p + l.p), zm = 0.5 * (h.z + l.z);
      var lhs = (h.bo - l.bo) / dp, rhs = bgBbl(zm, tempF, pm) * (h.rs - l.rs) / dp;
      if (lhs >= rhs) bad.push(f0(l.p) + '-' + f0(h.p));
    }
    return check('ineq', bad.length ? 'fail' : 'pass', bad.length
      ? 'dBo/dp exceeds Bg dRs/dp between ' + bad.join(', ') + ' psia: the total compressibility would be negative and a simulator will reject or mis-handle the table. Try the other DL correction or untick the offending stage.'
      : 'dBo/dp < Bg dRs/dp on every saturated interval: total compressibility stays positive.');
  }

  /* ------------------------------------------------------------ corrections */

  /* The finalised data: fluid description, bubble point, dead-oil
     viscosity and the rows the tuning regresses, all on the separator
     basis. notes say what was done and anything the engineer should know. */
  function finalise(rep) {
    rep = cleanReport(rep);
    var notes = [], st = rep.settings;
    var sep = sepSummary(rep.sep.tests[rep.sep.pick]);
    var pick = chosenPb(rep), pb = pick.pb;
    var dl = dlRowsUsed(rep).filter(function (q) { return num(q.rs) !== null && num(q.bo) !== null; });
    var top = dl[0] || null;
    var method = st.method;
    if (method !== 'none' && (!sep || sep.bofb === null || !top)) {
      if (dl.length) notes.push('No complete separator test (stage GORs and Bofb): Rs and Bo stay on the DL basis.');
      method = 'none';
    }
    if (method === 'none' && dl.length && sep && sep.bofb !== null) notes.push('DL values used as reported - not the separator basis a simulator expects.');
    var f = method !== 'none' ? sep.bofb / top.bo : 1;
    var rsb = method !== 'none' ? sep.rsfb : top ? top.rs : sep ? sep.rsfb : null;
    var bob = method !== 'none' ? sep.bofb : top ? top.bo : sep ? sep.bofb : null;
    if (top && pb && Math.abs(top.p - pb) / pb > 0.01) notes.push('The first DL stage (' + f0(top.p) + ' psia) is not at the bubble point used (' + f0(pb) + ' psia).');

    var rows = [], clipped = 0, atm = 0;
    dl.forEach(function (q) {
      if (pb && q.p > pb * 1.01) return;
      var rs, bo;
      if (method === 'amyx') { rs = sep.rsfb - (top.rs - q.rs) * f; bo = q.bo * f; }
      else if (method === 'ratio') { rs = q.rs * sep.rsfb / top.rs; bo = q.bo * f; }
      else { rs = q.rs; bo = q.bo; }
      /* The atmospheric stage (Rs = 0 at Tres) carries no information a
         correlation can match and, divided by Rs ~ 0, would dominate the
         relative errors of the fit: its Bo is kept, its Rs left blank. */
      if (q.p < P_ATM_STAGE) { rs = null; atm++; }
      else if (rs < 0) { rs = 0; clipped++; }
      rows.push({ p: q.p, rs: rs, bo: bo, muo: null, z: num(q.z), mug: null, src: 'DL' });
    });
    if (atm) notes.push('Rs at the atmospheric DL stage is left out of the tuning (relative errors on Rs near zero would dominate the fit); its Bo is kept.');
    if (clipped) notes.push(clipped + ' low-pressure Rs value' + (clipped > 1 ? 's' : '') + ' went negative under the Amyx correction and ' +
      (clipped > 1 ? 'were' : 'was') + ' set to zero; the ratio method avoids this.');
    if (pb && bob !== null && !rows.some(function (r) { return Math.abs(r.p - pb) / pb <= 0.01; })) {
      rows.push({ p: pb, rs: rsb, bo: bob, muo: null, z: null, mug: null, src: 'Pb' });
    }

    /* above Pb: the CCE volumes on the Bofb basis */
    var cPb = ccePb(rep.cce.rows) || pb;
    var us = st.smoothCce ? undersat(rep.cce.rows, cPb) : null;
    if (st.smoothCce && us && us.pts.length < 3) notes.push('Smoothing the CCE needs three readings above Pb; raw volumes used.');
    rep.cce.rows.forEach(function (q) {
      if (!used(q) || num(q.p) === null || num(q.v) === null || !pb || q.p <= pb * 1.001 || bob === null) return;
      var v = us && us.pts.length >= 3 ? us.vAt(q.p) : q.v;
      rows.push({ p: q.p, rs: rsb, bo: v * bob, muo: null, z: null, mug: null, src: 'CCE' });
    });
    if (pick.from !== 'cce' && ccePb(rep.cce.rows) && pb && Math.abs(ccePb(rep.cce.rows) - pb) / pb > 0.005) {
      notes.push('CCE volumes are relative to the CCE saturation pressure (' + f0(ccePb(rep.cce.rows)) + ' psia), not to the Pb used.');
    }

    /* viscosities onto the matching pressure, or rows of their own */
    rep.visc.rows.forEach(function (q) {
      if (!used(q) || num(q.p) === null || (num(q.muo) === null && num(q.mug) === null)) return;
      var tol = Math.max(5, 0.005 * q.p);
      var hit = rows.filter(function (r) { return Math.abs(r.p - q.p) <= tol; })[0];
      if (hit) { if (num(q.muo) !== null) hit.muo = q.muo; if (num(q.mug) !== null) hit.mug = q.mug; }
      else rows.push({ p: q.p, rs: null, bo: null, muo: num(q.muo), z: null, mug: num(q.mug), src: 'viscosity' });
    });
    rows.sort(function (a, b) { return b.p - a.p; });

    /* separator-gas impurities for the gas correlations */
    var imp = null, ys = compSum(rep, 'y');
    if (ys) {
      imp = { yCO2: 0, yH2S: 0, yN2: 0 };
      compRows(rep).forEach(function (q) {
        var c = normComp(q.c), v = num(q.y);
        if (v === null) return;
        if (c === 'CO2') imp.yCO2 = v / ys; if (c === 'H2S') imp.yH2S = v / ys; if (c === 'N2') imp.yN2 = v / ys;
      });
    }
    var comp = null, zs = compSum(rep, 'z');
    if (zs) {
      var k = st.normalise ? 100 / zs : 1;
      comp = { rows: compRows(rep).filter(function (q) { return num(q.z) !== null; }).map(function (q) { return { c: normComp(q.c) || q.c, z: q.z * k }; }),
               mw7: num(rep.comp.mw7), sg7: num(rep.comp.sg7) };
    }

    var gg = sep && sep.gg !== null ? sep.gg : null;
    if (gg === null && dl.length > 1) {
      /* without a separator test: the liberated-gas average */
      var w = 0, s = 0;
      for (var i = 1; i < dl.length; i++) if (num(dl[i].gg) !== null) { w += dl[i - 1].rs - dl[i].rs; s += (dl[i - 1].rs - dl[i].rs) * dl[i].gg; }
      if (w > 0) { gg = s / w; notes.push('Gas gravity is the average of the DL liberated gas.'); }
    }
    var api = sep && sep.api !== null ? sep.api : num(rep.dl.apiResidual);
    if (!(sep && sep.api !== null) && api !== null) notes.push('Oil gravity is the DL residual oil gravity (no stock-tank API).');

    return {
      name: rep.name, type: rep.type, method: method, pb: pb, pbFrom: pick.from, muod: num(rep.visc.muod),
      fluid: { api: api, gammaG: gg, rsb: rsb, tempF: num(rep.tempF),
               pSepPsia: sep ? sep.pSep : null, tSepF: sep ? sep.tSep : null },
      bob: bob, factor: f, impurities: imp, composition: comp,
      sampling: { type: rep.type, pRes: rep.sampling.pRes, pwf: rep.sampling.pwf, gor: rep.sampling.gor, depth: rep.sampling.depth },
      rows: rows, notes: notes,
      ready: !!(api !== null && gg !== null && rsb !== null && num(rep.tempF) !== null && rows.length)
    };
  }

  /* The finalised data as a PVT sample (samples.js) or the one-report lab table. */
  function toSample(fin, id) {
    return {
      id: id, name: fin.name, type: fin.type,
      fluid: { api: fin.fluid.api, gammaG: fin.fluid.gammaG, rsb: fin.fluid.rsb, tempF: fin.fluid.tempF },
      sampling: { pRes: fin.sampling.pRes, pwf: fin.sampling.pwf, gor: fin.sampling.gor, depth: fin.sampling.depth },
      lab: { pb: fin.pb, muod: fin.muod, rows: fin.rows.map(function (r) {
        return { p: r.p, rs: num(r.rs), bo: num(r.bo), muo: num(r.muo), z: num(r.z), mug: num(r.mug) };
      }) }
    };
  }

  /* ------------------------------------------------------------ import / template */

  var SECTION = [
    [/^(report|info|general|sample)/, 'report'], [/^(cce|constant|ccs|flash\s*vap)/, 'cce'],
    [/^(dl|differential|dv)/, 'dl'], [/^(sep|flash|separator)/, 'sep'], [/^(visc)/, 'visc'], [/^(comp)/, 'comp']
  ];
  /* Most specific first: 'dead oil viscosity at Tres' is not a temperature,
     'reported bubble point' is not a name. */
  var KEYS = [
    [/residual/, 'apiResidual'], [/dead/, 'muod'],
    [/c7.*(mol|mw|weight)/, 'mw7'], [/c7.*(sg|specific|gravity|density)/, 'sg7'],
    [/bubble|saturation|^pb\b|^psat/, 'pbReported'], [/reservoir pressure|^p\s*res|static/, 'pRes'],
    [/flowing|pwf/, 'pwf'], [/gor/, 'gor'], [/depth/, 'depth'],
    [/temperature|^t\s*res/, 'tempF'], [/type/, 'type'], [/name/, 'name']
  ];

  /* A spreadsheet saves CSV with its own habits: every row padded with
     trailing separators to the widest row ("[report],,,,,"), cells that
     contain a separator wrapped in quotes, and - with semicolon separators -
     a decimal comma (1,152). One separator is chosen for the whole file. */
  function detectDelim(lines) {
    var n = { tab: 0, semi: 0, comma: 0 };
    lines.forEach(function (l) {
      l = cleanLine(l);
      n.tab += (l.match(/\t/g) || []).length;
      n.semi += (l.match(/;/g) || []).length;
      n.comma += (l.match(/,/g) || []).length;
    });
    return n.tab ? '\t' : n.semi && n.semi >= n.comma / 3 ? ';' : ',';
  }
  /* A comment starts a line or follows a value after a space ("bhs  # ..."),
     so "Well #3" stays a name. Trailing separators and spaces go too. */
  function cleanLine(raw) {
    var t = String(raw || '').replace(/^\s*"\s*(?=#)/, '');
    if (/^\s*#/.test(t)) return '';
    return t.replace(/(^|\s)#(\s.*)?$/, '').replace(/[\s,;\t"]+$/, '').trim();
  }
  function splitLine(line, d) {
    var out = [], cur = '', q = false;
    d = d || ',';
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) { if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  function toNum(s, d) {
    var t = String(s === null || s === undefined ? '' : s).replace(/[\s\u00a0]/g, '').replace(/\u2212/g, '-');
    if (d === ';') t = t.indexOf('.') >= 0 && t.indexOf(',') >= 0 ? t.replace(/\./g, '').replace(',', '.') : t.replace(',', '.');
    else t = t.replace(/,/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
    var v = parseFloat(t);
    return isFinite(v) ? v : null;
  }
  /* "[separator: 100 psig / 80 degF]" as the first cell, quoted or not */
  function sectionHead(line) {
    var m = /^"?\[(.*)\]"?$/.exec(line);
    return m ? m[1] : null;
  }

  /* Read one report file: sections in square brackets ([report], [cce],
     [dl], [separator: name], [viscosity], [composition]); header and unit
     rows are skipped. Field units. Returns a clean report; throws an Error
     saying what is wrong. */
  function parseReportText(text, fallbackName) {
    var t = String(text || '').replace(/^\uFEFF/, '');
    var trimmed = t.trim();
    if (trimmed.charAt(0) === '{' || /^\[\s*[{\]]/.test(trimmed)) {
      var j;
      try { j = JSON.parse(trimmed); } catch (e) { throw new Error('The file looks like JSON but does not parse.'); }
      var list = Array.isArray(j) ? j : Array.isArray(j.reports) ? j.reports : j.reports && Array.isArray(j.reports.list) ? j.reports.list : [j];
      return list.map(cleanReport);
    }
    var rep = emptyReport(fallbackName || 'Imported report');
    rep.sep.tests = [];
    var sec = null, cur = null, any = false, compRowsIn = [];
    var allLines = t.split(/\r?\n/), d = detectDelim(allLines);
    allLines.forEach(function (raw) {
      var line = cleanLine(raw);
      if (!line) return;
      var head = sectionHead(line), m = head === null ? null : [line, head];
      if (m) {
        var hd = m[1].trim().toLowerCase();
        sec = null;
        SECTION.forEach(function (s) { if (!sec && s[0].test(hd)) sec = s[1]; });
        if (!sec) throw new Error('Unknown section [' + m[1] + ']. Use [report], [cce], [dl], [separator], [viscosity] or [composition].');
        if (sec === 'sep') {
          var nm = m[1].split(':')[1];
          cur = emptySepTest(nm ? nm.trim() : 'Test ' + (rep.sep.tests.length + 1));
          rep.sep.tests.push(cur);
        }
        return;
      }
      if (!sec) return;
      var cells = splitLine(line, d), nums = cells.map(function (c) { return toNum(c, d); });
      if (sec === 'report') {
        var key = cells[0].toLowerCase(), val = cells[1];
        var hit = null;
        KEYS.forEach(function (k) { if (!hit && k[0].test(key)) hit = k[1]; });
        if (!hit) return;
        any = true;
        if (hit === 'name') rep.name = String(val || rep.name).slice(0, 80);
        else if (hit === 'type') rep.type = /sep|recomb/i.test(val) ? 'sep' : 'bhs';
        else if (['pRes', 'pwf', 'gor', 'depth'].indexOf(hit) >= 0) rep.sampling[hit] = toNum(val, d);
        else if (hit === 'apiResidual') rep.dl.apiResidual = toNum(val, d);
        else if (hit === 'muod') rep.visc.muod = toNum(val, d);
        else if (hit === 'mw7' || hit === 'sg7') rep.comp[hit] = toNum(val, d);
        else rep[hit] = toNum(val, d);
        return;
      }
      if (sec === 'comp') {
        var c = normComp(cells[0]);
        if (!c) {
          var lk = cells[0].toLowerCase();
          if (/c7.*(mw|mol|weight)/.test(lk)) rep.comp.mw7 = nums[1];
          else if (/c7.*(sg|specific|gravity)/.test(lk)) rep.comp.sg7 = nums[1];
          return;
        }
        compRowsIn.push({ c: c, z: nums[1], y: nums[2], x: nums[3] });
        any = true;
        return;
      }
      if (sec === 'sep') {
        if (nums[0] === null) {
          var k2 = cells[0].toLowerCase();
          if (/api|gravity/.test(k2) && nums[1] !== null) cur.api = nums[1];
          else if (/bo/.test(k2) && nums[1] !== null) cur.bofb = nums[1];
          return;
        }
        cur.stages.push({ p: nums[0], t: nums[1], gor: nums[2], gg: nums[3] });
        any = true;
        return;
      }
      if (nums[0] === null) return;
      any = true;
      if (sec === 'cce') rep.cce.rows.push({ p: nums[0], v: nums[1], rho: nums[2], use: true });
      if (sec === 'dl') rep.dl.rows.push({ p: nums[0], rs: nums[1], bo: nums[2], rho: nums[3], z: nums[4], gg: nums[5], use: true });
      if (sec === 'visc') rep.visc.rows.push({ p: nums[0], muo: nums[1], mug: nums[2], use: true });
    });
    if (!any) throw new Error('No PVT data found. Start each test with a section line such as [cce] - download the template to see the layout.');
    if (compRowsIn.length) {
      var byC = {};
      compRowsIn.forEach(function (q) { byC[q.c] = q; });
      rep.comp.rows = COMPONENTS.map(function (k) { return byC[k.c] || { c: k.c, z: null, y: null, x: null }; });
    }
    if (!rep.sep.tests.length) rep.sep.tests.push(emptySepTest());
    return [cleanReport(rep)];
  }

  var TEMPLATE = [
    '# Black-Oil PVT Generator - PVT report import template',
    '# Copyright (c) 2026 Ankaj Kumar Sinha - MIT licence',
    '# Field units. One file per report; lines starting with # are ignored, as are header rows.',
    '# Save from a spreadsheet as CSV (comma, semicolon or tab separated). Leave a cell empty if not measured.',
    '[report]',
    'name,A-1 BHS',
    'sample type,bhs   # bhs = bottomhole / sep = separator recombination',
    'reservoir temperature degF,186',
    'reported bubble point psia,2853',
    'reservoir pressure at sampling psia,4650',
    'flowing pressure at sampling psia,3900',
    'producing GOR at sampling scf/STB,655',
    'sampling depth ft TVD,8550',
    'residual oil gravity API,31.5',
    'dead oil viscosity at Tres cp,2.96',
    'C7+ molecular weight,218',
    'C7+ specific gravity,0.862',
    '',
    '[cce]',
    'pressure psia,relative volume V/Vsat,oil density g/cm3',
    '5000,0.9812,0.6655',
    '4000,0.9888,',
    '2853,1.0000,0.6528',
    '2500,1.0441,',
    '2000,1.1360,',
    '1500,1.2964,',
    '',
    '[dl]',
    'pressure psia,Rsd scf/bbl residual oil,Bod bbl/bbl residual oil,oil density g/cm3,gas z,liberated gas gravity',
    '2853,705,1.398,0.6528,,',
    '2400,598,1.352,0.6669,0.853,0.73',
    '14.7,0,1.064,0.8018,,1.32',
    '',
    '[separator: 100 psig / 80 degF]',
    'stock-tank oil gravity API,34.2',
    'Bofb bbl/STB,1.340',
    'stage pressure psia,stage temperature degF,stage GOR scf/STB,gas gravity',
    '114.7,80,560,0.74',
    '14.7,60,80,1.24',
    '',
    '[viscosity]',
    'pressure psia,oil viscosity cp,gas viscosity cp',
    '5000,0.78,',
    '2853,0.66,0.0204',
    '1500,0.95,0.0161',
    '',
    '[composition]',
    'component,reservoir fluid mol%,separator gas mol%,separator liquid mol%',
    'N2,0.31,0.72,0.02',
    'CO2,0.92,1.98,0.14',
    'C1,36.21,78.40,3.20',
    'C7+,32.40,0.05,52.10',
    ''
  ].join('\n');

  /* ------------------------------------------------------------ example reports */

  /* Three reports built from a correlation fluid with a known DL /
     separator relationship, so the corrections can be checked: a sound
     bottomhole study, a repeat study with textbook faults (a DL density
     typo, a CCE reading off the Y-function, a viscosity reading out of
     line, a composition that does not add up, a separator-liquid analysis
     off the Hoffman line, a reported Pb 2.5 % high), and a separator
     recombination with two separator tests. Model is pvt-model.js. */
  function demoReports(Model) {
    function make(o) {
      var gSep = o.stages.reduce(function (a, s) { return a + s[2] * s[3]; }, 0) / o.stages.reduce(function (a, s) { return a + s[2]; }, 0);
      var m = Model.build({ api: o.api, gammaG: gSep, rsb: o.rsb, tempF: o.tempF, tSepF: o.stages[0][1], pSepPsia: o.stages[0][0], pMax: o.pMax || 5200, nSat: 20, nUnsat: 8 });
      var pb = m.pb, f = o.f, rsdb = o.rsb * o.rsRatio, bodb = m.at(pb, 'oil').bo / f;
      var at = function (p) { return m.at(p, 'oil'); }, gasAt = function (p) { return m.at(p, 'gas'); };
      /* DL stages: inverse of the Amyx correction */
      var dlP = o.dlP.map(function (k) { return k === 0 ? pb : k; });
      var rows = dlP.map(function (p, i) {
        var q = at(p), last = i === dlP.length - 1;
        var bo = last ? q.bo / f * 0.995 : q.bo / f;
        var rs = last ? 0 : rsdb - (o.rsb - q.rs) / f;
        return { p: p, rs: Math.max(0, rs), bo: bo, z: last || i === 0 ? null : gasAt(p).z };
      });
      /* liberated gas heavier at each stage */
      rows.forEach(function (r, i) { r.gg = i === 0 ? null : +(o.gg0 + (o.gg1 - o.gg0) * Math.pow(i / (rows.length - 1), 1.6)).toFixed(3); });
      /* densities: separator mass balance at Pb fixes the residual oil gravity */
      var gO = gammaO(o.api), rhoOb = (LB_PER_BBL_WATER * gO + LB_PER_SCF_AIR * o.rsb * gSep) / (FT3_PER_BBL * m.at(pb, 'oil').bo);
      var diss = 0, mass = [];
      for (var k = rows.length - 1; k >= 0; k--) { mass[k] = diss; if (k) diss += LB_PER_SCF_AIR * (rows[k - 1].rs - rows[k].rs) * rows[k].gg; }
      var gOr = (rhoOb * FT3_PER_BBL * bodb - mass[0]) / LB_PER_BBL_WATER;
      rows.forEach(function (r, k2) { r.rho = +((LB_PER_BBL_WATER * gOr + mass[k2]) / (FT3_PER_BBL * r.bo) / GCC_TO_LBFT3).toFixed(4); });
      var apiR = 141.5 / gOr - 131.5;
      /* CCE */
      var cce = o.cceP.map(function (p) {
        if (p >= pb) {
          var v = at(p).bo / m.at(pb, 'oil').bo;
          return { p: p, v: +v.toFixed(5), rho: p === pb || p > pb + 400 ? +(rhoOb / GCC_TO_LBFT3 / v).toFixed(4) : null };
        }
        var y = o.yA + o.yB * p;
        return { p: p, v: +(1 + (pb - p) / (p * y)).toFixed(4), rho: null };
      });
      cce.push({ p: Math.round(pb), v: 1, rho: +(rhoOb / GCC_TO_LBFT3).toFixed(4) });
      cce.sort(function (a, b) { return b.p - a.p; });
      var visc = o.viscP.map(function (p) {
        var q = at(p), g = gasAt(p);
        return { p: p, muo: +q.muo.toFixed(3), mug: p < pb ? +g.mug.toFixed(4) : null };
      });
      visc.push({ p: Math.round(pb), muo: +at(pb).muo.toFixed(3), mug: +gasAt(pb).mug.toFixed(4) });
      visc.sort(function (a, b) { return b.p - a.p; });
      var tests = o.tests.map(function (t) {
        return { name: t.name, api: t.api, bofb: +(m.at(pb, 'oil').bo * t.boK).toFixed(4),
                 stages: t.stages.map(function (s) { return { p: s[0], t: s[1], gor: Math.round(s[2] * o.rsb * t.rsK), gg: s[3] }; }) };
      });
      tests[0].api = o.api; tests[0].bofb = +m.at(pb, 'oil').bo.toFixed(4);
      tests[0].stages = o.stages.map(function (s) { return { p: s[0], t: s[1], gor: Math.round(s[2] * o.rsb), gg: s[3] }; });
      return cleanReport({
        name: o.name, type: o.type, tempF: o.tempF, pbReported: Math.round(pb * (o.pbErr || 1)),
        sampling: o.sampling,
        cce: { rows: cce.map(function (r) { return { p: Math.round(r.p), v: r.v, rho: r.rho }; }) },
        dl: { rows: rows.map(function (r) { return { p: r.p < 20 ? 14.7 : Math.round(r.p), rs: Math.round(r.rs), bo: +r.bo.toFixed(4), rho: r.rho, z: r.z === null ? null : +r.z.toFixed(4), gg: r.gg }; }),
              apiResidual: +apiR.toFixed(1) },
        sep: { tests: tests, pick: 0 },
        visc: { rows: visc, muod: +m.muod.toFixed(3) },
        comp: o.comp, settings: { method: 'amyx', pbSource: 'cce', smoothCce: false, normalise: true }
      });
    }

    /* separator gas / liquid on a Hoffman line at 114.7 psia, 80 degF */
    function sepComp(zRes, mw7, sg7, pSep, tSep) {
      var T = tSep + 459.67, xs = {}, ys = {};
      var liq = { N2: 0.02, CO2: 0.12, H2S: 0, C1: 3.4, C2: 2.6, C3: 4.9, iC4: 1.6, nC4: 3.9, iC5: 2.4, nC5: 3.0, C6: 5.4, 'C7+': 70.68 };
      var sy = 0;
      COMPONENTS.forEach(function (k) {
        if (!k.tc) { ys[k.c] = 0.08; return; }
        var b = Math.log10(k.pc / 14.7) / (1 / k.tb - 1 / k.tc), F = b * (1 / k.tb - 1 / T);
        var K = Math.pow(10, 0.72 + 0.86 * F) / pSep;
        ys[k.c] = liq[k.c] * K; sy += ys[k.c];
      });
      var sc = (100 - 0.08) / sy;
      return { rows: COMPONENTS.map(function (k) {
        return { c: k.c, z: zRes[k.c], y: +(k.tc ? ys[k.c] * sc : 0.08).toFixed(3), x: liq[k.c] };
      }), mw7: mw7, sg7: sg7 };
    }
    var Z1 = { N2: 0.31, CO2: 0.92, H2S: 0, C1: 36.21, C2: 7.48, C3: 6.12, iC4: 1.24, nC4: 3.36, iC5: 1.46, nC5: 1.97, C6: 3.03, 'C7+': 37.89 };
    var Z2 = { N2: 0.29, CO2: 0.95, H2S: 0, C1: 37.02, C2: 7.31, C3: 6.05, iC4: 1.20, nC4: 3.30, iC5: 1.44, nC5: 1.92, C6: 2.98, 'C7+': 36.21 };
    var Z3 = { N2: 0.33, CO2: 0.88, H2S: 0, C1: 33.85, C2: 7.62, C3: 6.31, iC4: 1.28, nC4: 3.45, iC5: 1.51, nC5: 2.04, C6: 3.10, 'C7+': 39.63 };
    var common = { dlP: [0, 2400, 1900, 1400, 900, 500, 200, 14.7], cceP: [5000, 4500, 4000, 3500, 3200, 2600, 2300, 2000, 1700, 1400, 1100],
                   viscP: [5000, 4200, 3500, 2300, 1700, 1100, 500, 200], yA: 1.62, yB: 4.1e-4, f: 0.958, rsRatio: 1.075, gg0: 0.70, gg1: 1.30 };
    function ext(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

    var r1 = make(ext(common, {
      name: 'A-1 BHS (DST 2)', type: 'bhs', api: 34.2, rsb: 640, tempF: 186,
      stages: [[114.7, 80, 0.86, 0.74], [14.7, 60, 0.14, 1.24]],
      tests: [{ name: '100 psig / 80 °F', api: 34.2, boK: 1, rsK: 1, stages: [] }],
      sampling: { pRes: 4650, pwf: 3900, gor: 655, depth: 8550 },
      comp: sepComp(Z1, 218, 0.862, 114.7, 80)
    }));
    var r2 = make(ext(common, {
      name: 'A-2 MDT repeat study', type: 'bhs', api: 34.8, rsb: 690, tempF: 183, pbErr: 1.025,
      stages: [[114.7, 80, 0.86, 0.75], [14.7, 60, 0.14, 1.25]],
      tests: [{ name: '100 psig / 80 °F', api: 34.8, boK: 1, rsK: 1, stages: [] }],
      sampling: { pRes: 4600, pwf: 3950, gor: 690, depth: 8300 },
      comp: sepComp(Z2, 221, 0.865, 114.7, 80)
    }));
    /* faults in the repeat study */
    var dl2 = r2.dl.rows; dl2[3].rho = +(dl2[3].rho * 1.045).toFixed(4);              /* density typo */
    var cceBelow = r2.cce.rows.filter(function (q) { return q.v > 1; });
    cceBelow[2].v = +(1 + (cceBelow[2].v - 1) * 0.86).toFixed(4);                    /* a reading off the Y line */
    r2.visc.rows[5].muo = +(r2.visc.rows[5].muo * 1.22).toFixed(3);                   /* viscosity out of line */
    r2.comp.rows[3].z = 34.80;                                                         /* C1 mis-typed: 96 mol % total */
    r2.comp.rows[5].x = +(r2.comp.rows[5].x * 0.55).toFixed(2);                        /* separator-liquid C3 off the Hoffman line */

    var r3 = make(ext(common, {
      name: 'B-1 separator recombination', type: 'sep', api: 33.6, rsb: 600, tempF: 190,
      stages: [[114.7, 80, 0.85, 0.73], [14.7, 60, 0.15, 1.22]],
      tests: [{ name: '100 psig / 80 °F', api: 33.6, boK: 1, rsK: 1, stages: [] },
              { name: '50 psig / 80 °F', api: 33.4, boK: 1.004, rsK: 1.012, stages: [[64.7, 80, 0.80, 0.70], [14.7, 60, 0.20, 1.16]] },
              { name: '200 psig / 80 °F', api: 33.3, boK: 1.006, rsK: 1.016, stages: [[214.7, 80, 0.89, 0.71], [14.7, 60, 0.11, 1.38]] }],
      sampling: { pRes: 4700, gor: 600 },
      comp: sepComp(Z3, 214, 0.859, 114.7, 80)
    }));
    return [r1, r2, r3];
  }

  return {
    CHECKS: CHECKS, COMPONENTS: COMPONENTS, COLS: COLS, TEMPLATE: TEMPLATE,
    emptyReport: emptyReport, emptySepTest: emptySepTest, cleanReport: cleanReport, normComp: normComp,
    sepSummary: sepSummary, ccePb: ccePb, pbCandidates: pbCandidates, chosenPb: chosenPb,
    yFunction: yFunction, undersat: undersat, dlDensity: dlDensity, hoffman: hoffman, watsonK: watsonK,
    gasGravityFromComp: gasGravityFromComp, qcReport: qcReport, finalise: finalise, consistency: consistency,
    toSample: toSample, parseReportText: parseReportText, demoReports: demoReports, bgBbl: bgBbl,
    eosComposition: eosComposition,
    /* shared with gas-reports.js */
    util: { num: num, used: used, pct: pct, f0: f0, median: median, worst: worst, linFit: linFit, theilSen: theilSen,
            outliers: outliers, compRows: compRows, compSum: compSum, RANK: RANK, M_AIR: M_AIR, COMP_BY: COMP_BY,
            detectDelim: detectDelim, cleanLine: cleanLine, splitLine: splitLine, toNum: toNum, sectionHead: sectionHead }
  };
});
