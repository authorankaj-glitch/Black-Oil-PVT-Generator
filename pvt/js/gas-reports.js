/*
 * Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. MIT licence (see LICENSE).
 *
 * gas-reports.js -- PVT reports of dry and wet gases: quality control and
 * the finalised data set the gas tuning uses (z and gas viscosity against
 * pressure, plus the fluid description for the case inputs).
 *
 * A gas PVT report carries the well-stream composition (with the separator
 * gas and liquid it was recombined from), the separator conditions and the
 * condensate-gas ratio (CGR) of the recombination, a constant composition
 * expansion at reservoir temperature (z, relative volume, liquid dropout)
 * and, often, gas viscosities.
 *
 * Report (field units):
 *   {
 *     id, fluid: 'gas', name, type: 'sep' | 'bhs', tempF,
 *     sampling: { pRes, cgr, depth }        cgr: producing CGR at sampling
 *     comp:   { rows: [{ c, z, y, x }], mw7, sg7 }
 *             mol % of the well stream (z), separator gas (y), separator
 *             liquid (x); C7+ molecular weight and specific gravity
 *     recomb: { pSep, tSep, gg, cgr, api }  separator conditions, separator
 *             gas gravity, CGR (STB/MMscf of separator gas), condensate API
 *     cce:    { rows: [{ p, z, v, liq, use }] }   v = V/Vref, liq = liquid
 *             dropout, % of the cell volume
 *     visc:   { rows: [{ p, mug, use }] }
 *     settings: { normalise: bool }
 *     final: bool
 *   }
 *
 * Checks:
 *   compSum, compC7, compGas, hoffman   as for an oil report
 *   wsGrav    well-stream gravity from the composition against the
 *             recombination of separator gas and condensate (McCain, 1990)
 *   cgrField  laboratory CGR against the producing CGR at sampling
 *   gasType   dry (no condensate) or wet; a CGR above ~50 STB/MMscf is
 *             usually a gas condensate
 *   phase     Peng-Robinson envelope of the composition (eos.js): the
 *             reservoir temperature above the cricondentherm (single phase
 *             in the reservoir), the separator inside the envelope for a
 *             wet gas and outside it for a dry gas
 *   zComp     measured z against z from the composition (Kay's pseudo-
 *             criticals, Kesler-Lee C7+, Wichert-Aziz, Dranchuk-Abou-Kassem)
 *   cceZV     p V / z constant along the CCE: the volumes and z agree
 *   zTrend    no z reading out of line with the others
 *   dropout   no liquid at reservoir temperature (otherwise a condensate,
 *             which this tool does not model)
 *   viscGas   viscosity rises with pressure and follows Lee-Gonzalez-Eakin
 *             at the measured z, no reading out of line
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./reports.js'), require('./correlations.js'), require('./eos.js'));
  } else {
    root.PVTGasReports = factory(root.PVTReports, root.PVTCorr, root.PVTEos);
  }
})(typeof self !== 'undefined' ? self : this, function (Rep, C, Eos) {
  'use strict';

  var U = Rep.util, num = U.num, used = U.used, pct = U.pct, f0 = U.f0, median = U.median, worst = U.worst;
  var M_AIR = U.M_AIR, COMP_BY = U.COMP_BY;
  var TZ = 459.67, SCF_PER_LBMOL = 379.49, LB_PER_BBL_WATER = 350.17;

  var CHECKS = [
    { key: 'compSum', label: 'Composition total', test: 'comp' },
    { key: 'compC7', label: 'C7+ properties', test: 'comp' },
    { key: 'compGas', label: 'Separator gas gravity from composition', test: 'comp' },
    { key: 'hoffman', label: 'Hoffman plot of the separator', test: 'comp' },
    { key: 'phase', label: 'Phase envelope from the composition', test: 'comp' },
    { key: 'wsGrav', label: 'Well-stream gravity: composition against recombination', test: 'recomb' },
    { key: 'cgrField', label: 'Laboratory against producing CGR', test: 'recomb' },
    { key: 'gasType', label: 'Fluid type from the CGR', test: 'recomb' },
    { key: 'dropout', label: 'Liquid dropout', test: 'cce' },
    { key: 'zComp', label: 'Gas z against the composition', test: 'cce' },
    { key: 'cceZV', label: 'CCE volumes against z', test: 'cce' },
    { key: 'zTrend', label: 'z-factor readings', test: 'cce' },
    { key: 'viscGas', label: 'Gas viscosity', test: 'visc' }
  ];

  var COLS = {
    cce: [{ k: 'p', kind: 'p', head: 'Pressure' }, { k: 'z', kind: null, unit: '–', head: 'Gas z' },
          { k: 'v', kind: null, unit: 'V/Vref', head: 'Relative volume' }, { k: 'liq', kind: null, unit: '% of cell', head: 'Liquid dropout' }],
    visc: [{ k: 'p', kind: 'p', head: 'Pressure' }, { k: 'mug', kind: 'mu', head: 'Gas viscosity' }],
    comp: [{ k: 'c', text: true, head: 'Component' }, { k: 'z', kind: null, unit: 'mol %', head: 'Well stream' },
           { k: 'y', kind: null, unit: 'mol %', head: 'Separator gas' }, { k: 'x', kind: null, unit: 'mol %', head: 'Separator liquid' }]
  };

  function newId() { return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* ------------------------------------------------------------ data model */

  function emptyReport(name) {
    return {
      id: newId(), fluid: 'gas', name: name || 'Gas PVT report', type: 'sep', tempF: null,
      sampling: { pRes: null, cgr: null, depth: null },
      comp: { rows: Rep.COMPONENTS.map(function (k) { return { c: k.c, z: null, y: null, x: null }; }), mw7: null, sg7: null },
      recomb: { pSep: null, tSep: null, gg: null, cgr: null, api: null },
      cce: { rows: [] },
      visc: { rows: [] },
      settings: { normalise: true },
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

  function cleanReport(o) {
    o = o || {};
    var r = emptyReport(String(o.name || 'Gas PVT report').slice(0, 80));
    if (o.id) r.id = String(o.id);
    r.type = o.type === 'bhs' ? 'bhs' : 'sep';
    r.tempF = num(o.tempF);
    var sm = o.sampling || {};
    r.sampling = { pRes: num(sm.pRes), cgr: num(sm.cgr), depth: num(sm.depth) };
    var cp = o.comp || {};
    if (Array.isArray(cp.rows) && cp.rows.length) {
      r.comp.rows = cp.rows.map(function (x) {
        return { c: Rep.normComp(x.c) || String(x.c || '').slice(0, 12), z: num(x.z), y: num(x.y), x: num(x.x) };
      });
    }
    r.comp.mw7 = num(cp.mw7); r.comp.sg7 = num(cp.sg7);
    var rc = o.recomb || {};
    r.recomb = { pSep: num(rc.pSep), tSep: num(rc.tSep), gg: num(rc.gg), cgr: num(rc.cgr), api: num(rc.api) };
    r.cce.rows = cleanRows((o.cce || {}).rows, ['p', 'z', 'v', 'liq']);
    r.visc.rows = cleanRows((o.visc || {}).rows, ['p', 'mug']);
    r.settings = { normalise: (o.settings || {}).normalise !== false };
    r.final = !!o.final;
    return r;
  }

  /* ------------------------------------------------------------ composition */

  function compRows(rep) { return rep.comp.rows.filter(function (q) { return q.c; }); }

  /* C7+ critical properties from its MW and SG (Soreide Tb, Kesler-Lee). */
  function plusCrit(mw7, sg7) {
    if (num(mw7) === null || num(sg7) === null) return null;
    var kl = Eos.keslerLee(Eos.soreideTb(mw7, sg7), sg7);
    return { m: mw7, tc: kl.tc, pc: kl.pc };
  }

  /* Mole fractions of one analysis (z, y or x), normalised, with the
     molecular weight and critical properties of each component. */
  function analysis(rep, key) {
    var plus = plusCrit(rep.comp.mw7, rep.comp.sg7), out = [], s = 0, missing = false;
    compRows(rep).forEach(function (q) {
      var v = num(q[key]); if (v === null || v <= 0) return;
      var c = Rep.normComp(q.c), k = COMP_BY[c];
      var props = c === 'C7+' ? plus : k && k.tc ? { m: k.m, tc: k.tc, pc: k.pc } : null;
      if (!props) { missing = true; return; }
      out.push({ c: c, f: v, m: props.m, tc: props.tc, pc: props.pc }); s += v;
    });
    if (!(s > 0)) return null;
    out.forEach(function (q) { q.f /= s; });
    var mw = 0, tpc = 0, ppc = 0, y = { CO2: 0, H2S: 0, N2: 0 };
    out.forEach(function (q) { mw += q.f * q.m; tpc += q.f * q.tc; ppc += q.f * q.pc; if (q.c in y) y[q.c] = q.f; });
    return { rows: out, total: s, mw: mw, gravity: mw / M_AIR, tpc: tpc, ppc: ppc, yCO2: y.CO2, yH2S: y.H2S, yN2: y.N2, missing: missing };
  }

  /* z of the analysed gas: Kay's rule, Wichert-Aziz acid-gas correction,
     Dranchuk-Abou-Kassem. */
  function zFrom(an, tempF, p) {
    var wa = C.wichertAziz(an.tpc, an.ppc, an.yCO2, an.yH2S);
    return C.ZFACTOR.dak(p / wa.ppc, (tempF + TZ) / wa.tpc);
  }

  /* Gas viscosity, Lee-Gonzalez-Eakin, from z, p, T and gravity. */
  function mugLge(z, p, tempF, g) { return C.MU_G.leeGonzalezEakin(C.gasDensity(z, p, tempF, g), tempF, g); }

  /* Envelope of the well-stream composition, cached (it takes a few
     hundred milliseconds). */
  var envCache = {};
  function eosComposition(rep) {
    var rows = compRows(rep).filter(function (q) { return num(q.z) !== null && q.z > 0; })
      .map(function (q) { return { c: Rep.normComp(q.c) || q.c, z: q.z }; });
    var has7 = rows.some(function (q) { return q.c === 'C7+'; });
    if (rows.length < 3 || (has7 && (num(rep.comp.mw7) === null || num(rep.comp.sg7) === null))) return null;
    return { rows: rows, mw7: num(rep.comp.mw7), sg7: num(rep.comp.sg7) };
  }
  function phaseOf(comp, tempF, pSep, tSep) {
    var key = JSON.stringify([comp, tempF, pSep, tSep]);
    if (key in envCache) return envCache[key];
    var mx = Eos.mixture(comp), out = null;
    if (mx) {
      var env = Eos.envelope(mx, { pMax: 10000, levels: [0.1, 0.05, 0.02] });
      if (env) {
        out = { env: env, tct: env.tct, crit: env.crit, cricondenbar: env.cricondenbar,
                sepInside: pSep > 0 && num(tSep) !== null ? Eos.twoPhase(mx, tSep, pSep) : null,
                dew: tempF < env.tct ? Eos.satPressure(mx, tempF, 10000) : null };
      }
    }
    envCache[key] = out;
    return out;
  }

  /* ------------------------------------------------------------ QC */

  function check(key, status, detail, extra) {
    var def = CHECKS.filter(function (c) { return c.key === key; })[0];
    var o = { key: key, label: def.label, test: def.test, status: status, detail: detail };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  function qcReport(rep) {
    rep = cleanReport(rep);
    var out = [], flags = [], t = num(rep.tempF), rc = rep.recomb;
    var zA = analysis(rep, 'z'), yA = analysis(rep, 'y');
    var cgr = num(rc.cgr) || 0;

    /* ---- composition */
    var zs = U.compSum(rep, 'z');
    if (zs === null) {
      ['compSum', 'compC7', 'compGas', 'hoffman', 'phase'].forEach(function (k) { out.push(check(k, 'na', 'No composition entered.')); });
    } else {
      var off = Math.abs(zs - 100);
      out.push(check('compSum', off <= 0.5 ? 'pass' : off <= 2 ? 'warn' : 'fail',
        'Well stream totals ' + zs.toFixed(2) + ' mol %.' +
        (off > 0.5 ? (rep.settings.normalise ? ' Normalised to 100 for the finalised data.' : ' Tick normalise to rescale it.') +
          (off > 2 ? ' A gap this size usually means a missing component.' : '') : ''), { value: zs }));
      var mw7 = num(rep.comp.mw7), sg7 = num(rep.comp.sg7);
      var has7 = compRows(rep).some(function (q) { return Rep.normComp(q.c) === 'C7+' && num(q.z) > 0; });
      if (!has7) out.push(check('compC7', 'pass', 'No C7+ in the well stream.'));
      else if (mw7 === null || sg7 === null) out.push(check('compC7', 'na', 'Enter the C7+ molecular weight and specific gravity.'));
      else {
        var kw = Rep.watsonK(mw7, sg7);
        var ok = mw7 > 90 && mw7 < 250 && sg7 > 0.70 && sg7 < 0.90 && kw > 11.0 && kw < 13.0;
        out.push(check('compC7', ok ? 'pass' : 'warn', 'MW ' + mw7.toFixed(1) + ', SG ' + sg7.toFixed(4) + ', Watson K ' + kw.toFixed(2) + '.' +
          (ok ? '' : ' Unusual for the C7+ of a gas (MW 90-250, SG 0.70-0.90, K 11-13): the MW and SG may not belong together.'), { value: kw }));
      }
      var gy = yA ? yA.gravity : null;
      if (gy === null || num(rc.gg) === null) out.push(check('compGas', 'na', 'Needs the separator gas composition and its measured gravity.'));
      else {
        var dg = gy / rc.gg - 1;
        out.push(check('compGas', Math.abs(dg) <= 0.03 ? 'pass' : Math.abs(dg) <= 0.06 ? 'warn' : 'fail',
          'Gravity of the separator gas from its composition ' + gy.toFixed(3) + ' against ' + rc.gg.toFixed(3) + ' measured: ' + pct(dg) + '.', { value: dg }));
      }
      var hf = Rep.hoffman(rep, rc.pSep, rc.tSep);
      if (!hf || !hf.fit) out.push(check('hoffman', 'na', 'Needs the separator gas and liquid compositions (four or more components) and the separator conditions.'));
      else {
        var hb = hf.pts.filter(function (q) { return q.bad; }), r2 = hf.fit.r2;
        out.push(check('hoffman', hb.length > 1 || r2 < 0.9 ? 'fail' : hb.length || r2 < 0.98 ? 'warn' : 'pass',
          'log(K p) against the characterisation factor over ' + hf.pts.length + ' hydrocarbons: R² ' + r2.toFixed(3) + '.' +
          (hb.length ? ' Off the line: ' + hb.map(function (q) { return q.c; }).join(', ') + ', an analysis error in the gas or the liquid.' : '') +
          (r2 >= 0.98 && !hb.length ? ' The separator gas and liquid were in equilibrium; the recombination base is sound.' : ''), { value: r2 }));
      }
      var comp = eosComposition(rep), ph = null;
      if (!comp || t === null) out.push(check('phase', 'na', 'Needs the well-stream composition with the C7+ MW and SG, and the reservoir temperature.'));
      else {
        ph = Eos ? phaseOf(comp, t, rc.pSep, rc.tSep) : null;
        if (!ph) out.push(check('phase', 'na', 'The equation of state found no two-phase region for this composition.'));
        else {
          var msg = 'Peng-Robinson envelope of the well stream: cricondentherm ' + f0(ph.tct) + ' °F, cricondenbar ' + f0(ph.cricondenbar.p) + ' psia. ';
          var st = 'pass';
          if (t > ph.tct + 10) msg += 'The reservoir temperature (' + f0(t) + ' °F) lies above it: single-phase gas at every reservoir pressure.';
          else if (t > ph.tct) { st = 'warn'; msg += 'The reservoir temperature (' + f0(t) + ' °F) is only just above it - within the uncertainty of an untuned equation of state.'; }
          else {
            st = 'warn';
            msg += 'The reservoir temperature (' + f0(t) + ' °F) lies below it' + (ph.dew ? ', with a computed dew point of ' + f0(ph.dew.p) + ' psia' : '') +
              ': the composition describes a gas condensate. An untuned equation of state places the cricondentherm only to some tens of °F - the CCE liquid dropout decides.';
          }
          if (ph.sepInside !== null) {
            if (cgr > 0 && !ph.sepInside) { st = st === 'pass' ? 'warn' : st; msg += ' The separator lies outside the envelope, yet the report has condensate (CGR ' + cgr.toFixed(1) + ') - check the C7+ fraction.'; }
            else if (!(cgr > 0) && ph.sepInside) { st = st === 'pass' ? 'warn' : st; msg += ' The separator lies inside the envelope, so the gas should yield condensate, yet the CGR is zero.'; }
            else msg += ph.sepInside ? ' The separator lies inside the envelope: a wet gas.' : ' The separator lies outside the envelope: a dry gas.';
          }
          out.push(check('phase', st, msg, { value: ph.tct }));
        }
      }
    }

    /* ---- recombination */
    var gw = null;
    if (num(rc.gg) === null) {
      out.push(check('wsGrav', 'na', 'Enter the separator gas gravity.'));
    } else {
      gw = cgr > 0 && num(rc.api) !== null ? C.wellstreamGravity(rc.gg, cgr, rc.api) : rc.gg;
      if (!zA || cgr > 0 && num(rc.api) === null) out.push(check('wsGrav', 'na', zA ? 'Enter the condensate API.' : 'Needs the well-stream composition.'));
      else {
        var dw = zA.gravity / gw - 1;
        out.push(check('wsGrav', Math.abs(dw) <= 0.03 ? 'pass' : Math.abs(dw) <= 0.06 ? 'warn' : 'fail',
          'Well-stream gravity ' + zA.gravity.toFixed(4) + ' from the composition against ' + gw.toFixed(4) +
          ' from separator gas ' + rc.gg.toFixed(3) + (cgr > 0 ? ' plus ' + cgr.toFixed(1) + ' STB/MMscf of ' + rc.api.toFixed(1) + ' API condensate' : '') +
          ': ' + pct(dw) + '.' + (Math.abs(dw) > 0.03 ? ' The recombination ratio, the condensate gravity or the analysis is off.' : ''), { value: dw }));
      }
    }
    var cf = num(rep.sampling.cgr);
    if (cf === null || num(rc.cgr) === null) out.push(check('cgrField', 'na', 'Needs the laboratory CGR and the producing CGR at sampling.'));
    else if (Math.max(cf, rc.cgr) < 2) out.push(check('cgrField', 'pass', 'Both below 2 STB/MMscf: a dry gas either way.'));
    else {
      var dc = rc.cgr / cf - 1;
      out.push(check('cgrField', Math.abs(dc) <= 0.1 ? 'pass' : Math.abs(dc) <= 0.25 ? 'warn' : 'fail',
        'Recombination CGR ' + rc.cgr.toFixed(1) + ' against ' + cf.toFixed(1) + ' STB/MMscf produced at sampling: ' + pct(dc) + '.' +
        (Math.abs(dc) > 0.1 ? ' The sample may not represent the reservoir fluid (unstable rate, liquid hold-up, carry-over) or was recombined at the wrong ratio.' : ' The sample is representative of the producing stream.'),
        { value: dc }));
    }
    if (num(rc.cgr) === null) out.push(check('gasType', 'na', 'Enter the CGR (0 for a dry gas).'));
    else if (cgr <= 0) out.push(check('gasType', 'pass', 'No condensate at the separator: a dry gas.'));
    else if (cgr <= 50) out.push(check('gasType', 'pass', 'CGR ' + cgr.toFixed(1) + ' STB/MMscf: a wet gas, single-phase in the reservoir with condensate at the separator.'));
    else out.push(check('gasType', 'warn', 'CGR ' + cgr.toFixed(1) + ' STB/MMscf is above the ~50 STB/MMscf of a wet gas: this is probably a gas condensate, with a dew point in the reservoir. This tool models it as a wet gas, which ignores retrograde condensation.'));

    /* ---- CCE */
    var cce = rep.cce.rows.map(function (q, i) { return { q: q, i: i }; })
      .filter(function (o) { return used(o.q) && num(o.q.p) !== null; })
      .sort(function (a, b) { return b.q.p - a.q.p; });
    var withLiq = cce.filter(function (o) { return num(o.q.liq) !== null; });
    var drop = withLiq.filter(function (o) { return o.q.liq > 0.05; });
    if (!withLiq.length) out.push(check('dropout', cce.length ? 'pass' : 'na', cce.length ? 'No liquid dropout reported at reservoir temperature.' : 'No CCE data.'));
    else if (!drop.length) out.push(check('dropout', 'pass', 'No liquid at reservoir temperature down to ' + f0(withLiq[withLiq.length - 1].q.p) + ' psia: single-phase in the reservoir.'));
    else {
      var pd = drop[0].q.p;
      out.push(check('dropout', 'fail', 'Liquid drops out at ' + f0(pd) + ' psia and below (up to ' +
        Math.max.apply(null, drop.map(function (o) { return o.q.liq; })).toFixed(1) + ' % of the cell): a gas condensate with a dew point above ' + f0(pd) +
        ' psia. Dry- and wet-gas tables ignore that liquid; a condensate needs a compositional or Rv(p) model.'));
    }
    var zr = cce.filter(function (o) { return num(o.q.z) !== null; });
    var zPts = zr.map(function (o) { return { i: o.i, p: o.q.p, z: o.q.z, zc: zA && t !== null ? zFrom(zA, t, o.q.p) : null }; });
    if (!zr.length) {
      ['zComp', 'cceZV', 'zTrend'].forEach(function (k) { out.push(check(k, 'na', 'No CCE z values.')); });
    } else {
      /* against the composition */
      var cmp = zPts.filter(function (o) { return o.zc !== null; });
      if (!cmp.length) out.push(check('zComp', 'na', 'Needs the well-stream composition (with the C7+ MW and SG) and the temperature.'));
      else {
        cmp.forEach(function (o) { o.dev = o.z / o.zc - 1; });
        var mad = cmp.reduce(function (a, o) { return a + Math.abs(o.dev); }, 0) / cmp.length;
        var bias = median(cmp.map(function (o) { return o.dev; }));
        out.push(check('zComp', mad <= 0.02 ? 'pass' : mad <= 0.04 ? 'warn' : 'fail',
          'Measured z against z from the composition (Kay pseudo-criticals, Wichert-Aziz, Dranchuk-Abou-Kassem): average difference ' + pct(mad) +
          ', median bias ' + pct(bias) + '.' + (mad > 0.02 ? ' A consistent bias points to the composition or its C7+ description; scatter to the readings.' : ''),
          { value: mad }));
      }
      /* single readings out of line: residual from the composition curve
         (bias removed) or, without a composition, from the neighbours */
      var resid = [];
      if (cmp.length >= 4) {
        var b0 = median(cmp.map(function (o) { return o.dev; }));
        cmp.forEach(function (o) { resid.push({ o: o, e: o.dev - b0 }); });
      } else if (zPts.length >= 3) {
        for (var k = 1; k < zPts.length - 1; k++) {
          var A = zPts[k - 1], B = zPts[k], Cq = zPts[k + 1], w = (B.p - Cq.p) / (A.p - Cq.p);
          resid.push({ o: B, e: B.z / (Cq.z + w * (A.z - Cq.z)) - 1 });
        }
      }
      if (resid.length < 3) out.push(check('zTrend', 'na', 'Needs three or more z readings.'));
      else {
        var bad = U.outliers(resid.map(function (r) { return r.e; }), 0.01, 3.5);
        var outl = resid.filter(function (r, j) { return bad[j]; });
        outl.forEach(function (r) { flags.push({ test: 'cce', row: r.o.i, text: 'z out of line with the other readings by ' + pct(r.e) + '.' }); r.o.bad = true; });
        out.push(check('zTrend', outl.length ? (outl.length > 1 ? 'fail' : 'warn') : 'pass', outl.length
          ? 'z out of line at ' + outl.map(function (r) { return f0(r.o.p); }).join(', ') + ' psia - a typo or a mis-read gauge: untick or correct it.'
          : 'The z readings follow a smooth curve.'));
      }
      /* p V / z constant */
      var zv = zr.filter(function (o) { return num(o.q.v) !== null && o.q.v > 0; });
      if (zv.length < 2) out.push(check('cceZV', 'na', 'Needs the relative volume with z at two or more pressures.'));
      else {
        var cst = zv.map(function (o) { return o.q.p * o.q.v / o.q.z; }), mc = median(cst), mx = 0;
        zv.forEach(function (o, j) {
          var e = cst[j] / mc - 1; mx = Math.max(mx, Math.abs(e));
          if (Math.abs(e) > 0.005) flags.push({ test: 'cce', row: o.i, text: 'p V / z differs by ' + pct(e, 2) + ' from the other readings.' });
        });
        out.push(check('cceZV', mx <= 0.005 ? 'pass' : mx <= 0.015 ? 'warn' : 'fail',
          'At constant temperature p V / z stays constant: largest difference ' + pct(mx, 2) + ' over ' + zv.length + ' readings.' +
          (mx > 0.005 ? ' Either the volume or the z at the flagged pressure is wrong.' : ''), { value: mx, ref: mc }));
      }
    }

    /* ---- viscosity */
    var vr = rep.visc.rows.map(function (q, i) { return { q: q, i: i }; })
      .filter(function (o) { return used(o.q) && num(o.q.p) !== null && num(o.q.mug) !== null; })
      .sort(function (a, b) { return b.q.p - a.q.p; });
    var gV = zA ? zA.gravity : gw;
    var zAt = function (p) {
      if (zr.length >= 2) {
        var s = zr.map(function (o) { return o.q; }).sort(function (a, b) { return a.p - b.p; });
        if (p <= s[0].p) return s[0].z;
        for (var j = 1; j < s.length; j++) if (p <= s[j].p) return s[j - 1].z + (p - s[j - 1].p) * (s[j].z - s[j - 1].z) / (s[j].p - s[j - 1].p);
        return s[s.length - 1].z;
      }
      return zA && t !== null ? zFrom(zA, t, p) : null;
    };
    var vPts = vr.map(function (o) {
      var z = zAt(o.q.p);
      return { i: o.i, p: o.q.p, mug: o.q.mug, lge: z !== null && gV !== null && t !== null ? mugLge(z, o.q.p, t, gV) : null };
    });
    if (vr.length < 2) out.push(check('viscGas', 'na', 'No gas viscosity data.'));
    else {
      var vMsg = [], st2 = 'pass';
      var rev = [];
      for (var a = 1; a < vr.length; a++) if (vr[a].q.mug > vr[a - 1].q.mug * 1.005) rev.push(vr[a]);
      rev.forEach(function (o) { flags.push({ test: 'visc', row: o.i, text: 'Viscosity higher than at the pressure above.' }); });
      if (rev.length) { st2 = 'fail'; vMsg.push('viscosity rises as pressure falls at ' + rev.map(function (o) { return f0(o.q.p); }).join(', ') + ' psia'); }
      var withL = vPts.filter(function (o) { return o.lge !== null; });
      if (withL.length) {
        withL.forEach(function (o) { o.dev = o.mug / o.lge - 1; });
        var mb = median(withL.map(function (o) { return o.dev; }));
        var avg = withL.reduce(function (s, o) { return s + Math.abs(o.dev); }, 0) / withL.length;
        if (withL.length >= 4) {
          var badV = U.outliers(withL.map(function (o) { return o.dev - mb; }), 0.03, 3.5);
          withL.filter(function (o, j) { return badV[j]; }).forEach(function (o) {
            o.bad = true;
            flags.push({ test: 'visc', row: o.i, text: 'Out of line with the other readings by ' + pct(o.dev - mb) + '.' });
            vMsg.push('out of line at ' + f0(o.p) + ' psia');
          });
          if (withL.some(function (o) { return o.bad; }) && st2 === 'pass') st2 = 'warn';
        }
        vMsg.push('Lee-Gonzalez-Eakin at the measured z differs by ' + pct(avg) + ' on average');
        if (avg > 0.2) st2 = 'fail'; else if (avg > 0.1 && st2 === 'pass') st2 = 'warn';
      }
      out.push(check('viscGas', st2, vMsg.join('; ') + '.' + (st2 === 'pass' ? ' Viscosity rises with pressure as it should.' : '')));
    }

    var fin = finalise(rep);
    return { checks: out, flags: flags, final: fin, zPts: zPts, vPts: vPts, hoffman: Rep.hoffman(rep, rc.pSep, rc.tSep),
             zv: out.filter(function (c) { return c.key === 'cceZV'; })[0], analysis: zA, phase: zA && t !== null && eosComposition(rep) ? phaseOf(eosComposition(rep), t, rc.pSep, rc.tSep) : null,
             status: worst(out.map(function (c) { return c.status; })) };
  }

  /* ------------------------------------------------------------ finalise */

  function finalise(rep) {
    rep = cleanReport(rep);
    var rc = rep.recomb, notes = [];
    var zA = analysis(rep, 'z'), yA = analysis(rep, 'y');
    var cgr = num(rc.cgr) !== null ? Math.max(rc.cgr, 0) : 0;
    var gg = num(rc.gg);
    if (gg === null && yA) { gg = yA.gravity; notes.push('Separator gas gravity from the separator gas composition.'); }
    if (gg === null && zA && !(cgr > 0)) { gg = zA.gravity; notes.push('Gas gravity from the well-stream composition (dry gas).'); }
    var imp = yA || zA;
    var rows = [];
    rep.cce.rows.forEach(function (q) {
      if (!used(q) || num(q.p) === null || num(q.z) === null) return;
      rows.push({ p: q.p, z: q.z, mug: null, src: 'CCE' });
    });
    rep.visc.rows.forEach(function (q) {
      if (!used(q) || num(q.p) === null || num(q.mug) === null) return;
      var tol = Math.max(5, 0.005 * q.p);
      var hit = rows.filter(function (r) { return Math.abs(r.p - q.p) <= tol; })[0];
      if (hit) hit.mug = q.mug; else rows.push({ p: q.p, z: null, mug: q.mug, src: 'viscosity' });
    });
    rows.sort(function (a, b) { return b.p - a.p; });
    if (cgr > 50) notes.push('CGR above 50 STB/MMscf: modelled as a wet gas, which ignores retrograde condensation in the reservoir.');
    var comp = null, zs = U.compSum(rep, 'z');
    if (zs) {
      var k = rep.settings.normalise ? 100 / zs : 1;
      comp = { rows: compRows(rep).filter(function (q) { return num(q.z) !== null; }).map(function (q) { return { c: Rep.normComp(q.c) || q.c, z: q.z * k }; }),
               mw7: num(rep.comp.mw7), sg7: num(rep.comp.sg7) };
    }
    var api = num(rc.api);
    return {
      name: rep.name, fluid: 'gas', type: rep.type, gasKind: cgr > 0 ? 'wet' : 'dry',
      gammaG: gg, cgr: cgr, apiC: api, tempF: num(rep.tempF), pSep: num(rc.pSep), tSep: num(rc.tSep),
      impurities: imp ? { yCO2: imp.yCO2, yH2S: imp.yH2S, yN2: imp.yN2 } : null,
      composition: comp, rows: rows, notes: notes,
      sampling: { pRes: rep.sampling.pRes, cgr: rep.sampling.cgr, depth: rep.sampling.depth },
      ready: !!(gg !== null && num(rep.tempF) !== null && rows.length && (!(cgr > 0) || api !== null))
    };
  }

  /* ------------------------------------------------------------ import / template */

  var SECTION = [
    [/^(report|info|general|sample)/, 'report'], [/^(recomb|sep|flash)/, 'recomb'],
    [/^(cce|constant|ccs)/, 'cce'], [/^(visc)/, 'visc'], [/^(comp)/, 'comp']
  ];
  var KEYS = [
    [/^fluid/, 'fluid'], [/producing|field|sampling.*cgr|cgr.*(field|sampling)/, 'cgrField'], [/c7.*(mol|mw|weight)/, 'mw7'],
    [/c7.*(sg|specific|gravity|density)/, 'sg7'], [/reservoir pressure|^p\s*res|static/, 'pRes'], [/depth/, 'depth'],
    [/temperature|^t\s*res/, 'tempF'], [/type/, 'type'], [/name/, 'name']
  ];
  var RKEYS = [
    [/pressure|^p\s*sep/, 'pSep'], [/temperature|^t\s*sep/, 'tSep'], [/gas.*gravity|^gg|gamma/, 'gg'],
    [/cgr|condensate.gas|ratio/, 'cgr'], [/api|condensate.*gravity/, 'api']
  ];
  /* the same spreadsheet-tolerant reading as an oil report (reports.js) */
  var splitLine = U.splitLine, toNumD = U.toNum;

  /* A report file is a gas report when it says so ([report] fluid,gas) or
     carries a [recombination] section. */
  function isGasText(text) {
    var t = String(text || '');
    return /^\s*"?fluid"?\s*[,;\t]\s*"?gas/im.test(t) || /^\s*"?\[\s*recomb/im.test(t);
  }

  function parseReportText(text, fallbackName) {
    var t = String(text || '').replace(/^\uFEFF/, '');
    var rep = emptyReport(fallbackName || 'Imported gas report');
    var sec = null, any = false, compIn = [];
    var allLines = t.split(/\r?\n/), d = U.detectDelim(allLines);
    var toNum = function (s) { return toNumD(s, d); };
    allLines.forEach(function (raw) {
      var line = U.cleanLine(raw);
      if (!line) return;
      var head = U.sectionHead(line), m = head === null ? null : [line, head];
      if (m) {
        var hd = m[1].trim().toLowerCase();
        sec = null;
        SECTION.forEach(function (s) { if (!sec && s[0].test(hd)) sec = s[1]; });
        if (!sec) throw new Error('Unknown section [' + m[1] + ']. Use [report], [recombination], [cce], [viscosity] or [composition].');
        return;
      }
      if (!sec) return;
      var cells = splitLine(line, d), nums = cells.map(toNum);
      if (sec === 'report' || sec === 'recomb') {
        var key = cells[0].toLowerCase(), hit = null;
        (sec === 'report' ? KEYS : RKEYS).forEach(function (k) { if (!hit && k[0].test(key)) hit = k[1]; });
        if (!hit) return;
        any = true;
        if (sec === 'recomb') { rep.recomb[hit] = toNum(cells[1]); return; }
        if (hit === 'fluid') return;
        if (hit === 'name') rep.name = String(cells[1] || rep.name).slice(0, 80);
        else if (hit === 'type') rep.type = /bh|bottom|down/i.test(cells[1]) ? 'bhs' : 'sep';
        else if (hit === 'cgrField') rep.sampling.cgr = toNum(cells[1]);
        else if (hit === 'pRes' || hit === 'depth') rep.sampling[hit] = toNum(cells[1]);
        else if (hit === 'mw7' || hit === 'sg7') rep.comp[hit] = toNum(cells[1]);
        else rep[hit] = toNum(cells[1]);
        return;
      }
      if (sec === 'comp') {
        var c = Rep.normComp(cells[0]);
        if (!c) {
          var lk = cells[0].toLowerCase();
          if (/c7.*(mw|mol|weight)/.test(lk)) rep.comp.mw7 = nums[1];
          else if (/c7.*(sg|specific|gravity)/.test(lk)) rep.comp.sg7 = nums[1];
          return;
        }
        compIn.push({ c: c, z: nums[1], y: nums[2], x: nums[3] }); any = true;
        return;
      }
      if (nums[0] === null) return;
      any = true;
      if (sec === 'cce') rep.cce.rows.push({ p: nums[0], z: nums[1], v: nums[2], liq: nums[3], use: true });
      if (sec === 'visc') rep.visc.rows.push({ p: nums[0], mug: nums[1], use: true });
    });
    if (!any) throw new Error('No gas PVT data found. Start each test with a section line such as [cce] - download the gas template to see the layout.');
    if (compIn.length) {
      var byC = {};
      compIn.forEach(function (q) { byC[q.c] = q; });
      rep.comp.rows = Rep.COMPONENTS.map(function (k) { return byC[k.c] || { c: k.c, z: null, y: null, x: null }; });
    }
    return [cleanReport(rep)];
  }

  var TEMPLATE = [
    '# Black-Oil PVT Generator - gas PVT report import template',
    '# Copyright (c) 2026 Ankaj Kumar Sinha - MIT licence',
    '# Field units. One file per report; lines starting with # are ignored, as are header rows.',
    '# Dry and wet gases (single-phase in the reservoir). Leave a cell empty if not measured.',
    '[report]',
    'fluid,gas',
    'name,G-1 separator recombination',
    'sample type,sep   # sep = separator recombination / bhs = downhole',
    'reservoir temperature degF,240',
    'reservoir pressure at sampling psia,5200',
    'producing CGR at sampling STB/MMscf,9.5',
    'C7+ molecular weight,105',
    'C7+ specific gravity,0.745',
    '',
    '[recombination]',
    'separator pressure psia,800',
    'separator temperature degF,80',
    'separator gas gravity,0.68',
    'CGR STB/MMscf,9.2',
    'condensate API,58',
    '',
    '[cce]',
    'pressure psia,gas z,relative volume V/Vref,liquid dropout % of cell',
    '6000,1.0650,1.0000,0',
    '5000,0.9980,1.1244,0',
    '4000,0.9405,1.3245,0',
    '3000,0.9030,1.6956,0',
    '',
    '[viscosity]',
    'pressure psia,gas viscosity cp',
    '6000,0.0298',
    '4000,0.0236',
    '2000,0.0176',
    '',
    '[composition]',
    'component,well stream mol%,separator gas mol%,separator liquid mol%',
    'N2,0.45,0.45,0.03',
    'CO2,2.10,2.11,0.85',
    'C1,86.27,86.69,12.10',
    'C7+,0.35,0.02,38.40',
    ''
  ].join('\n');

  /* ------------------------------------------------------------ example reports */

  /* Built from an equation-of-state description of the same fluid: the
     separator gas and liquid from a flash at separator conditions, the
     condensate from a second flash to stock-tank conditions, the CGR from
     the two, z from the composition and viscosity from Lee-Gonzalez-Eakin.
     The second report carries faults (a z typo, a volume that disagrees
     with its z, an analysis short of C1, a field CGR the recombination
     does not match, a viscosity out of line); the third is a dry gas. */
  function demoReports() {
    var base = { N2: 0.45, CO2: 2.10, H2S: 0, C2: 6.20, C3: 2.70, iC4: 0.62, nC4: 0.78, iC5: 0.33, nC5: 0.30, C6: 0.42 };
    function wellStream(c7, scale) {
      var o = {}, s = 0, k;
      for (k in base) { o[k] = base[k] * (scale || 1); s += o[k]; }
      o['C7+'] = c7; o.C1 = 100 - s - c7;
      return o;
    }
    function make(o) {
      var Z = o.z, rows = Rep.COMPONENTS.map(function (k) { return { c: k.c, z: Z[k.c] || 0 }; });
      var comp = { rows: rows, mw7: o.mw7, sg7: o.sg7 };
      var mx = Eos.mixture(comp), fl = Eos.flash(mx, o.tSep, o.pSep);
      var lump = function (arr) {
        var out = {};
        mx.comps.forEach(function (q, i) { var c = q.plus ? 'C7+' : q.c; out[c] = (out[c] || 0) + arr[i] * 100; });
        return out;
      };
      var y = fl ? lump(fl.y) : lump(mx.z), x = fl ? lump(fl.x) : null, cgr = 0, api = null;
      if (fl) {
        var mxL = { comps: mx.comps, n: mx.n, kij: mx.kij, z: Array.prototype.slice.call(fl.x) };
        var st = Eos.flash(mxL, 60, 14.7), xs = st ? st.x : fl.x, b2 = st ? st.beta : 0;
        var mo = 0; mx.comps.forEach(function (q, i) { mo += xs[i] * q.m; });
        api = 5954 / mo + 8.811;
        var go = 141.5 / (api + 131.5);
        var bbl = (1 - fl.beta) * (1 - b2) * mo / (LB_PER_BBL_WATER * go), scf = fl.beta * SCF_PER_LBMOL;
        cgr = 1e6 * bbl / scf;
      }
      var rep = emptyReport(o.name);
      rep.type = o.type; rep.tempF = o.tempF;
      rep.comp = { rows: Rep.COMPONENTS.map(function (k) {
        return { c: k.c, z: +(Z[k.c] || 0).toFixed(3), y: +(y[k.c] || 0).toFixed(3), x: x ? +(x[k.c] || 0).toFixed(3) : null };
      }), mw7: o.mw7, sg7: o.sg7 };
      var ya = analysis(rep, 'y'), za = analysis(rep, 'z');
      rep.recomb = { pSep: o.pSep, tSep: o.tSep, gg: +ya.gravity.toFixed(4), cgr: +cgr.toFixed(2), api: api === null ? null : +api.toFixed(1) };
      rep.sampling = { pRes: o.pRes, cgr: +(cgr * (o.cgrField || 1.03)).toFixed(1), depth: o.depth || null };
      var pref = o.cceP[0], zref = zFrom(za, o.tempF, pref) * 1.004;
      rep.cce.rows = o.cceP.map(function (p, i) {
        var z = zFrom(za, o.tempF, p) * (1.004 + 0.0015 * Math.sin(1.7 * i));
        return { p: p, z: +z.toFixed(4), v: +((z / zref) * (pref / p)).toFixed(4), liq: 0, use: true };
      });
      rep.visc.rows = o.viscP.map(function (p, i) {
        var z = zFrom(za, o.tempF, p);
        return { p: p, mug: +(mugLge(z, p, o.tempF, za.gravity) * (1.02 + 0.006 * Math.cos(2.1 * i))).toFixed(5), use: true };
      });
      return cleanReport(rep);
    }
    var common = { tempF: 240, pSep: 800, tSep: 80, pRes: 5200, mw7: 105, sg7: 0.745,
                   cceP: [6000, 5500, 5000, 4500, 4000, 3500, 3000, 2500, 2000, 1500, 1000],
                   viscP: [6000, 5000, 4000, 3000, 2000, 1000] };
    function ext(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
    var g1 = make(ext(common, { name: 'G-1 separator recombination', type: 'sep', z: wellStream(0.35) }));
    var g2 = make(ext(common, { name: 'G-2 repeat recombination', type: 'sep', z: wellStream(0.38), mw7: 107, sg7: 0.748, cgrField: 1.42 }));
    /* faults in the repeat study */
    g2.cce.rows[4].z = +(g2.cce.rows[4].z * 1.03).toFixed(4);                 /* z typo */
    g2.cce.rows[7].v = +(g2.cce.rows[7].v * 1.012).toFixed(4);                /* a volume that disagrees with its z */
    g2.comp.rows.filter(function (q) { return q.c === 'C1'; })[0].z = 84.40;  /* C1 short: 98 mol % */
    g2.visc.rows[2].mug = +(g2.visc.rows[2].mug * 1.18).toFixed(5);           /* viscosity out of line */
    var g3 = make(ext(common, { name: 'H-1 dry gas (downhole)', type: 'bhs', tempF: 205, pRes: 4100, depth: 9200,
                                z: (function () { var o = wellStream(0, 0.45); return o; })(), mw7: null, sg7: null,
                                cceP: [5000, 4500, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 500], viscP: [5000, 4000, 3000, 2000, 1000] }));
    return [g1, g2, g3];
  }

  return {
    CHECKS: CHECKS, COLS: COLS, TEMPLATE: TEMPLATE,
    emptyReport: emptyReport, cleanReport: cleanReport, qcReport: qcReport, finalise: finalise,
    analysis: analysis, zFrom: zFrom, mugLge: mugLge, eosComposition: eosComposition, phaseOf: phaseOf,
    isGasText: isGasText, parseReportText: parseReportText, demoReports: demoReports
  };
});
