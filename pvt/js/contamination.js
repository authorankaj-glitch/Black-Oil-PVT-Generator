/*
 * PhaseWiz - Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. PolyForm Noncommercial License 1.0.0 (see LICENSE).
 *
 * contamination.js -- oil-based mud (OBM / SBM) filtrate in an oil sample:
 * how much there is, and what the clean reservoir oil would have measured.
 *
 * Filtrate of an oil-based mud is a narrow cut of heavy hydrocarbons
 * (typically C11 - C24). It does not vaporise at the stock tank, so a
 * contaminated sample carries it into the stock-tank oil (STO): the oil
 * looks lighter or heavier than it is, the GOR is diluted, Bo and the bubble
 * point fall. Laboratories report the STO composition by single carbon
 * number (SCN), in weight per cent, and that is what both methods use.
 *
 * Estimating the contamination (weight fraction c of the STO)
 *   Skimming (no filtrate data needed; MacMillan et al., 1997): a reservoir
 *     oil's C8+ mole fractions fall exponentially with carbon number, so
 *     ln(x_n) is a straight line in n. The filtrate shows as a hump above
 *     that line. The line is fitted to the carbon numbers outside the hump;
 *     the excess above it inside the hump is the filtrate.
 *       x_n proportional to w_n / M_n;  w_clean,n = M_n exp(a + b n)
 *       c = sum over the hump of (w_n - w_clean,n) / sum of all w_n
 *     The hump is taken from the filtrate composition when it is entered,
 *     from the carbon numbers the engineer sets, or found automatically
 *     (the run of carbon numbers more than 8 % above a robust line, widened
 *     while the excess stays above 3 %).
 *   Subtraction (filtrate composition known; MacMillan et al., 1997):
 *       w_clean,n = (W_n - c F_n) / (1 - c)
 *     with W and F the STO and filtrate weight fractions. c is the value
 *     that makes ln(w_clean,n / M_n) the straightest line over the fitted
 *     carbon numbers (least squares), searched from 0 to the value at which
 *     the first cleaned carbon number would turn negative.
 *   SCN molecular weights and specific gravities: Katz & Firoozabadi
 *   (1978), as tabulated by Whitson (1983); 14 n - 4 beyond C45.
 *
 * Correcting the black-oil data (field units)
 *   Filtrate volume fraction of the STO   vF = c g_o / g_F   (ideal mixing)
 *   Clean STO gravity                     g_o' = (g_o - vF g_F) / (1 - vF)
 *   GOR (the filtrate releases no gas)    Rs' = Rs / (1 - vF)
 *   Formation volume factor               Bo' = (Bo - vF B_F) / (1 - vF)
 *     B_F, the filtrate's reservoir / stock-tank volume, defaults to its
 *     thermal expansion, 1 + 4e-4 (T - 60).
 *   Dead-oil viscosity (Arrhenius blending, volume fractions)
 *                                         ln muod' = (ln muod - vF ln mu_F) / (1 - vF)
 *     live-oil viscosities are scaled by muod' / muod.
 *   Bubble point, either
 *     'eos'  the C1 - C7+ interaction of the Peng-Robinson model (eos.js)
 *            is regressed to the measured bubble point of the contaminated
 *            fluid, the filtrate is taken out of its C7+ (moles, weight and
 *            volume), and the clean fluid is flashed with the same model; or
 *     'corr' Standing (1947) applied as a ratio,
 *            Pb' = Pb_meas Pb_St(Rsb', API') / Pb_St(Rsb, API),
 *            which cancels most of the correlation's own bias.
 *   Pressures: the clean oil saturates at Pb', not Pb. Saturated rows are
 *   stretched, p' = p Pb'/Pb (the stretch the tuning applies to Rs(p)), and
 *   undersaturated rows shifted, p' = p + (Pb' - Pb), so the compressibility
 *   between readings is kept. Gas z and viscosity stay at the pressure they
 *   were measured at. The separator gas gravity is unchanged.
 *
 * The effect of the filtrate on the measured properties, and why the
 * bubble point is best corrected through the composition, is discussed by
 * Gozalpour et al. (2002).
 *
 * Limits: one homologous filtrate cut is assumed. Ester and olefin muds,
 * or a crude whose SCN profile is naturally curved, weaken the skimming
 * line - the semi-log plot is shown so the engineer can judge it. Above
 * about 10 wt % of the STO a resample is the better answer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./eos.js'));
  else root.PVTMud = factory(root.PVTEos);
})(typeof self !== 'undefined' ? self : this, function (Eos) {
  'use strict';

  /* Katz & Firoozabadi (1978) generalised SCN properties, C6 - C45:
     [molecular weight, specific gravity 60/60 degF]. */
  var KF = {
    6: [84, 0.690], 7: [96, 0.727], 8: [107, 0.749], 9: [121, 0.768], 10: [134, 0.782],
    11: [147, 0.793], 12: [161, 0.804], 13: [175, 0.815], 14: [190, 0.826], 15: [206, 0.836],
    16: [222, 0.843], 17: [237, 0.851], 18: [251, 0.856], 19: [263, 0.861], 20: [275, 0.866],
    21: [291, 0.871], 22: [300, 0.876], 23: [312, 0.881], 24: [324, 0.885], 25: [337, 0.888],
    26: [349, 0.892], 27: [360, 0.896], 28: [372, 0.899], 29: [382, 0.902], 30: [394, 0.905],
    31: [404, 0.909], 32: [415, 0.912], 33: [426, 0.915], 34: [437, 0.917], 35: [445, 0.920],
    36: [456, 0.922], 37: [464, 0.925], 38: [475, 0.927], 39: [484, 0.929], 40: [495, 0.931],
    41: [502, 0.933], 42: [512, 0.934], 43: [521, 0.936], 44: [531, 0.938], 45: [539, 0.940]
  };
  /* Light ends that can appear in a stock-tank GC (n = 1 ... 5). */
  var LIGHT_MW = { 1: 16.043, 2: 30.070, 3: 44.097, 4: 58.123, 5: 72.150 };

  var LEVEL_OK = 0.05, LEVEL_MAX = 0.10;   /* weight fraction of the STO */
  var HUMP = 0.08;                         /* ln excess that marks the filtrate hump */
  var DEF = { method: 'auto', apply: true, pbFrom: 'eos', sgF: null, muF: null, bF: null,
              fitFrom: 8, winFrom: null, winTo: null, plus: true };

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function mwOf(n) { return KF[n] ? KF[n][0] : LIGHT_MW[n] || 14 * n - 4; }
  function gammaO(api) { return 141.5 / (131.5 + api); }
  function apiOf(g) { return 141.5 / g - 131.5; }

  /* ------------------------------------------------------------ data */

  function emptyMud() {
    var o = { rows: [] };
    for (var k in DEF) o[k] = DEF[k];
    return o;
  }

  /* A stored, imported or hand-edited mud section made safe to use. */
  function cleanMud(o) {
    o = o || {};
    var m = emptyMud();
    m.rows = (Array.isArray(o.rows) ? o.rows : []).map(function (r) {
      if (Array.isArray(r)) r = { n: r[0], w: r[1], f: r[2] };
      var n = num(r.n);
      return { n: n === null ? null : Math.round(n), w: num(r.w), f: num(r.f), use: r.use !== false };
    });
    m.method = ['auto', 'skim', 'subtract'].indexOf(o.method) >= 0 ? o.method : 'auto';
    m.apply = o.apply !== false;
    m.pbFrom = o.pbFrom === 'corr' ? 'corr' : 'eos';
    ['sgF', 'muF', 'bF', 'winFrom', 'winTo'].forEach(function (k) { m[k] = num(o[k]); });
    m.fitFrom = num(o.fitFrom) !== null ? Math.max(6, Math.round(o.fitFrom)) : DEF.fitFrom;
    m.plus = o.plus !== false;
    return m;
  }

  function hasData(mud) { return !!mud && mud.rows.filter(function (r) { return r.n !== null && r.w !== null; }).length >= 5; }
  function hasFiltrate(mud) { return !!mud && mud.rows.some(function (r) { return r.n !== null && r.f > 0; }); }

  /* Rows sorted by carbon number; the plus fraction (the last row when
     mud.plus) is kept in the totals but never fitted. */
  function sorted(mud) {
    var r = mud.rows.filter(function (q) { return q.n !== null && q.w !== null && q.w >= 0; })
      .map(function (q, i) { return { n: q.n, w: q.w, f: num(q.f), use: q.use !== false, i: mud.rows.indexOf(q) }; })
      .sort(function (a, b) { return a.n - b.n; });
    if (mud.plus && r.length) r[r.length - 1].plus = true;
    return r;
  }

  /* ------------------------------------------------------------ fitting */

  function ols(pts) {
    var n = pts.length;
    if (n < 2) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    pts.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y; });
    var d = n * sxx - sx * sx;
    if (!(Math.abs(d) > 1e-12)) return null;
    var b = (n * sxy - sx * sy) / d, a = (sy - b * sx) / n;
    var ssTot = syy - sy * sy / n, ssRes = 0;
    pts.forEach(function (p) { var e = p.y - a - b * p.x; ssRes += e * e; });
    return { a: a, b: b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, rss: ssRes, n: n };
  }
  function theilSen(pts) {
    var sl = [];
    for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
      if (pts[j].x !== pts[i].x) sl.push((pts[j].y - pts[i].y) / (pts[j].x - pts[i].x));
    }
    if (!sl.length) return null;
    var med = function (xs) { var s = xs.slice().sort(function (a, b) { return a - b; }), k = s.length; return k % 2 ? s[(k - 1) / 2] : 0.5 * (s[k / 2 - 1] + s[k / 2]); };
    var b = med(sl), a = med(pts.map(function (p) { return p.y - b * p.x; }));
    return { a: a, b: b };
  }

  /* Points the trend line can use: n >= fitFrom, not the plus fraction,
     ticked, and a positive amount. y = ln(w / M), proportional to ln(x). */
  function fitPoints(rows, fitFrom, key) {
    return rows.filter(function (r) { return !r.plus && r.use && r.n >= fitFrom && r[key || 'w'] > 0; })
      .map(function (r) { return { x: r.n, y: Math.log(r[key || 'w'] / mwOf(r.n)), r: r }; });
  }

  /* The filtrate hump: [from, to] carbon numbers. */
  function humpFromFiltrate(rows) {
    var fm = rows.reduce(function (a, r) { return Math.max(a, r.f || 0); }, 0);
    if (!(fm > 0)) return null;
    var ns = rows.filter(function (r) { return (r.f || 0) >= 0.02 * fm; }).map(function (r) { return r.n; });
    return [Math.min.apply(null, ns), Math.max.apply(null, ns)];
  }
  function humpAuto(pts) {
    if (pts.length < 6) return null;
    var line = theilSen(pts), win = null;
    for (var it = 0; it < 4 && line; it++) {
      var res = pts.map(function (p) { return p.y - line.a - line.b * p.x; });
      var k = 0;
      res.forEach(function (v, i) { if (v > res[k]) k = i; });
      if (!(res[k] > HUMP)) return win;
      var lo = k, hi = k;
      while (lo > 0 && res[lo - 1] > HUMP / 2) lo--;
      while (hi < pts.length - 1 && res[hi + 1] > HUMP / 2) hi++;
      var w = [pts[lo].x, pts[hi].x];
      if (win && win[0] === w[0] && win[1] === w[1]) break;
      win = w;
      var out = pts.filter(function (p) { return p.x < win[0] || p.x > win[1]; });
      line = out.length >= 3 ? ols(out) : null;
    }
    /* the hump's tails: widen while the excess over the clean line is still above 3 % */
    if (win && line) {
      var r2 = pts.map(function (p) { return p.y - line.a - line.b * p.x; });
      var i0 = pts.findIndex(function (p) { return p.x === win[0]; }), i1 = pts.findIndex(function (p) { return p.x === win[1]; });
      while (i0 > 1 && r2[i0 - 1] > 0.03) i0--;
      while (i1 < pts.length - 2 && r2[i1 + 1] > 0.03) i1++;
      win = [pts[i0].x, pts[i1].x];
    }
    return win;
  }

  /*
   * Skimming. Returns { method, c, mwF, hump, humpFrom, fit, rows } or
   * { error }. rows: every carbon number with w, the trend value wFit and
   * the cleaned wClean (all in the units entered, wt %).
   */
  function skim(mud) {
    mud = cleanMud(mud);
    var rows = sorted(mud);
    var pts = fitPoints(rows, mud.fitFrom);
    if (pts.length < 6) return { method: 'skim', error: 'Needs the stock-tank oil composition to at least six carbon numbers from C' + mud.fitFrom + '.' };
    var hump = null, from = 'auto';
    if (mud.winFrom !== null && mud.winTo !== null && mud.winTo >= mud.winFrom) { hump = [mud.winFrom, mud.winTo]; from = 'set'; }
    else if (hasFiltrate(mud)) { hump = humpFromFiltrate(rows); from = 'filtrate'; }
    else hump = humpAuto(pts);
    var out = hump ? pts.filter(function (p) { return p.x < hump[0] || p.x > hump[1]; }) : pts;
    if (out.length < 3) return { method: 'skim', error: 'Fewer than three carbon numbers outside the filtrate range C' + hump[0] + ' - C' + hump[1] + ' to draw the clean trend through.' };
    var fit = ols(out);
    var total = rows.reduce(function (a, r) { return a + r.w; }, 0), ex = 0, exMol = 0;
    var res = rows.map(function (r) {
      var o = { n: r.n, w: r.w, f: r.f, plus: !!r.plus, use: r.use, i: r.i, wFit: null, wClean: r.w, inHump: false };
      if (!r.plus && r.n >= mud.fitFrom) o.wFit = mwOf(r.n) * Math.exp(fit.a + fit.b * r.n);
      if (hump && !r.plus && r.n >= hump[0] && r.n <= hump[1] && r.use) {
        o.inHump = true;
        var e = Math.max(0, r.w - o.wFit);
        o.wClean = r.w - e; ex += e; exMol += e / mwOf(r.n);
      }
      return o;
    });
    var c = total > 0 ? ex / total : 0;
    return { method: 'skim', c: c, mwF: exMol > 0 ? ex / exMol : null, hump: hump, humpFrom: from, fit: fit, rows: res, total: total };
  }

  /*
   * Subtraction. Needs the filtrate composition. Returns the same shape as
   * skim, plus cMax (the limit before a cleaned carbon number turns
   * negative), atLimit, and curve [{ c, rms }] of the line misfit.
   */
  function subtract(mud) {
    mud = cleanMud(mud);
    if (!hasFiltrate(mud)) return { method: 'subtract', error: 'Needs the mud filtrate composition (wt %) beside the stock-tank oil.' };
    var rows = sorted(mud);
    var W = rows.reduce(function (a, r) { return a + r.w; }, 0), F = rows.reduce(function (a, r) { return a + (r.f || 0); }, 0);
    if (!(W > 0) || !(F > 0)) return { method: 'subtract', error: 'The compositions sum to zero.' };
    var cMax = 0.6;
    rows.forEach(function (r) { if (r.f > 0) cMax = Math.min(cMax, (r.w / W) / (r.f / F)); });
    cMax *= 0.999;
    var dom = rows.filter(function (r) { return !r.plus && r.use && r.n >= mud.fitFrom; });
    if (dom.length < 6) return { method: 'subtract', error: 'Needs the stock-tank oil composition to at least six carbon numbers from C' + mud.fitFrom + '.' };
    function misfit(c) {
      var pts = [];
      for (var i = 0; i < dom.length; i++) {
        var r = dom[i], wc = (r.w / W - c * (r.f || 0) / F) / (1 - c);
        if (!(wc > 0)) return Infinity;
        pts.push({ x: r.n, y: Math.log(wc / mwOf(r.n)) });
      }
      var f = ols(pts);
      return f ? Math.sqrt(f.rss / pts.length) : Infinity;
    }
    var N = 240, best = 0, bestV = misfit(0), curve = [];
    for (var k = 0; k <= N; k++) {
      var c = cMax * k / N, v = misfit(c);
      curve.push({ c: c, rms: isFinite(v) ? v : null });
      if (v < bestV) { bestV = v; best = c; }
    }
    /* golden section between the scan neighbours */
    var lo = Math.max(0, best - cMax / N), hi = Math.min(cMax, best + cMax / N), g = 0.5 * (Math.sqrt(5) - 1);
    var x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = misfit(x1), f2 = misfit(x2);
    for (var it = 0; it < 40; it++) {
      if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = misfit(x1); }
      else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = misfit(x2); }
    }
    var cBest = 0.5 * (lo + hi);
    if (misfit(cBest) > bestV) cBest = best;
    var fitPts = dom.map(function (r) { return { x: r.n, y: Math.log(((r.w / W - cBest * (r.f || 0) / F) / (1 - cBest)) / mwOf(r.n)) }; });
    var fit = ols(fitPts);
    var fm = 0, fMol = 0;
    rows.forEach(function (r) { if (r.f > 0) { fm += r.f; fMol += r.f / mwOf(r.n); } });
    var res = rows.map(function (r) {
      var wc = (r.w / W - cBest * (r.f || 0) / F) / (1 - cBest);
      return { n: r.n, w: r.w, f: r.f, plus: !!r.plus, use: r.use, i: r.i, inHump: (r.f || 0) > 0,
               wFit: !r.plus && r.n >= mud.fitFrom ? W * (1 - cBest) * mwOf(r.n) * Math.exp(fit.a + fit.b * r.n) : null,
               /* cleaned, in the same units as w and scaled to the clean oil's share of the sample */
               wClean: Math.max(0, wc) * W * (1 - cBest) };
    });
    return { method: 'subtract', c: cBest, mwF: fMol > 0 ? fm / fMol : null, hump: humpFromFiltrate(rows), humpFrom: 'filtrate',
             fit: fit, rows: res, total: W, cMax: cMax, atLimit: cBest > 0.98 * cMax, curve: curve };
  }

  /* Both estimates where the data allow, and the one in use. */
  function estimate(mud) {
    mud = cleanMud(mud);
    if (!hasData(mud)) return null;
    var s = skim(mud), d = hasFiltrate(mud) ? subtract(mud) : null;
    var want = mud.method === 'auto' ? (d && !d.error ? 'subtract' : 'skim') : mud.method;
    var use = want === 'subtract' ? d || subtract(mud) : s;
    return { skim: s, subtract: d, use: use, method: want };
  }

  /* ------------------------------------------------------------ checks */

  function pc(x, d) { return (100 * x).toFixed(d === undefined ? 1 : d) + ' wt %'; }

  /* [{ key, status, detail }] for the report's check list. */
  function checks(mud, est) {
    mud = cleanMud(mud);
    var out = [];
    if (!est) {
      var why = mud.rows.some(function (r) { return r.n !== null; })
        ? 'Needs the stock-tank oil composition to at least five carbon numbers.'
        : 'No stock-tank oil composition by carbon number entered: the sample is taken as clean.';
      out.push({ key: 'mudLevel', status: 'na', detail: why });
      out.push({ key: 'mudFit', status: 'na', detail: why });
      out.push({ key: 'mudAgree', status: 'na', detail: why });
      return out;
    }
    var u = est.use;
    if (u.error) {
      out.push({ key: 'mudLevel', status: 'fail', detail: u.error });
      out.push({ key: 'mudFit', status: 'na', detail: 'No estimate to check.' });
    } else {
      var how = u.method === 'skim' ? 'Skimming' : 'Subtraction';
      out.push({ key: 'mudLevel', status: u.c < LEVEL_OK ? 'pass' : u.c <= LEVEL_MAX ? 'warn' : 'fail', value: u.c,
        detail: how + ': ' + pc(u.c) + ' of the stock-tank oil is mud filtrate' +
          (u.hump ? ' (C' + u.hump[0] + ' - C' + u.hump[1] + (u.mwF ? ', filtrate MW ' + u.mwF.toFixed(0) : '') + ')' : '') +
          (u.c < 0.005 ? '. Effectively clean.' : u.c < LEVEL_OK ? '. Low: the corrected data are reliable.' :
            u.c <= LEVEL_MAX ? '. Moderate: the corrected data are usable, with care on the bubble point and viscosity.' :
              '. High: the corrections are large and uncertain - a cleaner sample is the better answer.') });
      var r2 = u.fit ? u.fit.r2 : 0;
      var fitMsg = 'The clean C' + mud.fitFrom + '+ trend fits with R² ' + r2.toFixed(3) + ' (' + u.fit.n + ' carbon numbers)';
      if (u.method === 'subtract' && u.atLimit) {
        out.push({ key: 'mudFit', status: 'warn', detail: fitMsg + ', but the subtraction stopped where a cleaned carbon number would go negative: the filtrate composition does not match the contamination in this sample.' });
      } else if (u.method === 'skim' && !u.hump) {
        out.push({ key: 'mudFit', status: r2 >= 0.97 ? 'pass' : 'warn', detail: fitMsg + '; no filtrate hump stands out above it.' });
      } else {
        out.push({ key: 'mudFit', status: r2 >= 0.97 ? 'pass' : r2 >= 0.90 ? 'warn' : 'fail',
          detail: fitMsg + (r2 >= 0.97 ? '.' : r2 >= 0.90 ? ': the profile bends - check the filtrate range and the plot.' :
            ': the profile is not exponential, so the estimate is unreliable. Set the filtrate range by hand or untick odd carbon numbers.') });
      }
    }
    var s = est.skim, d = est.subtract;
    if (s && d && !s.error && !d.error) {
      var diff = Math.abs(s.c - d.c), ok = diff <= Math.max(0.01, 0.25 * Math.max(s.c, d.c));
      out.push({ key: 'mudAgree', status: ok ? 'pass' : 'warn',
        detail: 'Skimming ' + pc(s.c) + ', subtraction ' + pc(d.c) + (ok ? ': the two methods agree.' :
          ': the methods disagree - check the filtrate composition and the fitted range on the plot.') });
    } else {
      out.push({ key: 'mudAgree', status: 'na', detail: d ? 'Needs both estimates.' : 'Enter the filtrate composition to cross-check the skimming with the subtraction method.' });
    }
    return out;
  }

  /* ------------------------------------------------------------ bubble point */

  /* Standing (1947), psia. */
  function standingPb(rs, gg, api, tempF) {
    return 18.2 * (Math.pow(rs / gg, 0.83) * Math.pow(10, 0.00091 * tempF - 0.0125 * api) - 1.4);
  }

  /*
   * Take the filtrate out of the live composition. comp = { rows: [{ c, z }]
   * (mol %), mw7, sg7 }; c7 = filtrate weight fraction of the C7+.
   */
  function cleanComposition(comp, c7, mwF, sgF) {
    var z7Row = comp.rows.filter(function (r) { return r.c === 'C7+'; })[0];
    if (!z7Row || !(z7Row.z > 0) || !(comp.mw7 > 0) || !(comp.sg7 > 0)) return null;
    var z7 = z7Row.z, m7 = z7 * comp.mw7, mF = c7 * m7, nF = mF / mwF;
    if (!(nF < 0.9 * z7)) return null;
    var z7c = z7 - nF, mw7c = (m7 - mF) / z7c;
    var v7 = m7 / comp.sg7 - mF / sgF;
    if (!(v7 > 0)) return null;
    var sg7c = (m7 - mF) / v7;
    var rows = comp.rows.map(function (r) { return { c: r.c, z: r.c === 'C7+' ? z7c : r.z }; });
    var tot = rows.reduce(function (a, r) { return a + (r.z > 0 ? r.z : 0); }, 0);
    rows.forEach(function (r) { if (r.z > 0) r.z = r.z * 100 / tot; });
    return { rows: rows, mw7: mw7c, sg7: sg7c, removedMol: nF * 100 / (tot + nF) };
  }

  var eosMemo = {};
  function eosClean(comp, tempF, pbMeas, c7, mwF, sgF) {
    if (!Eos) return { error: 'The equation of state is not loaded.' };
    var key = JSON.stringify([comp, tempF, pbMeas, c7, mwF, sgF]);
    if (key in eosMemo) return eosMemo[key];
    var r;
    var m = Eos.matchPb(comp, tempF, pbMeas);
    var cc = cleanComposition(comp, c7, mwF, sgF);
    if (!m || m.pb === null) r = { error: 'The equation of state gives no bubble point for the measured composition.' };
    else if (!cc) r = { error: 'The filtrate is more than the C7+ of the reservoir-fluid composition can hold.' };
    else {
      var mix = Eos.mixture({ rows: cc.rows, mw7: cc.mw7, sg7: cc.sg7, kPlus: m.kPlus });
      var s = mix ? Eos.satPressure(mix, tempF, 15000) : null;
      r = s && s.kind === 'bubble'
        ? { pb: pbMeas * s.p / m.pb, pbEos: s.p, matched: m.matched, kPlus: m.kPlus, comp: cc }
        : { error: 'The cleaned composition gives no bubble point at reservoir temperature.' };
    }
    eosMemo[key] = r;
    return r;
  }

  /* ------------------------------------------------------------ correction */

  /*
   * Correct finalised data (reports.finalise) for the contamination.
   * ctx = { mud, est, tempF, composition (live, mol %), pRes }.
   * Returns a new finalised object; fin.mud describes what was done.
   */
  function correct(fin, ctx) {
    var mud = cleanMud(ctx.mud), u = ctx.est && ctx.est.use;
    if (!u || u.error || !mud.apply) return fin;
    var fl = fin.fluid || {};
    var notes = [];
    if (fl.api === null || fl.api === undefined) { fin.notes.push('Mud contamination not corrected: needs the stock-tank oil gravity.'); return fin; }
    var c = u.c, T = num(ctx.tempF);
    var sgF = mud.sgF !== null ? mud.sgF : 0.80;
    if (mud.sgF === null) notes.push('Filtrate specific gravity not entered: 0.80 assumed (typical of mineral and synthetic base oils).');
    var bF = mud.bF !== null ? mud.bF : T !== null ? 1 + 4e-4 * (T - 60) : 1.05;
    var gO = gammaO(fl.api), vF = c * gO / sgF;
    if (!(vF < 0.6)) { fin.notes.push('Mud contamination not corrected: the filtrate would be ' + (100 * vF).toFixed(0) + ' % of the stock-tank oil volume.'); return fin; }
    var gOc = (gO - vF * sgF) / (1 - vF), apiC = apiOf(gOc);
    var rsK = 1 / (1 - vF);
    var boC = function (bo) { return bo === null || bo === undefined ? bo : (bo - vF * bF) / (1 - vF); };

    /* bubble point of the clean oil */
    var pb0 = fin.pb, pb1 = pb0, pbHow = 'none', eos = null;
    if (pb0) {
      var w7 = c7Fraction(u);
      var mwF = u.mwF || 250;
      if (mud.pbFrom === 'eos' && ctx.composition && T !== null) {
        eos = eosClean(ctx.composition, T, pb0, Math.min(0.9, c / w7), mwF, sgF);
        if (!eos.error) { pb1 = eos.pb; pbHow = 'eos'; }
        else notes.push('Equation-of-state bubble point not available (' + eos.error.replace(/\.$/, '') + '): Standing ratio used.');
      } else if (mud.pbFrom === 'eos') {
        notes.push('No reservoir-fluid composition with the C7+ MW and SG: the bubble point is corrected with the Standing ratio.');
      }
      if (pbHow === 'none' && fl.rsb > 0 && fl.gammaG > 0 && T !== null) {
        var s0 = standingPb(fl.rsb, fl.gammaG, fl.api, T), s1 = standingPb(fl.rsb * rsK, fl.gammaG, apiC, T);
        if (s0 > 0 && s1 > 0) { pb1 = pb0 * s1 / s0; pbHow = 'corr'; }
      }
      if (pbHow === 'none') notes.push('Bubble point not corrected: needs Rsb, gas gravity and temperature.');
    }

    /* viscosity */
    var muK = 1, muod1 = fin.muod;
    if (fin.muod !== null && fin.muod > 0 && mud.muF > 0) {
      muod1 = Math.exp((Math.log(fin.muod) - vF * Math.log(mud.muF)) / (1 - vF));
      muK = muod1 / fin.muod;
    } else if (fin.muod !== null || fin.rows.some(function (r) { return r.muo !== null; })) {
      notes.push('Filtrate viscosity at reservoir temperature not entered: oil viscosities are not corrected.');
    }

    /* rows: correct, then map onto the clean oil's pressures */
    var k = pb0 && pb1 ? pb1 / pb0 : 1, dp = pb0 && pb1 ? pb1 - pb0 : 0;
    var rows = [];
    fin.rows.forEach(function (r) {
      var sat = !pb0 || r.p <= pb0 * 1.001;
      var p1 = r.p < 50 ? r.p : sat ? r.p * k : r.p + dp;
      var o = { p: p1, rs: r.rs === null || r.rs === undefined ? null : r.rs * rsK, bo: boC(r.bo),
                muo: r.muo === null || r.muo === undefined ? null : r.muo * muK, z: r.z, mug: r.mug, src: r.src };
      var moved = Math.abs(p1 - r.p) > 1e-6;
      var hasOil = o.rs !== null || o.bo !== null || o.muo !== null;
      if (moved && (r.z !== null && r.z !== undefined || r.mug !== null && r.mug !== undefined)) {
        /* gas properties stay at the pressure they were measured at */
        rows.push({ p: r.p, rs: null, bo: null, muo: null, z: r.z, mug: r.mug, src: r.src + ' gas' });
        o.z = null; o.mug = null;
        if (hasOil) rows.push(o);
      } else rows.push(o);
    });
    rows.sort(function (a, b) { return b.p - a.p; });

    var out = {};
    for (var key in fin) out[key] = fin[key];
    out.fluid = {};
    for (var key2 in fl) out.fluid[key2] = fl[key2];
    out.fluid.api = apiC;
    out.fluid.rsb = fl.rsb === null ? null : fl.rsb * rsK;
    out.bob = boC(fin.bob);
    out.pb = pb1;
    out.muod = muod1;
    out.rows = rows;
    if (eos && eos.comp) out.composition = { rows: eos.comp.rows, mw7: eos.comp.mw7, sg7: eos.comp.sg7 };
    out.mud = {
      c: c, vF: vF, method: u.method, pbFrom: pbHow, sgF: sgF, bF: bF, muF: mud.muF, mwF: u.mwF,
      eos: eos && !eos.error ? { pbEos: eos.pbEos, kPlus: eos.kPlus, matched: eos.matched, removedMol: eos.comp.removedMol } : null,
      before: { pb: pb0, rsb: fl.rsb, bob: fin.bob, api: fl.api, muod: fin.muod },
      after: { pb: pb1, rsb: out.fluid.rsb, bob: out.bob, api: apiC, muod: muod1 }
    };
    var how = pbHow === 'eos' ? 'Peng-Robinson flash of the cleaned composition' : pbHow === 'corr' ? 'Standing ratio' : 'not corrected';
    out.notes = fin.notes.concat([
      'Corrected for ' + (100 * c).toFixed(1) + ' wt % mud filtrate in the stock-tank oil (' + (100 * vF).toFixed(1) +
      ' % by volume, ' + (u.method === 'skim' ? 'skimming' : 'subtraction') + '): Rs ÷ ' + (1 - vF).toFixed(4) +
      ', Bo = (Bo − ' + vF.toFixed(4) + ' × ' + bF.toFixed(3) + ') / ' + (1 - vF).toFixed(4) + ', API ' + fl.api.toFixed(1) + ' → ' + apiC.toFixed(1) +
      (pb0 ? ', bubble point ' + Math.round(pb0) + ' → ' + Math.round(pb1) + ' psia (' + how + ')' : '') + '.',
      pb0 && Math.abs(k - 1) > 1e-6 ? 'Saturated rows are stretched in pressure by ' + k.toFixed(4) + ' and undersaturated rows shifted by ' +
        Math.round(dp) + ' psi to the clean bubble point; gas z and viscosity stay at their measured pressures.' : null
    ].filter(Boolean)).concat(notes);
    if (ctx.pRes && pb1 > ctx.pRes) out.notes.push('The corrected bubble point (' + Math.round(pb1) + ' psia) is above the reservoir pressure at sampling (' +
      Math.round(ctx.pRes) + ' psia): the clean oil would have been saturated. Check the contamination level.');
    return out;
  }

  /* Weight fraction of the STO in C7+ (the filtrate sits there entirely). */
  function c7Fraction(u) {
    var tot = 0, w7 = 0;
    (u.rows || []).forEach(function (r) { tot += r.w; if (r.n >= 7) w7 += r.w; });
    return tot > 0 && w7 > 0 ? w7 / tot : 1;
  }

  return {
    KF: KF, mwOf: mwOf, LEVEL_OK: LEVEL_OK, LEVEL_MAX: LEVEL_MAX,
    emptyMud: emptyMud, cleanMud: cleanMud, hasData: hasData, hasFiltrate: hasFiltrate,
    skim: skim, subtract: subtract, estimate: estimate, checks: checks,
    standingPb: standingPb, cleanComposition: cleanComposition, correct: correct
  };
});
