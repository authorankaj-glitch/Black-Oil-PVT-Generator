/*
 * Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. MIT licence (see LICENSE).
 *
 * eos.js -- a small Peng-Robinson equation of state for drawing the
 * pressure-temperature phase envelope of a measured composition.
 *
 * It answers two questions the black-oil correlations cannot: where the
 * two-phase region of THIS fluid lies (bubble and dew lines, critical
 * point, cricondenbar, cricondentherm), and whether a reported composition
 * is consistent with the reported bubble point. It is not a tuned
 * compositional PVT model: the C7+ fraction is characterised from its
 * molecular weight and specific gravity alone, so expect saturation
 * pressures within about 10-15 % before the one adjustment made here (the
 * C1 - C7+ interaction coefficient, regressed to a measured bubble point).
 *
 * Method
 *   Peng & Robinson (1976), with the 1978 m(omega) for heavy components.
 *   Library components N2 ... C6: Tc, Pc, MW from the GPSA Engineering Data
 *     Book; acentric factors from Reid, Prausnitz & Poling (1987).
 *   C7+: exponential molar distribution over single carbon numbers C7-C50
 *     (Katz, 1983 form; MW_n = 14 n - 4) honouring the C7+ MW; specific
 *     gravities by Soreide (1989) at a constant characterisation factor
 *     honouring the C7+ SG; Tb by Soreide (1989); Tc, Pc and omega by Kesler
 *     & Lee (1976); lumped into three pseudo-components of equal weight.
 *   Binary interaction: N2, CO2, H2S with hydrocarbons and C1 with the C7+
 *     pseudo-components (typical published values); zero otherwise. The
 *     C1 - C7+ coefficient is the one adjustment made to honour a measured
 *     bubble point (matchPb).
 *   Stability: Michelsen (1982) tangent-plane test from Wilson K-values,
 *     vapour-like and liquid-like trial phases.
 *   Flash: Rachford-Rice with successive substitution of K = phiL / phiV.
 *   Envelope: each isotherm is scanned in pressure for instability and the
 *     edges are bisected; the upper edge is a bubble point where the
 *     incipient phase is vapour and a dew point where it is liquid, which
 *     locates the critical point between the two.
 *
 * Units: degF and psia at the interface, degR inside; mole percent in,
 * mole fractions inside.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PVTEos = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = 10.7316;                 /* psia ft3 / (lbmol degR) */
  var TZ = 459.67;
  var SQ2 = Math.SQRT2;
  var K_PLUS = 0.03;               /* default C1 - C7+ interaction */

  /* name: [MW, Tc degR, Pc psia, omega] */
  var LIB = {
    N2: [28.013, 227.2, 492.8, 0.0372],
    CO2: [44.010, 547.4, 1069.5, 0.2239],
    H2S: [34.082, 672.1, 1300.0, 0.0942],
    C1: [16.043, 343.0, 667.8, 0.0115],
    C2: [30.070, 549.8, 707.8, 0.0995],
    C3: [44.097, 665.7, 616.3, 0.1523],
    iC4: [58.123, 734.7, 529.1, 0.1770],
    nC4: [58.123, 765.3, 550.7, 0.2002],
    iC5: [72.150, 828.8, 490.4, 0.2275],
    nC5: [72.150, 845.4, 488.6, 0.2515],
    C6: [86.177, 913.4, 436.9, 0.3013]
  };

  /* ------------------------------------------------------------ C7+ */

  /* Soreide (1989) normal boiling point, degR. */
  function soreideTb(m, sg) {
    return 1928.3 - 1.695e5 * Math.pow(m, -0.03522) * Math.pow(sg, 3.266) *
      Math.exp(-4.922e-3 * m - 4.7685 * sg + 3.462e-3 * m * sg);
  }
  /* Kesler & Lee (1976) critical properties and acentric factor. */
  function keslerLee(tb, sg) {
    var tc = 341.7 + 811 * sg + (0.4244 + 0.1174 * sg) * tb + (0.4669 - 3.2623 * sg) * 1e5 / tb;
    var lnPc = 8.3634 - 0.0566 / sg - (0.24244 + 2.2898 / sg + 0.11857 / (sg * sg)) * 1e-3 * tb +
      (1.4685 + 3.648 / sg + 0.47227 / (sg * sg)) * 1e-7 * tb * tb -
      (0.42019 + 1.6977 / (sg * sg)) * 1e-10 * tb * tb * tb;
    var pc = Math.exp(lnPc), tbr = tb / tc, kw = Math.pow(tb, 1 / 3) / sg, w;
    if (tbr < 0.8) {
      var t6 = Math.pow(tbr, 6);
      w = (-Math.log(pc / 14.7) - 5.92714 + 6.09648 / tbr + 1.28862 * Math.log(tbr) - 0.169347 * t6) /
        (15.2518 - 15.6875 / tbr - 13.4721 * Math.log(tbr) + 0.43577 * t6);
    } else {
      w = -7.904 + 0.1352 * kw - 0.007465 * kw * kw + 8.359 * tbr + (1.408 - 0.01063 * kw) / tbr;
    }
    return { tc: tc, pc: pc, w: w };
  }

  function bisect(f, lo, hi, n) {
    var flo = f(lo);
    for (var i = 0; i < (n || 60); i++) {
      var mid = 0.5 * (lo + hi), fm = f(mid);
      if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /* Split C7+ (mole fraction z7, MW, SG) into nGroups pseudo-components. */
  function splitPlus(z7, mw7, sg7, nGroups) {
    nGroups = nGroups || 3;
    var N = [], M = [];
    for (var n = 7; n <= 50; n++) { N.push(n); M.push(14 * n - 4); }
    mw7 = Math.max(M[0] + 4, Math.min(mw7, 380));
    function dist(B) {
      var w = M.map(function (m) { return Math.exp(-B * (m - M[0])); });
      var s = w.reduce(function (a, b) { return a + b; }, 0);
      return w.map(function (v) { return v / s; });
    }
    var B = bisect(function (b) {
      var x = dist(b), mean = 0;
      x.forEach(function (v, i) { mean += v * M[i]; });
      return mean - mw7;
    }, 1e-7, 0.5, 60);
    var x = dist(B);
    /* SG_n = 0.2855 + Cf (M - 66)^0.13 (Soreide), Cf so the mixture SG is sg7 */
    var wt = x.map(function (v, i) { return v * M[i]; });
    var wsum = wt.reduce(function (a, b) { return a + b; }, 0);
    wt = wt.map(function (v) { return v / wsum; });
    var cf = bisect(function (c) {
      var inv = 0;
      wt.forEach(function (w, i) { inv += w / (0.2855 + c * Math.pow(M[i] - 66, 0.13)); });
      return 1 / inv - sg7;
    }, 0.05, 1.0, 60);
    var scn = M.map(function (m, i) {
      var sg = 0.2855 + cf * Math.pow(m - 66, 0.13);
      var tb = soreideTb(m, sg), kl = keslerLee(tb, sg);
      return { x: x[i], w: wt[i], m: m, sg: sg, tc: kl.tc, pc: kl.pc, om: kl.w };
    });
    /* lump: equal weight fractions */
    var groups = [], acc = 0, cur = null, k = 0;
    scn.forEach(function (s) {
      if (!cur) cur = { x: 0, w: 0, mx: 0, tc: 0, pc: 0, om: 0, sgInv: 0 };
      cur.x += s.x; cur.w += s.w; cur.mx += s.x * s.m;
      cur.tc += s.w * s.tc; cur.pc += s.w * s.pc; cur.om += s.w * s.om; cur.sgInv += s.w / s.sg;
      acc += s.w;
      if (acc >= (k + 1) / nGroups - 1e-12 && k < nGroups - 1) { groups.push(cur); cur = null; k++; }
    });
    if (cur && cur.x > 0) groups.push(cur);
    return groups.map(function (g, i) {
      return { c: 'C7+ (' + (i + 1) + ')', z: z7 * g.x, m: g.mx / g.x, tc: g.tc / g.w, pc: g.pc / g.w, w: g.om / g.w,
               sg: g.w / g.sgInv, plus: true };
    });
  }

  /* ------------------------------------------------------------ mixture */

  function kij(a, b, kPlus) {
    var pair = function (p, q) { return (a.c === p && b.c === q) || (a.c === q && b.c === p); };
    var hc = function (x) { return !(x.c === 'N2' || x.c === 'CO2' || x.c === 'H2S'); };
    if (pair('N2', 'CO2')) return 0;
    if (pair('CO2', 'H2S')) return 0.10;
    if (pair('N2', 'H2S')) return 0.13;
    var inert = a.c === 'N2' || a.c === 'CO2' || a.c === 'H2S' ? a : b.c === 'N2' || b.c === 'CO2' || b.c === 'H2S' ? b : null;
    if (inert) {
      var other = inert === a ? b : a;
      if (!hc(other)) return 0;
      if (inert.c === 'N2') return other.c === 'C1' ? 0.025 : 0.10;
      if (inert.c === 'CO2') return other.c === 'C1' ? 0.105 : 0.12;
      return other.c === 'C1' ? 0.07 : 0.06;
    }
    if ((a.c === 'C1' && b.plus) || (b.c === 'C1' && a.plus)) return kPlus;
    return 0;
  }

  /*
   * mixture({ rows: [{ c, z }] (mol %), mw7, sg7, mwMult, kPlus })
 * kPlus is the C1 - C7+ binary interaction coefficient (default 0.03).
   * Unknown components are ignored; the rest is normalised.
   */
  function mixture(o) {
    var comps = [], z7 = 0;
    (o.rows || []).forEach(function (r) {
      var v = +r.z;
      if (!(v > 0)) return;
      if (r.c === 'C7+') { z7 += v; return; }
      var L = LIB[r.c];
      if (!L) return;
      comps.push({ c: r.c, z: v, m: L[0], tc: L[1], pc: L[2], w: L[3] });
    });
    if (z7 > 0) {
      var mw = (o.mw7 || 200) * (o.mwMult || 1), sg = o.sg7 || 0.85;
      splitPlus(z7, mw, sg, o.nGroups || 3).forEach(function (g) { comps.push(g); });
    }
    var tot = comps.reduce(function (a, q) { return a + q.z; }, 0);
    if (!(tot > 0) || comps.length < 2) return null;
    comps.forEach(function (q) { q.z /= tot; });
    var n = comps.length, K = [];
    for (var i = 0; i < n; i++) { K.push([]); for (var j = 0; j < n; j++) K[i].push(i === j ? 0 : kij(comps[i], comps[j], o.kPlus === undefined ? K_PLUS : o.kPlus)); }
    return { comps: comps, n: n, kij: K, z: comps.map(function (q) { return q.z; }),
             mw: comps.reduce(function (a, q) { return a + q.z * q.m; }, 0) };
  }

  /* Temperature-dependent EOS constants, cached on the mixture. */
  function atT(mix, tR) {
    if (mix._t === tR) return mix._c;
    var n = mix.n, a = [], b = [], aij = [];
    mix.comps.forEach(function (q) {
      var m = q.w <= 0.49 ? 0.37464 + 1.54226 * q.w - 0.26992 * q.w * q.w
        : 0.379642 + 1.48503 * q.w - 0.164423 * q.w * q.w + 0.016666 * q.w * q.w * q.w;
      var al = Math.pow(1 + m * (1 - Math.sqrt(tR / q.tc)), 2);
      a.push(0.45724 * R * R * q.tc * q.tc / q.pc * al);
      b.push(0.07780 * R * q.tc / q.pc);
    });
    for (var i = 0; i < n; i++) {
      aij.push(new Float64Array(n));
      for (var j = 0; j < n; j++) aij[i][j] = (1 - mix.kij[i][j]) * Math.sqrt(a[i] * a[j]);
    }
    mix._t = tR; mix._c = { a: a, b: b, aij: aij, T: tR };
    return mix._c;
  }

  /* Real roots of Z^3 + c2 Z^2 + c1 Z + c0 = 0, ascending. */
  function cubic(c2, c1, c0) {
    var q = (3 * c1 - c2 * c2) / 9, r = (9 * c2 * c1 - 27 * c0 - 2 * c2 * c2 * c2) / 54;
    var d = q * q * q + r * r, s = -c2 / 3;
    if (d > 0) {
      var sd = Math.sqrt(d);
      return [s + Math.cbrt(r + sd) + Math.cbrt(r - sd)];
    }
    var th = Math.acos(Math.max(-1, Math.min(1, r / Math.sqrt(-q * q * q)))), m2 = 2 * Math.sqrt(-q);
    return [s + m2 * Math.cos(th / 3), s + m2 * Math.cos((th + 2 * Math.PI) / 3), s + m2 * Math.cos((th + 4 * Math.PI) / 3)]
      .sort(function (x, y) { return x - y; });
  }

  /* ln(phi_i) of a phase of composition x at (T, p); the root with the
     lowest Gibbs energy unless kind forces 'L' (smallest) or 'V' (largest). */
  function lnPhi(mix, x, tR, p, kind) {
    var C = atT(mix, tR), n = mix.n, am = 0, bm = 0, sa = new Float64Array(n), i, j;
    for (i = 0; i < n; i++) {
      var s = 0;
      for (j = 0; j < n; j++) s += x[j] * C.aij[i][j];
      sa[i] = s; am += x[i] * s; bm += x[i] * C.b[i];
    }
    var RT = R * tR, A = am * p / (RT * RT), B = bm * p / RT;
    var roots = cubic(-(1 - B), A - 3 * B * B - 2 * B, -(A * B - B * B - B * B * B)).filter(function (z) { return z > B; });
    if (!roots.length) roots = [B * 1.0001 + 1e-9];
    function phiOf(Z) {
      var out = new Float64Array(n), lg = Math.log((Z + (1 + SQ2) * B) / (Z + (1 - SQ2) * B)), f = A / (2 * SQ2 * B);
      for (var k = 0; k < n; k++) {
        out[k] = C.b[k] / bm * (Z - 1) - Math.log(Z - B) - f * (2 * sa[k] / am - C.b[k] / bm) * lg;
      }
      return out;
    }
    var Z, ph;
    if (roots.length === 1) { Z = roots[0]; ph = phiOf(Z); }
    else if (kind === 'L') { Z = roots[0]; ph = phiOf(Z); }
    else if (kind === 'V') { Z = roots[roots.length - 1]; ph = phiOf(Z); }
    else {
      var zl = roots[0], zv = roots[roots.length - 1], pl = phiOf(zl), pv = phiOf(zv), gl = 0, gv = 0;
      for (i = 0; i < n; i++) { gl += x[i] * pl[i]; gv += x[i] * pv[i]; }
      if (gl <= gv) { Z = zl; ph = pl; } else { Z = zv; ph = pv; }
    }
    return { lnphi: ph, Z: Z, v: Z * RT / p };
  }

  function wilson(mix, tR, p) {
    return mix.comps.map(function (q) { return q.pc / p * Math.exp(5.373 * (1 + q.w) * (1 - q.tc / tR)); });
  }

  /* Michelsen tangent-plane stability test of the feed at (T degF, p psia). */
  function stability(mix, tF, p) {
    var tR = tF + TZ, n = mix.n, z = mix.z, d = new Float64Array(n), i;
    var f = lnPhi(mix, z, tR, p);
    for (i = 0; i < n; i++) d[i] = Math.log(z[i]) + f.lnphi[i];
    var Kw = wilson(mix, tR, p), best = null;
    [1, -1].forEach(function (dir) {
      var W = new Float64Array(n), it, sum = 0;
      for (i = 0; i < n; i++) W[i] = z[i] * Math.pow(Kw[i], dir);
      var trivial = false, conv = false;
      for (it = 0; it < 120; it++) {
        sum = 0; for (i = 0; i < n; i++) sum += W[i];
        var w = new Float64Array(n); for (i = 0; i < n; i++) w[i] = W[i] / sum;
        var ph = lnPhi(mix, w, tR, p), err = 0, triv = 0;
        for (i = 0; i < n; i++) {
          var lnW = d[i] - ph.lnphi[i], e = lnW - Math.log(W[i]);
          err += e * e; W[i] = Math.exp(lnW);
          var t = Math.log(W[i] / z[i]); triv += t * t;
        }
        if (triv < 1e-4) { trivial = true; break; }
        if (err < 1e-12) { conv = true; break; }
      }
      sum = 0; for (i = 0; i < n; i++) sum += W[i];
      if (!trivial && sum > 1 + 1e-7) {
        var K = new Float64Array(n);
        for (i = 0; i < n; i++) K[i] = dir > 0 ? W[i] / sum / z[i] : z[i] / (W[i] / sum);
        if (!best || sum > best.sum) best = { sum: sum, K: K, conv: conv };
      }
    });
    return best ? { stable: false, K: best.K, tm: 1 - best.sum } : { stable: true };
  }

  function rachfordRice(z, K) {
    var n = z.length, kmin = Infinity, kmax = -Infinity, i;
    for (i = 0; i < n; i++) { kmin = Math.min(kmin, K[i]); kmax = Math.max(kmax, K[i]); }
    var lo = 1 / (1 - kmax) + 1e-12, hi = 1 / (1 - kmin) - 1e-12;
    function g(b) { var s = 0; for (var k = 0; k < n; k++) s += z[k] * (K[k] - 1) / (1 + b * (K[k] - 1)); return s; }
    var b = Math.min(Math.max(0.5, lo + 1e-9), hi - 1e-9);
    for (var it = 0; it < 100; it++) {
      var gv = g(b), dg = 0;
      for (i = 0; i < n; i++) { var t = (K[i] - 1) / (1 + b * (K[i] - 1)); dg -= z[i] * t * t; }
      if (gv > 0) lo = b; else hi = b;
      var nb = b - gv / dg;
      if (!(nb > lo && nb < hi)) nb = 0.5 * (lo + hi);
      if (Math.abs(nb - b) < 1e-12) { b = nb; break; }
      b = nb;
    }
    return b;
  }

  /* Two-phase flash; returns null when the feed is a single phase. */
  function flash(mix, tF, p, Kstart) {
    var st = Kstart ? { stable: false, K: Kstart } : stability(mix, tF, p);
    if (st.stable) return null;
    var tR = tF + TZ, n = mix.n, z = mix.z, K = Float64Array.from(st.K), b, x, y, L, V, i;
    for (var it = 0; it < 400; it++) {
      b = rachfordRice(z, K);
      x = new Float64Array(n); y = new Float64Array(n);
      for (i = 0; i < n; i++) { x[i] = z[i] / (1 + b * (K[i] - 1)); y[i] = K[i] * x[i]; }
      var sx = 0, sy = 0; for (i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
      for (i = 0; i < n; i++) { x[i] /= sx; y[i] /= sy; }
      L = lnPhi(mix, x, tR, p); V = lnPhi(mix, y, tR, p);
      var err = 0;
      for (i = 0; i < n; i++) { var nk = Math.exp(L.lnphi[i] - V.lnphi[i]); var e = Math.log(nk / K[i]); err += e * e; K[i] = nk; }
      if (err < 1e-14) break;
    }
    if (!(b > 0 && b < 1)) return null;
    var vl = (1 - b) * L.v, vv = b * V.v;
    return { beta: b, x: x, y: y, ZL: L.Z, ZV: V.Z, liqVol: vl / (vl + vv), K: K };
  }

  /* Is the feed two-phase at (T, p)? */
  function twoPhase(mix, tF, p) { return !stability(mix, tF, p).stable; }

  /* Scan one isotherm: the lowest and highest pressure of the two-phase
     band, each bisected to 0.1 %, or null when the isotherm is single-phase. */
  function column(mix, tF, grid) {
    var flags = grid.map(function (p) { return twoPhase(mix, tF, p); });
    var i0 = flags.indexOf(true), i1 = flags.lastIndexOf(true);
    if (i0 < 0) return null;
    function edge(pin, pout) {
      for (var k = 0; k < 24 && Math.abs(Math.log(pout / pin)) > 1e-3; k++) {
        var mid = Math.sqrt(pin * pout);
        if (twoPhase(mix, tF, mid)) pin = mid; else pout = mid;
      }
      return pin;
    }
    var lo = i0 > 0 ? edge(grid[i0], grid[i0 - 1]) : grid[0];
    var hi = i1 < grid.length - 1 ? edge(grid[i1], grid[i1 + 1]) : grid[grid.length - 1];
    /* bubble or dew at the upper edge: what forms first is vapour or liquid */
    var fl = flash(mix, tF, hi * 0.997), kind = 'dew';
    if (fl) kind = fl.beta < 0.5 ? 'bubble' : 'dew';
    return { t: tF, lo: lo, hi: hi, kind: kind, open: i1 === grid.length - 1, floor: i0 === 0 };
  }

  /* Saturation pressure on one isotherm (upper edge), psia, or null. */
  function satPressure(mix, tF, pMax) {
    var grid = logGrid(5, pMax || 12000, 40);
    var c = column(mix, tF, grid);
    return c ? { p: c.hi, kind: c.kind, lo: c.lo } : null;
  }

  function logGrid(a, b, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(a * Math.pow(b / a, i / (n - 1)));
    return out;
  }

  /*
   * Phase envelope of a mixture.
   *   opts: { tMin, tMax (degF), pMax (psia), levels: liquid volume fractions }
   * Returns { bubble, dew, crit, cricondentherm, cricondenbar, quality }
   * with the same point layout ({ t, p }) the schematic envelope uses.
   */
  function envelope(mix, opts) {
    opts = opts || {};
    var pMax = opts.pMax || 12000, grid = logGrid(2, pMax, 44);
    var tLo = opts.tMin === undefined ? -250 : opts.tMin, tHi = opts.tMax || 1100;
    /* coarse pass to find the two-phase temperature range */
    var coarse = [], i;
    for (i = 0; i <= 30; i++) {
      var t = tLo + (tHi - tLo) * i / 30, c = column(mix, t, grid);
      if (c) coarse.push(c);
    }
    if (!coarse.length) return null;
    var tFirst = coarse[0].t, tLast = coarse[coarse.length - 1].t;
    var step = (tHi - tLo) / 30;
    /* the cricondentherm: bisect the last two-phase isotherm */
    var a = tLast, b = Math.min(tLast + step, tHi + step);
    for (i = 0; i < 9; i++) { var m = 0.5 * (a + b); if (column(mix, m, grid)) a = m; else b = m; }
    var tct = a;
    var t0 = Math.max(tLo, tFirst - (tFirst > tLo ? step : 0));
    var cols = [], nC = 44;
    for (i = 0; i <= nC; i++) {
      /* crowd the isotherms towards the cricondentherm, where the nose turns */
      var s = i / nC, tt = t0 + (tct - t0) * (1 - Math.pow(1 - s, 1.6));
      var cc = column(mix, tt, grid);
      if (cc) cols.push(cc);
    }
    if (cols.length < 3) return null;
    /* critical point: where the upper edge turns from bubble to dew */
    var crit = null;
    for (i = 1; i < cols.length; i++) {
      if (cols[i - 1].kind === 'bubble' && cols[i].kind === 'dew') {
        crit = { t: 0.5 * (cols[i - 1].t + cols[i].t), p: 0.5 * (cols[i - 1].hi + cols[i].hi) };
        break;
      }
    }
    if (!crit) {
      crit = cols[0].kind === 'dew' ? { t: cols[0].t, p: cols[0].hi } : { t: cols[cols.length - 1].t, p: cols[cols.length - 1].hi };
    }
    var bubble = cols.filter(function (c) { return c.kind === 'bubble' && c.t < crit.t; }).map(function (c) { return { t: c.t, p: c.hi }; });
    bubble.push(crit);
    var upperDew = cols.filter(function (c) { return c.kind === 'dew' && c.t > crit.t; }).map(function (c) { return { t: c.t, p: c.hi }; });
    var lowerDew = cols.slice().reverse().map(function (c) { return { t: c.t, p: c.lo }; });
    var dew = [crit].concat(upperDew, [{ t: tct, p: Math.sqrt(cols[cols.length - 1].lo * cols[cols.length - 1].hi) }], lowerDew);
    var cb = cols.reduce(function (acc, c) { return c.hi > acc.p ? { t: c.t, p: c.hi } : acc; }, { t: 0, p: 0 });

    /* iso-liquid-volume lines: crossings along each isotherm */
    var levels = opts.levels || [0.75, 0.5, 0.25];
    var quality = levels.map(function (q) { return { q: q, up: [], down: [] }; });
    cols.forEach(function (c) {
      if (c.hi / c.lo < 1.02) return;
      var ps = logGrid(c.lo * 1.002, c.hi * 0.998, 18), lv = ps.map(function (p) { var f = flash(mix, c.t, p); return f ? f.liqVol : null; });
      quality.forEach(function (Q) {
        for (var k = 1; k < ps.length; k++) {
          var l0 = lv[k - 1], l1 = lv[k];
          if (l0 === null || l1 === null || (l0 - Q.q) * (l1 - Q.q) > 0 || l0 === l1) continue;
          var pq = ps[k - 1] + (Q.q - l0) * (ps[k] - ps[k - 1]) / (l1 - l0);
          (l1 > l0 ? Q.up : Q.down).push({ t: c.t, p: pq });
        }
      });
    });
    quality = quality.map(function (Q) {
      var pts = Q.up.sort(function (x, y) { return x.t - y.t; }).concat(Q.down.sort(function (x, y) { return y.t - x.t; }));
      if (pts.length) pts.push(crit);
      return { q: Q.q, points: pts };
    }).filter(function (Q) { return Q.points.length >= 4; });

    return { bubble: bubble, dew: dew, crit: crit, tct: tct, cricondenbar: cb, quality: quality,
             tFirst: cols[0].t, floorOpen: cols[0].floor };
  }

  /*
   * Adjust the C1 - C7+ binary interaction coefficient (0 to 0.20, the
   * usual regression variable for a bubble point) so the bubble point at tF
   * equals target. Returns { kPlus, pb, pbBase, matched }: pbBase is the
   * bubble point the composition gives with the default coefficient.
   */
  function matchPb(o, tF, target) {
    var base = mixture(o);
    if (!base) return null;
    var sb = satPressure(base, tF, 12000);
    var pbBase = sb && sb.kind === 'bubble' ? sb.p : null;
    if (pbBase === null || !(target > 0)) return { kPlus: K_PLUS, pb: pbBase, pbBase: pbBase, matched: false };
    function pbAt(k) {
      var s = satPressure(mixture(Object.assign({}, o, { kPlus: k })), tF, 12000);
      return s && s.kind === 'bubble' ? s.p : null;
    }
    var lo = 0, hi = 0.2, plo = pbAt(lo), phi = pbAt(hi);
    if (plo === null || phi === null) return { kPlus: K_PLUS, pb: pbBase, pbBase: pbBase, matched: false };
    if ((target - plo) * (target - phi) > 0) {
      var nearLo = Math.abs(target - plo) < Math.abs(target - phi);
      return { kPlus: nearLo ? lo : hi, pb: nearLo ? plo : phi, pbBase: pbBase, matched: false };
    }
    var inc = phi > plo;
    for (var i = 0; i < 16; i++) {
      var mid = 0.5 * (lo + hi), pm = pbAt(mid);
      if (pm === null) break;
      if ((pm < target) === inc) lo = mid; else hi = mid;
    }
    var k = 0.5 * (lo + hi);
    return { kPlus: k, pb: pbAt(k), pbBase: pbBase, matched: true };
  }

  return {
    LIB: LIB, mixture: mixture, splitPlus: splitPlus, lnPhi: lnPhi, stability: stability, flash: flash,
    twoPhase: twoPhase, satPressure: satPressure, envelope: envelope, matchPb: matchPb,
    keslerLee: keslerLee, soreideTb: soreideTb
  };
});
