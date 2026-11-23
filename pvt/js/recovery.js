/*
 * PhaseWiz - Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. PolyForm Noncommercial License 1.0.0 (see LICENSE).
 *
 * recovery.js -- screening recovery factors from the PVT model.
 *
 * Every estimate here is a tank (zero-dimensional) or one-dimensional
 * calculation driven by the fluid properties of the current PVT model, with
 * a handful of rock properties that start at typical defaults and can be
 * overridden. There is no geology, no well, no rate and no time: these are
 * screening numbers for comparing fluids and checking analogues, not a
 * reserves or resources estimate (SPE-PRMS) and not a simulation forecast.
 * Field units throughout (psia, degF, bbl, scf, cp).
 *
 * Oil reservoirs
 *   Expansion above the bubble point (material balance, no free gas, no
 *   aquifer):
 *     RF(p) = [ (Bo - Boi) + Boi (cw Swi + cf) (pi - p) / (1 - Swi) ] / Bo
 *   Solution-gas drive below the bubble point (Muskat, 1945): one tank at
 *   uniform pressure, no gas cap, no gravity segregation; produced gas and
 *   oil leave in the ratio of their mobilities:
 *     dSo/dp = [ So (Bg/Bo) dRs/dp + So (krg/kro)(muo/mug)(1/Bo) dBo/dp
 *                + (1 - So - Swi) Bg d(1/Bg)/dp ] / [ 1 + (muo/mug)(krg/kro) ]
 *   (checked by the gas balance: gas dissolved at Pb = gas still dissolved
 *   + free gas in the tank + the integral of R dNp, see the tests)
 *     RF = 1 - (1 - RFb) (So / Bo) (Bob / (1 - Swi))
 *     producing GOR  R = Rs + (krg/kro)(muo/mug)(Bo/Bg)
 *   It starts at the bubble point with So = 1 - Swi and the oil the
 *   expansion left (RFb); rock and water compressibility are neglected
 *   below it.
 *   Integrated with the fourth-order Runge-Kutta method on a fine pressure
 *   grid of the PVT properties.
 *   Water drive (Buckley-Leverett, 1942; Welge, 1952): displacement at a
 *   constant pressure with the oil and water viscosities of the PVT model
 *   at that pressure. fw = 1 / (1 + (kro/muo)/(krw/muw)), no gravity or
 *   capillary pressure. The Welge tangent from (Swi, 0) gives breakthrough;
 *   after it Sw_avg = Sw2 + (1 - fw2) / fw'(Sw2). The result is a
 *   DISPLACEMENT efficiency, Ed = (Sw_avg - Swi)/(1 - Swi): recovery with
 *   complete areal and vertical sweep. Field recovery is Ed x sweep, which
 *   depends on geology and wells and is not estimated here.
 *   Cross-check (Arps et al., API 1967), recovery in % of oil in place:
 *     solution-gas drive  41.815 [phi(1-Swi)/Bob]^0.1611 (k/muob)^0.0979
 *                         Swi^0.3722 (pb/pa)^0.1741
 *     water drive         54.898 [phi(1-Swi)/Boi]^0.0422 (k muwi/muoi)^0.0770
 *                         Swi^-0.1903 (pi/pa)^-0.2159
 *     k in darcy. A regression of 1960s field data with wide scatter:
 *     indicative only.
 *
 * Gas reservoirs
 *   Volumetric depletion:  RF(p) = 1 - (p/z) / (pi/zi)
 *   Water drive with trapped gas (pressure held at pw):
 *     RF = 1 - (Bgi / Bg(pw)) (Sgr / (1 - Swi))
 *   Rock and water compressibility are neglected.
 *
 * Relative permeability: Corey curves.
 *   gas-oil (connate water present)
 *     kro = kroMax ((So - Sorg)/(1 - Swi - Sorg))^no
 *     krg = krgMax ((Sg - Sgc)/(1 - Swi - Sorg - Sgc))^ng
 *   water-oil
 *     Swn = (Sw - Swi)/(1 - Swi - Sorw)
 *     krw = krwMax Swn^nw,  krow = kroMax (1 - Swn)^now
 *
 * Every result carries a basis: the method, its reference, the PVT values it
 * used, each rock input marked default or entered, and its assumptions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./correlations.js'));
  else root.PVTRecovery = factory(root.PVTCorr);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var BBL = 5.614583;    /* ft3 per bbl */

  /* Rock and economic inputs: default, label, unit kind, sensitivity range
     (low, high) used while the input is still at its default. */
  var INPUTS = {
    pi:    { label: 'Initial reservoir pressure', kind: 'p', def: null, note: 'default: the highest table pressure' },
    pa:    { label: 'Abandonment pressure', kind: 'p', def: null, note: 'default: 10 % of the initial pressure, at least 100 psia' },
    pw:    { label: 'Pressure held during water drive', kind: 'p', def: null, note: 'default: the initial pressure' },
    swi:   { label: 'Initial (connate) water saturation, Swi', def: 0.20, lo: 0.10, hi: 0.30, frac: true },
    cf:    { label: 'Rock (pore) compressibility, cf', kind: 'c', def: null, note: 'default: the rock compressibility of the case inputs' },
    sgc:   { label: 'Critical gas saturation, Sgc', def: 0.05, lo: 0.02, hi: 0.10, frac: true },
    sorg:  { label: 'Residual oil to gas, Sorg', def: 0.15, lo: 0.10, hi: 0.25, frac: true },
    sorw:  { label: 'Residual oil to water, Sorw', def: 0.25, lo: 0.15, hi: 0.35, frac: true },
    sgr:   { label: 'Trapped (residual) gas, Sgr', def: 0.25, lo: 0.15, hi: 0.35, frac: true },
    no:    { label: 'Corey exponent, oil (gas-oil), no', def: 2, lo: 1.5, hi: 3 },
    ng:    { label: 'Corey exponent, gas, ng', def: 2, lo: 1.5, hi: 3 },
    now:   { label: 'Corey exponent, oil (water-oil), now', def: 2, lo: 1.5, hi: 3 },
    nw:    { label: 'Corey exponent, water, nw', def: 2, lo: 1.5, hi: 3 },
    kroMax:{ label: 'kro at Swi (end point)', def: 1.0 },
    krgMax:{ label: 'krg end point', def: 0.8 },
    krwMax:{ label: 'krw at Sorw (end point)', def: 0.3 },
    fwMax: { label: 'Economic water cut', def: 0.98, frac: true },
    phi:   { label: 'Porosity (API cross-check only)', def: 0.20, frac: true },
    kmd:   { label: 'Permeability, mD (API cross-check only)', def: 100 }
  };
  var ORDER = ['pi', 'pa', 'pw', 'swi', 'cf', 'sgc', 'sorg', 'sorw', 'sgr', 'no', 'ng', 'now', 'nw',
               'kroMax', 'krgMax', 'krwMax', 'fwMax', 'phi', 'kmd'];
  /* which inputs each method reads */
  var USES = {
    expansion: ['pi', 'swi', 'cf'],
    muskat: ['pi', 'pa', 'swi', 'cf', 'sgc', 'sorg', 'no', 'ng', 'kroMax', 'krgMax'],
    water: ['pw', 'swi', 'sorw', 'now', 'nw', 'kroMax', 'krwMax', 'fwMax'],
    api: ['pi', 'pa', 'swi', 'phi', 'kmd'],
    gasDepletion: ['pi', 'pa'],
    gasWater: ['pi', 'pw', 'swi', 'sgr']
  };

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /* Entered values (field units; null = use the default). */
  function cleanInputs(o) {
    o = o || {};
    var r = {};
    ORDER.forEach(function (k) { r[k] = num(o[k]); });
    return r;
  }

  /* Resolve every input to a value, remembering which are defaults. */
  function resolve(model, entered) {
    entered = cleanInputs(entered);
    var inp = model.input || {};
    var top = model.fluid === 'gas' ? model.gas[model.gas.length - 1].p : model.oil[model.oil.length - 1].p;
    var v = {}, isDef = {};
    ORDER.forEach(function (k) {
      isDef[k] = entered[k] === null;
      v[k] = isDef[k] ? INPUTS[k].def : entered[k];
    });
    if (v.pi === null) v.pi = Math.max(top, model.pb || 0);
    if (v.pa === null) v.pa = Math.max(100, 0.1 * v.pi);
    if (v.cf === null) v.cf = num(inp.rockComp) !== null ? inp.rockComp : 4e-6;
    if (v.pw === null) v.pw = v.pi;
    return { v: v, isDef: isDef };
  }

  /* Validate the resolved inputs; returns a list of messages (empty = ok). */
  function validate(model, v) {
    var e = [];
    if (!(v.pi > v.pa)) e.push('The initial pressure must exceed the abandonment pressure.');
    if (!(v.pa >= 14.7)) e.push('The abandonment pressure must be at least 14.7 psia.');
    ['swi', 'sgc', 'sorg', 'sorw', 'sgr'].forEach(function (k) {
      if (!(v[k] >= 0 && v[k] < 1)) e.push(INPUTS[k].label + ' must lie between 0 and 1.');
    });
    if (v.swi + v.sorg + v.sgc >= 0.95) e.push('Swi + Sorg + Sgc leaves no mobile gas-oil saturation.');
    if (v.swi + v.sorw >= 0.95) e.push('Swi + Sorw leaves no mobile oil for the water drive.');
    if (v.sgr >= 1 - v.swi) e.push('The trapped gas saturation must be below 1 - Swi.');
    ['no', 'ng', 'now', 'nw'].forEach(function (k) { if (!(v[k] >= 1 && v[k] <= 6)) e.push(INPUTS[k].label + ' must lie between 1 and 6.'); });
    ['kroMax', 'krgMax', 'krwMax'].forEach(function (k) { if (!(v[k] > 0 && v[k] <= 1)) e.push(INPUTS[k].label + ' must lie between 0 and 1.'); });
    if (!(v.fwMax > 0.5 && v.fwMax < 1)) e.push('The economic water cut must lie between 0.5 and 1.');
    if (!(v.phi > 0 && v.phi < 0.5)) e.push('Porosity must lie between 0 and 0.5.');
    if (!(v.kmd > 0)) e.push('Permeability must be positive.');
    if (!(v.cf >= 0 && v.cf < 1e-3)) e.push('Rock compressibility must lie between 0 and 1e-3 1/psi.');
    if (!(v.pw >= v.pa && v.pw <= v.pi * 1.0001)) e.push('The water-drive pressure must lie between the abandonment and initial pressures.');
    return e;
  }

  /* ------------------------------------------------------------ kr */

  function corey(v) {
    var mGO = 1 - v.swi - v.sorg, mG = 1 - v.swi - v.sorg - v.sgc, mWO = 1 - v.swi - v.sorw;
    var cl = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
    return {
      kro: function (so) { return v.kroMax * Math.pow(cl((so - v.sorg) / mGO), v.no); },
      krg: function (sg) { return v.krgMax * Math.pow(cl((sg - v.sgc) / mG), v.ng); },
      krw: function (sw) { return v.krwMax * Math.pow(cl((sw - v.swi) / mWO), v.nw); },
      krow: function (sw) { return v.kroMax * Math.pow(1 - cl((sw - v.swi) / mWO), v.now); }
    };
  }

  /* Curves for the kr chart. */
  function krCurves(v) {
    var k = corey(v), go = [], wo = [], i, n = 50;
    for (i = 0; i <= n; i++) {
      var sg = (1 - v.swi - v.sorg) * i / n;
      go.push({ sg: sg, sl: 1 - sg, krg: k.krg(sg), kro: k.kro(1 - v.swi - sg) });
      var sw = v.swi + (1 - v.swi - v.sorw) * i / n;
      wo.push({ sw: sw, krw: k.krw(sw), kro: k.krow(sw) });
    }
    return { gasOil: go, waterOil: wo };
  }

  /* ------------------------------------------------------------ oil */

  /* PVT on a fine pressure grid from pLo to pHi (field units, Bg bbl/scf). */
  function pvtGrid(model, pLo, pHi, n) {
    var g = [];
    for (var i = 0; i <= n; i++) {
      var p = pLo + (pHi - pLo) * i / n, r = model.at(p);
      g.push({ p: p, rs: r.rs, bo: r.bo, muo: r.muo, bg: r.bg / BBL, mug: r.mug, z: r.z });
    }
    return g;
  }
  function interp(g, p, key) {
    var n = g.length - 1, lo = g[0].p, hi = g[n].p;
    var t = (p - lo) / (hi - lo) * n, i = Math.max(0, Math.min(n - 1, Math.floor(t))), f = t - i;
    return g[i][key] + (g[i + 1][key] - g[i][key]) * f;
  }
  function dPdx(g, p, key) {
    var n = g.length - 1, h = (g[n].p - g[0].p) / n;
    var a = Math.max(g[0].p, p - h), b = Math.min(g[n].p, p + h);
    return (interp(g, b, key) - interp(g, a, key)) / (b - a);
  }

  function expansion(model, v) {
    var pb = model.pb, pi = v.pi, inp = model.input || {};
    if (!(pi > pb + 1)) return { rf: 0, curve: [{ p: pi, rf: 0 }], boi: model.at(pi).bo, skipped: true };
    var boi = model.at(pi).bo, curve = [], n = 40;
    for (var i = 0; i <= n; i++) {
      var p = pi - (pi - pb) * i / n, bo = model.at(p).bo;
      var cw = C.waterCompressibility(p, inp.tempF, inp.salinity);
      var rf = ((bo - boi) + boi * (cw * v.swi + v.cf) * (pi - p) / (1 - v.swi)) / bo;
      curve.push({ p: p, rf: rf });
    }
    return { rf: curve[n].rf, curve: curve, boi: boi };
  }

  function muskat(model, v, rfPb, boi) {
    var pb = Math.min(model.pb, v.pi), pa = v.pa, kr = corey(v);
    if (!(pb > pa)) return { error: 'The abandonment pressure is above the bubble point: there is no solution-gas drive.' };
    var g = pvtGrid(model, Math.max(14.7, pa * 0.98), pb, 400);
    /* no free gas at the bubble point: the oil fills the pore volume the
       expanded water and compacted rock leave, So = 1 - Swi */
    var bob = interp(g, pb, 'bo'), so = 1 - v.swi;
    function deriv(p, s) {
      var bo = interp(g, p, 'bo'), bg = interp(g, p, 'bg'), ratio = interp(g, p, 'muo') / interp(g, p, 'mug');
      var sg = 1 - s - v.swi, ko = kr.kro(s), kg = kr.krg(sg);
      var kk = ko > 1e-12 ? kg / ko : 1e6;
      var x = (bg / bo) * dPdx(g, p, 'rs');
      var y = ratio / bo * dPdx(g, p, 'bo');
      var z = bg * dPdx(g, p, 'bg') / -(bg * bg);   /* Bg d(1/Bg)/dp */
      return (s * x + s * kk * y + sg * z) / (1 + ratio * kk);
    }
    function state(p, s) {
      var bo = interp(g, p, 'bo'), bg = interp(g, p, 'bg'), ratio = interp(g, p, 'muo') / interp(g, p, 'mug');
      var sg = 1 - s - v.swi, ko = kr.kro(s), kg = kr.krg(sg);
      var gor = interp(g, p, 'rs') + (ko > 1e-12 ? kg / ko * ratio * bo / bg : NaN);
      /* oil left = oil left at Pb x (So/Bo) / (So,b/Bob) */
      return { p: p, so: s, sg: sg, rf: 1 - (1 - rfPb) * (s / bo) * (bob / (1 - v.swi)), gor: gor, rs: interp(g, p, 'rs'), kro: ko };
    }
    var N = 300, h = (pb - pa) / N, p = pb, s = so, curve = [state(p, s)], stop = null;
    for (var i = 0; i < N; i++) {
      var k1 = deriv(p, s), k2 = deriv(p - h / 2, s - h / 2 * k1), k3 = deriv(p - h / 2, s - h / 2 * k2), k4 = deriv(p - h, s - h * k3);
      var s1 = s - h / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
      p -= h;
      if (!(s1 > v.sorg)) { stop = 'residual'; s = v.sorg; curve.push(state(p, s)); break; }
      s = s1;
      curve.push(state(p, s));
    }
    var last = curve[curve.length - 1];
    var crit = null;
    for (var j = 1; j < curve.length; j++) if (curve[j].sg >= v.sgc && curve[j - 1].sg < v.sgc) { crit = curve[j].p; break; }
    return { rf: last.rf, rfPb: rfPb, curve: curve, pCritGas: crit, stoppedAt: stop ? last.p : null, soPb: so };
  }

  /* Buckley-Leverett with the Welge tangent at pressure pw. */
  function waterDrive(model, v) {
    var inp = model.input || {}, kr = corey(v);
    var pw = model.fluid === 'oil' ? Math.max(v.pw, model.pb) : v.pw;
    var r = model.at(pw), muo = r.muo, muw = C.waterViscosity(pw, inp.tempF, inp.salinity);
    var fw = function (sw) {
      var ko = kr.krow(sw), kw = kr.krw(sw);
      if (kw <= 0) return 0;
      return 1 / (1 + (ko / muo) / (kw / muw));
    };
    var swMax = 1 - v.sorw, n = 2000, pts = [], i;
    for (i = 0; i <= n; i++) { var sw = v.swi + (swMax - v.swi) * i / n; pts.push({ sw: sw, fw: fw(sw) }); }
    var dfw = function (k) {
      var a = Math.max(0, k - 1), b = Math.min(n, k + 1);
      return (pts[b].fw - pts[a].fw) / (pts[b].sw - pts[a].sw);
    };
    /* Welge tangent: the largest fw / (Sw - Swi) */
    var kf = 1, best = 0;
    for (i = 1; i <= n; i++) { var sl = pts[i].fw / (pts[i].sw - v.swi); if (sl > best) { best = sl; kf = i; } }
    var swf = pts[kf].sw, fwf = pts[kf].fw;
    var swbt = v.swi + 1 / best, edBt = (swbt - v.swi) / (1 - v.swi);
    /* after breakthrough */
    var cut = [{ ed: 0, fw: 0, pvi: 0 }, { ed: edBt, fw: 0, pvi: 1 / best }];
    var edMax = edBt, fwAt = fwf, swAt = swbt;
    for (i = kf; i <= n; i++) {
      var d = dfw(i);
      if (!(d > 1e-9)) continue;
      var avg = pts[i].sw + (1 - pts[i].fw) / d, ed = (avg - v.swi) / (1 - v.swi);
      if (ed < cut[cut.length - 1].ed) continue;
      cut.push({ ed: ed, fw: pts[i].fw, pvi: 1 / d });
      if (pts[i].fw <= v.fwMax) { edMax = ed; fwAt = pts[i].fw; swAt = avg; }
    }
    var tangent = [{ sw: v.swi, fw: 0 }, { sw: Math.min(swMax, v.swi + 1 / best), fw: 1 }];
    var mob = (v.krwMax / muw) / (v.kroMax / muo);
    return {
      pw: pw, muo: muo, muw: muw, mobility: mob,
      swf: swf, fwf: fwf, edBt: edBt, ed: edMax, swAvg: swAt,
      edLimit: (1 - v.swi - v.sorw) / (1 - v.swi),
      fwCurve: pts.filter(function (q, k) { return k % 20 === 0; }), tangent: tangent, cut: cut
    };
  }

  function apiOil(model, v, boi, muoi, muwi) {
    var kD = v.kmd / 1000;
    var sg = model.pb > v.pa ? 41.815 * Math.pow(v.phi * (1 - v.swi) / model.bob, 0.1611) * Math.pow(kD / model.muob, 0.0979) *
      Math.pow(v.swi, 0.3722) * Math.pow(model.pb / v.pa, 0.1741) / 100 : null;
    var wd = 54.898 * Math.pow(v.phi * (1 - v.swi) / boi, 0.0422) * Math.pow(kD * muwi / muoi, 0.0770) *
      Math.pow(v.swi, -0.1903) * Math.pow(v.pi / v.pa, -0.2159) / 100;
    return { solutionGas: sg, waterDrive: wd };
  }

  /* ------------------------------------------------------------ gas */

  function gasDepletion(model, v) {
    var zi = model.at(v.pi).z, curve = [], n = 50;
    for (var i = 0; i <= n; i++) {
      var p = v.pi - (v.pi - v.pa) * i / n, z = model.at(p).z;
      curve.push({ p: p, z: z, pz: p / z, rf: 1 - (p / z) / (v.pi / zi) });
    }
    return { rf: curve[n].rf, zi: zi, za: curve[n].z, curve: curve };
  }
  function gasWater(model, v) {
    var bgi = model.at(v.pi).bg, bgw = model.at(v.pw).bg, sgi = 1 - v.swi;
    return { rf: 1 - (bgi / bgw) * (v.sgr / sgi), bgi: bgi, bgw: bgw, pw: v.pw };
  }

  /* ------------------------------------------------------------ basis */

  function basis(method, model, R, extra) {
    var refs = {
      expansion: ['Material balance above the bubble point', 'Havlena & Odeh (1963) form; Dake (1978)'],
      muskat: ['Solution-gas drive, Muskat tank', 'Muskat (1945); Craft & Hawkins (1959)'],
      water: ['Water drive, Buckley-Leverett displacement efficiency', 'Buckley & Leverett (1942); Welge (1952)'],
      api: ['API correlations (indicative)', 'Arps et al., API Bulletin D14 (1967)'],
      gasDepletion: ['Volumetric depletion, p/z material balance', 'Craft & Hawkins (1959)'],
      gasWater: ['Water drive with trapped gas', 'Agarwal, Al-Hussainy & Ramey (1965) form']
    };
    var ass = {
      expansion: ['One tank at uniform pressure', 'No free gas above the bubble point', 'No aquifer influx', 'Water and rock compressibility included'],
      muskat: ['One tank at uniform pressure', 'No gas cap and no gravity segregation', 'No aquifer influx', 'Rock and water compressibility neglected below the bubble point',
               'Gas and oil flow in the ratio of their mobilities (Corey kr)'],
      water: ['Constant pressure during the displacement', 'One-dimensional, homogeneous, no gravity or capillary pressure',
              'Complete areal and vertical sweep: field recovery = Ed x sweep efficiency'],
      api: ['Regression of 1960s field data with wide scatter', 'Needs porosity and permeability, which PVT does not give'],
      gasDepletion: ['One tank, no aquifer', 'Rock and water compressibility neglected', 'z of the reservoir gas from the PVT model'],
      gasWater: ['Pressure held by the aquifer at the stated pressure', 'Complete sweep: all gas behind the water is trapped at Sgr']
    };
    var rock = USES[method].map(function (k) {
      return { key: k, label: INPUTS[k].label, value: R.v[k], isDefault: R.isDef[k], kind: INPUTS[k].kind || null };
    });
    return { method: refs[method][0], reference: refs[method][1], pvt: extra || [], rock: rock,
             assumptions: ass[method], usesDefaults: rock.some(function (r) { return r.isDefault; }) };
  }

  /* ------------------------------------------------------------ run */

  function runOil(model, R) {
    var v = R.v;
    var ex = expansion(model, v);
    var boi = ex.boi, inp = model.input || {};
    var mu = muskat(model, v, ex.rf, boi);
    var wd = waterDrive(model, v);
    var ri = model.at(v.pi);
    var api = apiOil(model, v, boi, ri.muo, C.waterViscosity(v.pi, inp.tempF, inp.salinity));
    return { ex: ex, mu: mu, wd: wd, api: api, boi: boi };
  }

  /* Vary each input still at its default over its range; the envelope of the
     results is the band the summary and the RF(p) chart show. */
  function sensitivity(model, R, fluid, base) {
    var keys = ORDER.filter(function (k) { return R.isDef[k] && INPUTS[k].lo !== undefined; });
    var lo = {}, hi = {}, curveLo = null, curveHi = null;
    function track(name, x) {
      if (x === null || x === undefined || !isFinite(x)) return;
      lo[name] = lo[name] === undefined ? x : Math.min(lo[name], x);
      hi[name] = hi[name] === undefined ? x : Math.max(hi[name], x);
    }
    var res = fluid === 'oil'
      ? { expansion: base.ex.rf, solutionGas: base.mu.error ? null : base.mu.rf, water: base.wd.ed, apiSg: base.api.solutionGas, apiWd: base.api.waterDrive }
      : { depletion: base.dep.rf, water: base.gw.rf };
    for (var name in res) track(name, res[name]);
    var grid = fluid === 'oil' && !base.mu.error ? base.mu.curve.map(function (c) { return c.p; }) : null;
    if (grid) { curveLo = base.mu.curve.map(function (c) { return c.rf; }); curveHi = curveLo.slice(); }
    keys.forEach(function (k) {
      [INPUTS[k].lo, INPUTS[k].hi].forEach(function (val) {
        var v2 = {}; for (var q in R.v) v2[q] = R.v[q];
        v2[k] = val;
        if (validate(model, v2).length) return;
        var R2 = { v: v2, isDef: R.isDef };
        if (fluid === 'oil') {
          var o = runOil(model, R2);
          track('expansion', o.ex.rf);
          if (!o.mu.error) {
            track('solutionGas', o.mu.rf);
            if (grid) grid.forEach(function (p, i) {
              var y = curveAt(o.mu.curve, p);
              if (y !== null) { curveLo[i] = Math.min(curveLo[i], y); curveHi[i] = Math.max(curveHi[i], y); }
            });
          }
          track('water', o.wd.ed); track('apiSg', o.api.solutionGas); track('apiWd', o.api.waterDrive);
        } else {
          track('depletion', gasDepletion(model, v2).rf);
          track('water', gasWater(model, v2).rf);
        }
      });
    });
    var out = {};
    for (var n2 in lo) out[n2] = { lo: lo[n2], hi: hi[n2] };
    out.varied = keys;
    if (grid) out.curve = grid.map(function (p, i) { return { p: p, lo: curveLo[i], hi: curveHi[i] }; });
    return out;
  }
  function curveAt(curve, p) {
    for (var i = 1; i < curve.length; i++) {
      var a = curve[i - 1], b = curve[i];
      if (p <= a.p && p >= b.p) return a.rf + (b.rf - a.rf) * (a.p - p) / (a.p - b.p || 1);
    }
    return null;
  }

  /*
   * The whole recovery picture for a model. entered: rock inputs (field
   * units, null = default). Returns { fluid, values, isDefault, errors,
   * results: [...], kr, ... } - see the oil and gas branches.
   */
  function estimate(model, entered) {
    var R = resolve(model, entered), v = R.v;
    var errors = validate(model, v);
    var out = { fluid: model.fluid, values: v, isDefault: R.isDef, errors: errors, notes: [] };
    if (errors.length) return out;
    out.kr = krCurves(v);
    if (model.fluid === 'oil') {
      var b = runOil(model, R);
      out.expansion = b.ex; out.muskat = b.mu; out.water = b.wd; out.api = b.api;
      if (v.pi < model.pb - 1) out.notes.push('The initial pressure is below the bubble point: the oil starts saturated, which implies a gas cap. The Muskat tank assumes none, so the solution-gas recovery starts at the initial pressure without one.');
      if (v.pw > v.pi + 1 || model.fluid === 'oil' && v.pw < model.pb - 1) out.notes.push('The water drive is evaluated at ' + Math.round(b.wd.pw) + ' psia: below the bubble point free gas would join the displacement, which this method does not model.');
      out.sens = sensitivity(model, R, 'oil', b);
      out.results = [
        { key: 'expansion', title: 'Expansion to the bubble point', rf: b.ex.rf, kind: 'rf',
          basis: basis('expansion', model, R, [['Boi', b.ex.boi.toFixed(4) + ' bbl/STB'], ['Bob', model.bob.toFixed(4) + ' bbl/STB'], ['Pb', Math.round(model.pb) + ' psia']]) },
        { key: 'solutionGas', title: 'Solution-gas drive to abandonment', rf: b.mu.error ? null : b.mu.rf, kind: 'rf', error: b.mu.error,
          basis: basis('muskat', model, R, [['Pb', Math.round(model.pb) + ' psia'], ['Rsb', Math.round(model.rsb) + ' scf/STB'],
            ['μo/μg at Pb', (model.muob / model.at(model.pb).mug).toFixed(1)], ['Bo, Rs, Bg, μo, μg', 'from the PVT tables, Pb to abandonment']]) },
        { key: 'water', title: 'Water drive: displacement efficiency', rf: b.wd.ed, kind: 'ed',
          basis: basis('water', model, R, [['μo at ' + Math.round(b.wd.pw) + ' psia', b.wd.muo.toFixed(3) + ' cp'], ['μw', b.wd.muw.toFixed(3) + ' cp'],
            ['End-point mobility ratio M', b.wd.mobility.toFixed(2)]]) },
        { key: 'apiSg', title: 'API solution-gas estimate', rf: b.api.solutionGas, kind: 'api',
          basis: basis('api', model, R, [['Bob', model.bob.toFixed(4) + ' bbl/STB'], ['μob', model.muob.toFixed(3) + ' cp'], ['Pb', Math.round(model.pb) + ' psia']]) },
        { key: 'apiWd', title: 'API water-drive estimate', rf: b.api.waterDrive, kind: 'api',
          basis: basis('api', model, R, [['Boi', b.boi.toFixed(4) + ' bbl/STB'], ['μoi', model.at(v.pi).muo.toFixed(3) + ' cp']]) }
      ];
    } else {
      var dep = gasDepletion(model, v), gw = gasWater(model, v);
      out.depletion = dep; out.gasWater = gw;
      out.sens = sensitivity(model, R, 'gas', { dep: dep, gw: gw });
      out.results = [
        { key: 'depletion', title: 'Volumetric depletion to abandonment', rf: dep.rf, kind: 'rf',
          basis: basis('gasDepletion', model, R, [['zi', dep.zi.toFixed(4)], ['z at abandonment', dep.za.toFixed(4)]]) },
        { key: 'water', title: 'Water drive: trapped-gas recovery', rf: gw.rf, kind: 'ed',
          basis: basis('gasWater', model, R, [['Bgi', (gw.bgi * 1000 / BBL).toFixed(4) + ' rb/Mscf'], ['Bg at ' + Math.round(gw.pw) + ' psia', (gw.bgw * 1000 / BBL).toFixed(4) + ' rb/Mscf']]) }
      ];
    }
    out.results.forEach(function (r) { r.band = out.sens[r.key] || null; });
    out.usesDefaults = out.results.some(function (r) { return r.basis.usesDefaults; });
    return out;
  }

  var DISCLAIMER = 'Screening estimates from the PVT model and default rock properties. ' +
    'Not a reserves or resources estimate (SPE-PRMS) and not a simulation forecast: no geology, wells, rates or time.';

  /* CSV of the curves, with the basis as comment lines. */
  function toCsv(est, credit) {
    var L = ['# PhaseWiz recovery screening' + (credit ? ' - ' + credit : ''), '# ' + DISCLAIMER];
    est.results.forEach(function (r) {
      L.push('# ' + r.title + ': ' + (r.rf === null ? 'n/a' : (100 * r.rf).toFixed(2) + ' %') + ' - ' + r.basis.method + ' (' + r.basis.reference + ')');
      L.push('#   inputs: ' + r.basis.rock.map(function (q) { return q.key + '=' + fmtIn(q) + (q.isDefault ? ' (default)' : ''); }).join(', '));
    });
    if (est.fluid === 'oil') {
      L.push('', 'p_psia,RF_fraction,So,Sg,producing_GOR_scf_STB,Rs_scf_STB,stage');
      est.expansion.curve.forEach(function (c) { L.push([c.p.toFixed(1), c.rf.toFixed(5), '', '', '', '', 'expansion'].join(',')); });
      if (!est.muskat.error) est.muskat.curve.forEach(function (c) {
        L.push([c.p.toFixed(1), c.rf.toFixed(5), c.so.toFixed(5), c.sg.toFixed(5), isFinite(c.gor) ? c.gor.toFixed(1) : '', c.rs.toFixed(1), 'solution-gas'].join(','));
      });
      L.push('', 'water_drive_Ed,water_cut,PV_injected');
      est.water.cut.forEach(function (c) { L.push([c.ed.toFixed(5), c.fw.toFixed(5), c.pvi.toFixed(4)].join(',')); });
    } else {
      L.push('', 'p_psia,z,p_over_z_psia,RF_fraction');
      est.depletion.curve.forEach(function (c) { L.push([c.p.toFixed(1), c.z.toFixed(5), c.pz.toFixed(1), c.rf.toFixed(5)].join(',')); });
    }
    return L.join('\n') + '\n';
  }
  function fmtIn(q) { return Math.abs(q.value) < 1e-3 && q.value !== 0 ? q.value.toExponential(2) : String(+q.value.toPrecision(4)); }

  return { INPUTS: INPUTS, ORDER: ORDER, USES: USES, DISCLAIMER: DISCLAIMER,
           cleanInputs: cleanInputs, resolve: resolve, validate: validate, corey: corey,
           expansion: expansion, muskat: muskat, waterDrive: waterDrive, gasDepletion: gasDepletion, gasWater: gasWater,
           apiOil: apiOil, estimate: estimate, toCsv: toCsv };
});
