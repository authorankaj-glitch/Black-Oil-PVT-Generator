/*
 * Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. MIT licence (see LICENSE).
 *
 * samples.js -- screening of several PVT reports from one reservoir, and a
 * field-wide regression of the correlations against the samples that pass.
 *
 * A reservoir usually has more than one PVT study: bottomhole samples from
 * several wells, separator recombinations, repeat studies. Before any of them
 * is used to tune a correlation, each has to be shown to be (a) internally
 * consistent and (b) representative of the reservoir fluid, and the set has
 * to be shown to describe one fluid system. This module does both, then
 * fits ONE set of multipliers to all the accepted samples together.
 *
 * Sample (field units throughout):
 *   {
 *     id, name,
 *     type:    'bhs' (bottomhole) | 'sep' (separator recombination),
 *     fluid:   { api, gammaG, rsb, tempF, tSepF?, pSepPsia? },
 *     sampling:{ pRes?, pwf?, gor?, depth? }
 *                                      static reservoir pressure, flowing
 *                                      bottomhole pressure (psia), producing
 *                                      GOR (scf/STB) at sampling, and the
 *                                      bottomhole sampling depth (ft TVD)
 *     lab:     { pb, muod, rows: [{ p, rs, bo, muo, z, mug }] }
 *     include: null (follow the screening) | true | false (engineer's call)
 *   }
 *
 * Screening checks (status 'pass' | 'warn' | 'fail' | 'na'):
 *   Per sample
 *     inputs     fluid description complete and inside the correlation ranges
 *     sampling   Pb against reservoir and flowing pressure, Rsb against the
 *                producing GOR - the classic representativity tests
 *     pbCorr     measured Pb against the selected Pb correlation
 *     rsTrend    Rs rises with pressure to Pb and equals Rsb above it
 *     boTrend    Bo rises with pressure to Pb and falls above it
 *     muTrend    oil viscosity falls with pressure to Pb and rises above it
 *     boRs       Bo against the selected Bo correlation AT THE MEASURED Rs -
 *                a Bo/Rs consistency test independent of the Pb correlation
 *     range      every value inside a physical range
 *     points     single points out of line with their neighbours: the
 *                sample is tuned on its own, and a residual that jumps away
 *                from the residuals either side of it is a typo or a bad
 *                reading (a smooth misfit is the correlation's shape, not
 *                the data, and is left alone)
 *   Across the set (needs three or more samples with the property)
 *     fieldPb, fieldBo, fieldMu
 *                each sample's bias against the correlation, compared with
 *                the other samples' by a robust (median / MAD) z-score. A
 *                correlation can be biased for a whole field - that is what
 *                tuning removes - but a sample biased differently from its
 *                neighbours is either a bad sample or a different fluid.
 *     fieldApi   stock-tank gravity far from the others: another compartment
 *     fieldDepth bottomhole samples only: temperature, Pb and Rsb against
 *                the depth trend of the OTHER bottomhole samples (leave one
 *                out, so a bad sample cannot bend the trend it is tested
 *                against). Temperature follows the geothermal gradient;
 *                Pb and Rsb change smoothly with depth under compositional
 *                grading. A sample off the trend is mislabelled, from
 *                another compartment, or not representative.
 *
 * The field-wide fit is tuning.js's regression with every objective summed
 * over the accepted samples: each sample keeps its own API, gas gravity,
 * Rsb and temperature, and the multipliers are shared.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./pvt-model.js'), require('./tuning.js'), require('./correlations.js'));
  } else {
    root.PVTSamples = factory(root.PVTModel, root.PVTTuning, root.PVTCorr);
  }
})(typeof self !== 'undefined' ? self : this, function (Model, Tune, C) {
  'use strict';

  var CHECKS = [
    { key: 'inputs', label: 'Fluid description', short: 'Inputs' },
    { key: 'sampling', label: 'Sampling conditions', short: 'Sampling' },
    { key: 'pbCorr', label: 'Pb against correlation', short: 'Pb' },
    { key: 'rsTrend', label: 'Rs trend', short: 'Rs' },
    { key: 'boTrend', label: 'Bo trend', short: 'Bo' },
    { key: 'muTrend', label: 'Viscosity trend', short: 'μo' },
    { key: 'boRs', label: 'Bo / Rs consistency', short: 'Bo–Rs' },
    { key: 'range', label: 'Physical range', short: 'Range' },
    { key: 'points', label: 'Point outliers', short: 'Points' },
    { key: 'fieldPb', label: 'Pb bias against the other samples', short: 'Field Pb' },
    { key: 'fieldBo', label: 'Bo bias against the other samples', short: 'Field Bo' },
    { key: 'fieldMu', label: 'Viscosity bias against the other samples', short: 'Field μo' },
    { key: 'fieldApi', label: 'Oil gravity against the other samples', short: 'Field API' },
    { key: 'fieldDepth', label: 'Depth trends of the bottomhole samples', short: 'Depth' }
  ];
  var RANK = { na: 0, pass: 1, warn: 2, fail: 3 };
  var NAMES = {
    standing: 'Standing', vasquezBeggs: 'Vasquez-Beggs', glaso: 'Glaso', alMarhoun: 'Al-Marhoun',
    petroskyFarshad: 'Petrosky-Farshad', lasater: 'Lasater'
  };
  function nm(k) { return NAMES[k] || k; }

  /* Modified z-score (Iglewicz and Hoaglin, 1993) thresholds. */
  var Z_WARN = 2.5, Z_FAIL = 3.5;
  /* Smallest spread the robust z-score will divide by (in ln units, about
     2 %): samples that agree to within the lab's repeatability are not
     outliers of each other. */
  var MAD_FLOOR = 0.02;

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function pct(x, d) { return (100 * x).toFixed(d === undefined ? 1 : d) + ' %'; }
  function worst(list) {
    return list.reduce(function (a, s) { return RANK[s] > RANK[a] ? s : a; }, 'na');
  }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), n = s.length;
    return n ? (n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2])) : null;
  }

  /* ------------------------------------------------------------ inputs */

  /* The model input for one sample: the case's correlations, water and
     table settings, with the sample's own fluid description. Samples are
     always specified by Rsb, so the Pb correlation places their Pb and a
     measured Pb stays a measurement to fit. */
  function sampleInput(base, s) {
    var o = JSON.parse(JSON.stringify(base || {}));
    delete o.lab; delete o.tune; delete o.tuning; delete o.calib;
    var f = s.fluid || {};
    o.fluid = 'oil';
    o.spec = 'rsb';
    o.api = f.api; o.gammaG = f.gammaG; o.rsb = f.rsb; o.tempF = f.tempF;
    if (num(f.tSepF) !== null) o.tSepF = f.tSepF;
    if (num(f.pSepPsia) !== null) o.pSepPsia = f.pSepPsia;
    var pHi = 0;
    ((s.lab || {}).rows || []).forEach(function (r) { if (num(r.p) !== null) pHi = Math.max(pHi, r.p); });
    o.pMin = 14.7;
    o.pMax = Math.max(o.pMax || 0, pHi * 1.05, 500);
    return o;
  }

  function lite(input, tuning) {
    var o = JSON.parse(JSON.stringify(input));
    o.tuning = tuning || null;
    o.pointsOnly = true;
    return Model.build(o);
  }

  function inputProblems(s) {
    var f = s.fluid || {}, out = [];
    if (!(num(f.api) > 5 && f.api < 70)) out.push('oil gravity missing or outside 5 - 70 API');
    if (!(num(f.gammaG) > 0.5 && f.gammaG < 2)) out.push('gas gravity missing or outside 0.5 - 2.0');
    if (!(num(f.rsb) > 0)) out.push('Rsb missing');
    if (!(num(f.tempF) > 32 && f.tempF < 400)) out.push('temperature missing or outside 32 - 400 degF');
    return out;
  }

  /* ------------------------------------------------------ per-sample QC */

  function check(key, status, detail, value) {
    var def = CHECKS.filter(function (c) { return c.key === key; })[0];
    return { key: key, label: def.label, status: status, detail: detail, value: value === undefined ? null : value };
  }

  /* A trend test on the rows of one branch: every step must move the right
     way (dir +1 rising, -1 falling with pressure). Steps against the trend
     smaller than tol (relative) are lab scatter and pass. */
  function trend(rows, col, dir, tol) {
    var pts = rows.filter(function (r) { return r[col] !== null; });
    var bad = [], worstStep = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var step = dir * (b[col] - a[col]) / Math.max(Math.abs(a[col]), 1e-9);
      if (step < -tol) {
        bad.push(a.p.toFixed(0) + ' to ' + b.p.toFixed(0) + ' psia');
        worstStep = Math.max(worstStep, -step);
      }
    }
    return { n: pts.length, bad: bad, worst: worstStep };
  }

  function trendCheck(key, name, sat, uns, col, dirSat, dirUns, tol) {
    var a = trend(sat, col, dirSat, tol), b = trend(uns, col, dirUns, tol);
    if (a.n + b.n < 2) return check(key, 'na', 'Fewer than two ' + name + ' points.');
    var bad = a.bad.concat(b.bad), w = Math.max(a.worst, b.worst);
    if (!bad.length) {
      return check(key, 'pass', name + ' ' + (dirSat > 0 ? 'rises' : 'falls') + ' with pressure to Pb' +
        (b.n ? ' and ' + (dirUns > 0 ? 'rises' : 'falls') + ' above it' : '') + '.');
    }
    return check(key, w > 5 * tol ? 'fail' : 'warn',
      name + ' moves against the expected trend between ' + bad.join(', ') +
      ' (largest step ' + pct(w) + '). Check for a transcription error or a leaking cell.', w);
  }

  function qcSample(base, s) {
    var out = [], f = s.fluid || {}, samp = s.sampling || {};
    var data = Tune.normalize(s.lab, 'oil');
    var probs = inputProblems(s);
    if (probs.length) {
      out.push(check('inputs', 'fail', 'Cannot model this sample: ' + probs.join('; ') + '.'));
      return { checks: out, model: null, data: data, input: null };
    }
    var input = sampleInput(base, s), m;
    try { m = lite(input, null); } catch (e) {
      out.push(check('inputs', 'fail', e.message));
      return { checks: out, model: null, data: data, input: input };
    }
    var nData = data.rows.length + (data.pb !== null ? 1 : 0) + (data.muod !== null ? 1 : 0);
    var rng = [], R = C.RANGES || {}, corr = input.corr || {};
    [['pb', corr.pb], ['bo', corr.bo]].forEach(function (pr) {
      var lim = R[pr[1]];
      if (!lim) return;
      if (lim.api && (f.api < lim.api[0] || f.api > lim.api[1])) rng.push('API outside the ' + nm(pr[1]) + ' range');
      if (lim.tempF && (f.tempF < lim.tempF[0] || f.tempF > lim.tempF[1])) rng.push('temperature outside the ' + nm(pr[1]) + ' range');
      if (lim.rsb && (f.rsb < lim.rsb[0] || f.rsb > lim.rsb[1])) rng.push('Rsb outside the ' + nm(pr[1]) + ' range');
    });
    if (!nData) out.push(check('inputs', 'fail', 'No laboratory data entered.'));
    else if (rng.length) out.push(check('inputs', 'warn', 'Complete, but ' + rng.filter(function (x, i) { return rng.indexOf(x) === i; }).join('; ') + '.'));
    else out.push(check('inputs', 'pass', 'Complete; ' + nData + ' laboratory value' + (nData === 1 ? '' : 's') + '.'));

    var pb = data.pb !== null ? data.pb : null;
    var split = pb !== null ? pb : m.pb;

    /* sampling representativity */
    var sm = [], st = [];
    if (pb !== null && num(samp.pRes) !== null) {
      var over = pb / samp.pRes - 1;
      if (over > 0.05) { st.push('fail'); sm.push('Pb is ' + pct(over) + ' above the reservoir pressure - not possible for an in-situ oil; the sample has taken on free gas.'); }
      else if (over > 0.01) { st.push('warn'); sm.push('Pb is ' + pct(over) + ' above the reservoir pressure - saturated at best; check for free gas.'); }
      else { st.push('pass'); sm.push('Pb below reservoir pressure (' + pct(-over) + ' margin).'); }
    }
    if (s.type !== 'sep' && pb !== null && num(samp.pwf) !== null) {
      var m2 = samp.pwf / pb - 1;
      if (m2 < 0) { st.push('fail'); sm.push('Flowing pressure at sampling was ' + pct(-m2) + ' below Pb - the bottomhole sample was taken two-phase.'); }
      else if (m2 < 0.03) { st.push('warn'); sm.push('Flowing pressure only ' + pct(m2) + ' above Pb at sampling.'); }
      else { st.push('pass'); sm.push('Sampled single-phase (flowing pressure ' + pct(m2) + ' above Pb).'); }
    }
    if (num(samp.gor) !== null && samp.gor > 0) {
      var d = f.rsb / samp.gor - 1, ad = Math.abs(d);
      var sgor = ad > 0.2 ? 'fail' : ad > 0.1 ? 'warn' : 'pass';
      st.push(sgor);
      sm.push('Rsb is ' + pct(d) + ' from the producing GOR' +
        (sgor === 'pass' ? '.' : d < 0 ? ' - gas lost from the sample, or free gas produced at sampling.' : ' - excess gas in the sample or the recombination.'));
    }
    out.push(st.length ? check('sampling', worst(st), sm.join(' ')) :
      check('sampling', 'na', 'No sampling pressures or producing GOR entered.'));

    /* measured Pb against the correlation */
    if (pb !== null) {
      var dev = pb / m.pbCalc - 1, adv = Math.abs(dev);
      out.push(check('pbCorr', adv > 0.3 ? 'fail' : adv > 0.15 ? 'warn' : 'pass',
        'Measured ' + pb.toFixed(0) + ' psia against ' + m.pbCalc.toFixed(0) + ' psia from ' + nm(corr.pb) +
        ' (' + (dev >= 0 ? '+' : '') + pct(dev) + ').', dev));
    } else {
      out.push(check('pbCorr', 'na', 'No measured Pb.'));
    }

    var sat = data.rows.filter(function (r) { return r.p <= split + 1e-6; });
    var uns = data.rows.filter(function (r) { return r.p > split + 1e-6; });

    /* Rs */
    var rsT = trend(sat, 'rs', 1, 0.005), rsN = rsT.n;
    var rsBad = rsT.bad.slice(), rsSt = [];
    if (rsN >= 2) rsSt.push(rsBad.length ? (rsT.worst > 0.05 ? 'fail' : 'warn') : 'pass');
    var rsAbove = uns.filter(function (r) { return r.rs !== null; })
      .concat(sat.filter(function (r) { return r.rs !== null && Math.abs(r.p - split) < 1; }));
    var rsMsg = [];
    if (rsBad.length) rsMsg.push('Rs falls with rising pressure between ' + rsBad.join(', ') + '.');
    if (rsAbove.length) {
      var worstRs = rsAbove.reduce(function (a, r) { return Math.max(a, Math.abs(r.rs / f.rsb - 1)); }, 0);
      rsSt.push(worstRs > 0.1 ? 'fail' : worstRs > 0.03 ? 'warn' : 'pass');
      rsMsg.push('Rs at and above Pb within ' + pct(worstRs) + ' of Rsb' + (worstRs > 0.03 ? ' - Rs and Rsb are not on the same basis.' : '.'));
    }
    out.push(rsSt.length ? check('rsTrend', worst(rsSt), rsMsg.join(' ') || 'Rs rises with pressure to Pb.') :
      check('rsTrend', 'na', 'Fewer than two Rs points.'));

    out.push(trendCheck('boTrend', 'Bo', sat, uns, 'bo', 1, -1, 0.001));
    out.push(trendCheck('muTrend', 'Oil viscosity', sat, uns, 'muo', -1, 1, 0.01));

    /* Bo against the correlation at the measured Rs */
    var pairs = sat.filter(function (r) { return r.rs !== null && r.bo !== null; });
    if (pairs.length) {
      var sCorr = { api: f.api, gammaG: f.gammaG, tempF: f.tempF, tSepF: input.tSepF,
                    pSepPsia: input.pSepPsia, rsb: f.rsb, pb: split };
      var devs = pairs.map(function (r) { return C.BO[corr.bo](r.rs, sCorr) / r.bo - 1; });
      var aare = devs.reduce(function (a, x) { return a + Math.abs(x); }, 0) / devs.length;
      out.push(check('boRs', aare > 0.08 ? 'fail' : aare > 0.04 ? 'warn' : 'pass',
        'Bo from ' + nm(corr.bo) + ' at the measured Rs is within ' + pct(aare) + ' on average (' + pairs.length + ' points).',
        devs.reduce(function (a, x) { return a + x; }, 0) / devs.length));
    } else {
      out.push(check('boRs', 'na', 'No saturated rows with both Rs and Bo.'));
    }

    /* physical ranges */
    var bad = [];
    data.rows.forEach(function (r) {
      if (r.bo !== null && (r.bo < 1 || r.bo > 3.5)) bad.push('Bo ' + r.bo + ' at ' + r.p);
      if (r.rs !== null && r.rs > 5000) bad.push('Rs ' + r.rs + ' at ' + r.p);
      if (r.muo !== null && (r.muo < 0.05 || r.muo > 1e4)) bad.push('oil viscosity ' + r.muo + ' at ' + r.p);
      if (r.z !== null && (r.z < 0.25 || r.z > 1.3)) bad.push('z ' + r.z + ' at ' + r.p);
      if (r.mug !== null && (r.mug < 0.005 || r.mug > 0.2)) bad.push('gas viscosity ' + r.mug + ' at ' + r.p);
    });
    if (pb !== null && pb > 15000) bad.push('Pb ' + pb);
    out.push(nData ? check('range', bad.length ? 'fail' : 'pass',
      bad.length ? 'Outside the physical range: ' + bad.slice(0, 4).join('; ') + (bad.length > 4 ? '; ...' : '') + ' (psia).' :
        'All values inside the physical range.') : check('range', 'na', 'No data.'));

    out.push(spikeCheck(input, s.lab));

    return { checks: out, model: m, data: data, input: input, split: split };
  }

  /* Residual jump that marks a point as out of line: [warn, fail]. */
  var SPIKE = {
    rs: [0.06, 0.15], boSat: [0.01, 0.025], boUns: [0.005, 0.015],
    muoSat: [0.06, 0.15], muoUns: [0.04, 0.1], z: [0.015, 0.04], mug: [0.05, 0.12]
  };
  var SPIKE_NAME = { rs: 'Rs', boSat: 'Bo', boUns: 'Bo', muoSat: 'oil viscosity', muoUns: 'oil viscosity', z: 'z', mug: 'gas viscosity' };

  function spikeCheck(input, lab) {
    var reg;
    try { reg = Tune.regress(input, lab); } catch (e) { return check('points', 'na', 'The sample could not be tuned on its own: ' + e.message); }
    var found = [], tested = 0;
    Object.keys(SPIKE).forEach(function (key) {
      var pts = (reg.after[key] || { points: [] }).points.slice().sort(function (a, b) { return a.p - b.p; });
      if (pts.length < 3) return;
      tested += pts.length;
      pts.forEach(function (q, i) {
        var nb = [];
        if (i > 0) nb.push(pts[i - 1].err);
        if (i < pts.length - 1) nb.push(pts[i + 1].err);
        var jump = Math.abs(q.err - nb.reduce(function (a, x) { return a + x; }, 0) / nb.length);
        if (jump > SPIKE[key][0]) {
          /* An interior spike next to an end point gives both the same jump;
             an end-point spike gives its interior neighbour only half. So a
             tie goes to the interior point. */
          var end = i === 0 || i === pts.length - 1;
          found.push({ key: key, p: q.p, meas: q.meas, jump: jump, score: jump * (end ? 0.9 : 1),
                       fail: jump > SPIKE[key][1] });
        }
      });
    });
    if (!tested) return check('points', 'na', 'Needs three or more points of a property.');
    if (!found.length) return check('points', 'pass', 'No point out of line with its neighbours (' + tested + ' tested).');
    /* a spike drags its neighbours' jumps up too - report each property's worst */
    var byKey = {};
    found.forEach(function (f) { if (!byKey[f.key] || f.score > byKey[f.key].score) byKey[f.key] = f; });
    var list = Object.keys(byKey).map(function (k) { return byKey[k]; });
    return check('points', list.some(function (f) { return f.fail; }) ? 'fail' : 'warn',
      list.map(function (f, i) {
        var nameOf = SPIKE_NAME[f.key];
        if (i === 0) nameOf = nameOf.charAt(0).toUpperCase() + nameOf.slice(1);
        return nameOf + ' ' + f.meas + ' at ' + f.p.toFixed(0) + ' psia is ' + pct(f.jump) + ' out of line with its neighbours';
      }).join('; ') + '. Correct or delete the point.', list);
  }

  /* ------------------------------------------------------ across samples */

  /* Signed mean log bias of a sample against the untuned correlation. */
  function bias(q, prop) {
    if (!q.model) return null;
    if (prop === 'pb') return q.data.pb !== null ? Math.log(q.data.pb / q.model.pbCalc) : null;
    var c = Tune.compare(q.model, q.data, q.split, prop)[prop];
    if (!c.n) return null;
    return c.points.reduce(function (a, pt) { return a + Math.log(pt.meas / pt.calc); }, 0) / c.n;
  }

  function fieldCheck(key, name, list) {
    var vals = list.filter(function (x) { return x.v !== null; });
    var res = {};
    list.forEach(function (x) {
      res[x.id] = check(key, 'na', vals.length < 3 ? 'Needs three or more samples with ' + name + '.' : 'No ' + name + ' for this sample.');
    });
    if (vals.length < 3) return res;
    var med = median(vals.map(function (x) { return x.v; }));
    var mad = Math.max(median(vals.map(function (x) { return Math.abs(x.v - med); })), MAD_FLOOR);
    vals.forEach(function (x) {
      var z = 0.6745 * (x.v - med) / mad;
      var off = Math.exp(x.v - med) - 1;
      var status = Math.abs(z) > Z_FAIL ? 'fail' : Math.abs(z) > Z_WARN ? 'warn' : 'pass';
      res[x.id] = check(key, status,
        'Bias against the correlation ' + (x.v >= 0 ? '+' : '') + pct(Math.exp(x.v) - 1) +
        ', field median ' + (med >= 0 ? '+' : '') + pct(Math.exp(med) - 1) + ': this sample sits ' +
        (off >= 0 ? '+' : '') + pct(off) + ' from the others (robust z = ' + (Math.abs(z) < 0.05 ? '0.0' : z.toFixed(1)) + ').' +
        (status === 'pass' ? '' : ' A sample biased differently from its neighbours is a bad sample or a different fluid.'), z);
    });
    return res;
  }

  /* ------------------------------------------------------ depth trends */

  /* Robust straight line y = a + b x (Theil-Sen: median of the pairwise
     slopes, median intercept), so one bad sample cannot tilt the trend. */
  function robustLine(pts) {
    var sl = [];
    for (var i = 0; i < pts.length; i++) {
      for (var j = i + 1; j < pts.length; j++) {
        if (Math.abs(pts[j].x - pts[i].x) > 1e-9) sl.push((pts[j].y - pts[i].y) / (pts[j].x - pts[i].x));
      }
    }
    if (!sl.length) return null;
    var b = median(sl);
    return { a: median(pts.map(function (q) { return q.y - b * q.x; })), b: b };
  }

  /* Straight line y = a + b x through the points (least squares). */
  function line(pts) {
    var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (q) { sx += q.x; sy += q.y; sxx += q.x * q.x; sxy += q.x * q.y; });
    var d = n * sxx - sx * sx;
    if (n < 2 || Math.abs(d) < 1e-9) return null;
    var b = (n * sxy - sx * sy) / d;
    return { a: (sy - b * sx) / n, b: b };
  }

  /* Tolerances against the depth trend: [warn, fail]. Temperature in degF,
     Pb and Rsb as relative departures. */
  var DEPTH_TOL = { tempF: [5, 10], pb: [0.08, 0.15], rsb: [0.08, 0.15] };
  /* The other samples must span at least this depth (ft) to define a trend;
     closer than this and the trend is noise. */
  var DEPTH_SPAN = 50;

  /* Leave-one-out depth test for every bottomhole sample with a depth. The
     trend is drawn through the other samples that pass their own checks
     (all the others when fewer than two do), with a robust line. */
  function depthChecks(samples, soundIds) {
    var pts = samples.map(function (s) {
      var d = num((s.sampling || {}).depth);
      return s.type === 'sep' || d === null ? null : {
        id: s.id, depth: d, tempF: num(s.fluid.tempF), rsb: num(s.fluid.rsb), pb: num((s.lab || {}).pb)
      };
    }).filter(function (x) { return x; });
    var res = {};
    samples.forEach(function (s) {
      res[s.id] = check('fieldDepth', 'na', s.type === 'sep' ? 'Separator recombination: no sampling depth.' :
        num((s.sampling || {}).depth) === null ? 'No sampling depth entered.' :
          'Needs three or more bottomhole samples with a depth.');
    });
    if (pts.length < 3) return res;
    /* the geothermal gradient across all of them, for the report */
    var tAll = line(pts.filter(function (q) { return q.tempF !== null; }).map(function (q) { return { x: q.depth, y: q.tempF }; }));
    pts.forEach(function (q) {
      var others = pts.filter(function (o) { return o.id !== q.id; });
      var sound = others.filter(function (o) { return soundIds.indexOf(o.id) >= 0; });
      if (sound.length >= 2) others = sound;
      var lo = Math.min.apply(null, others.map(function (o) { return o.depth; }));
      var hi = Math.max.apply(null, others.map(function (o) { return o.depth; }));
      if (hi - lo < DEPTH_SPAN) {
        res[q.id] = check('fieldDepth', 'na', 'The other bottomhole samples span less than ' + DEPTH_SPAN + ' ft - too little to define a depth trend.');
        return;
      }
      var msgs = [], st = [];
      ['tempF', 'pb', 'rsb'].forEach(function (k) {
        if (q[k] === null) return;
        var fit = robustLine(others.filter(function (o) { return o[k] !== null; }).map(function (o) {
          return { x: o.depth, y: k === 'tempF' ? o[k] : Math.log(o[k]) };
        }));
        if (!fit) return;
        var pred = fit.a + fit.b * q.depth;
        var off = k === 'tempF' ? q[k] - pred : Math.exp(Math.log(q[k]) - pred) - 1;
        var a = Math.abs(off), tol = DEPTH_TOL[k];
        var status = a > tol[1] ? 'fail' : a > tol[0] ? 'warn' : 'pass';
        st.push(status);
        var name = { tempF: 'Temperature', pb: 'Pb', rsb: 'Rsb' }[k];
        var shown = k === 'tempF' ? off.toFixed(1) : (100 * off).toFixed(1);
        if (Number(shown) === 0) shown = (0).toFixed(1);
        msgs.push(name + ' ' + (Number(shown) > 0 ? '+' : '') + shown + (k === 'tempF' ? ' degF' : ' %') +
          ' from the trend of the others');
      });
      if (!st.length) { res[q.id] = check('fieldDepth', 'na', 'No temperature, Pb or Rsb to test against depth.'); return; }
      var status = worst(st);
      var grad = tAll ? ' Geothermal gradient across the samples ' + (100 * tAll.b).toFixed(2) + ' degF/100 ft' +
        (tAll.b < 0 ? ' - temperature falls with depth, so a depth or a temperature is wrong.' : '.') : '';
      if (tAll && tAll.b < 0 && status === 'pass') status = 'warn';
      res[q.id] = check('fieldDepth', status, msgs.join('; ') + ' at ' + q.depth.toFixed(0) + ' ft.' + grad +
        (st.some(function (x) { return x !== 'pass'; }) ? ' Off the depth trend: a mislabelled depth, another compartment, or an unrepresentative sample.' : ''));
    });
    return res;
  }

  /* Screen a set of samples. Returns one entry per sample: checks, overall
     status, and whether it is included (the engineer's override, else the
     screening's verdict: everything that does not fail). */
  function screenSamples(base, samples) {
    var q = samples.map(function (s) { return qcSample(base, s); });
    var fPb = fieldCheck('fieldPb', 'a measured Pb', samples.map(function (s, i) { return { id: s.id, v: bias(q[i], 'pb') }; }));
    var fBo = fieldCheck('fieldBo', 'saturated Bo', samples.map(function (s, i) { return { id: s.id, v: bias(q[i], 'boSat') }; }));
    var fMu = fieldCheck('fieldMu', 'saturated viscosity', samples.map(function (s, i) {
      var v = q[i].data && q[i].data.muod !== null && q[i].model ? Math.log(q[i].data.muod / q[i].model.muod) : bias(q[i], 'muoSat');
      return { id: s.id, v: v };
    }));
    /* API: absolute spread, not a correlation bias */
    var apis = samples.map(function (s) { return num((s.fluid || {}).api); }).filter(function (v) { return v !== null; });
    var apiMed = apis.length >= 3 ? median(apis) : null;
    /* for the depth trend a sample is sound unless the checks that bear on
       its Pb, Rsb or temperature fail (a typo in its Bo does not matter) */
    var DEPTH_RELEVANT = ['inputs', 'sampling', 'pbCorr', 'rsTrend', 'range'];
    var fDepth = depthChecks(samples, samples.filter(function (s, i) {
      return q[i].model && !q[i].checks.some(function (c) {
        return c.status === 'fail' && DEPTH_RELEVANT.indexOf(c.key) >= 0;
      });
    }).map(function (s) { return s.id; }));
    return samples.map(function (s, i) {
      var checks = q[i].checks.slice();
      if (q[i].model) {
        checks.push(fPb[s.id], fBo[s.id], fMu[s.id]);
        var api = s.fluid.api;
        if (apiMed === null) checks.push(check('fieldApi', 'na', 'Needs three or more samples.'));
        else {
          var dA = api - apiMed;
          checks.push(check('fieldApi', Math.abs(dA) > 8 ? 'fail' : Math.abs(dA) > 4 ? 'warn' : 'pass',
            api.toFixed(1) + ' API against a field median of ' + apiMed.toFixed(1) + ' (' + (dA >= 0 ? '+' : '') + dA.toFixed(1) + ')' +
            (Math.abs(dA) > 4 ? ' - possibly another compartment or a contaminated sample.' : '.'), dA));
        }
        checks.push(fDepth[s.id]);
      }
      var status = worst(checks.map(function (c) { return c.status; }));
      var auto = status !== 'fail' && !!q[i].model;
      return {
        id: s.id, name: s.name, checks: checks, status: status, auto: auto,
        included: s.include === true || s.include === false ? s.include && !!q[i].model : auto,
        overridden: (s.include === true || s.include === false) && s.include !== auto,
        pbCalc: q[i].model ? q[i].model.pbCalc : null, pbMeas: q[i].data.pb
      };
    });
  }

  /* ------------------------------------------------------ pooled fit */

  function prep(base, samples) {
    return samples.map(function (s) {
      var input = sampleInput(base, s);
      var data = Tune.normalize(s.lab, 'oil');
      return { id: s.id, name: s.name, input: input, data: data, base: lite(input, null) };
    });
  }

  /* Pooled statistics of one property over all samples. */
  function pooled(stats, key) {
    var n = 0, sum = 0, max = 0, samples = 0;
    stats.forEach(function (st) {
      var c = st[key];
      if (!c || !c.n) return;
      samples++;
      n += c.n; sum += c.sae; max = Math.max(max, c.maxAre);
    });
    return { n: n, samples: samples, aare: n ? 100 * sum / n : null, maxAre: n ? max : null };
  }

  /* One set of multipliers for all the samples. opts.stages as in
     tuning.js regress(). */
  function regressPooled(base, samples, opts) {
    var stages = opts && opts.stages;
    var run = function (st) { return !stages || stages.indexOf(st) >= 0; };
    var items = opts && opts.items || prep(base, samples);
    var t = {}, notes = [], fitted = {};
    Model.TUNING_KEYS.forEach(function (k) { t[k] = 1; });
    var B = Tune.BOUNDS, L = Tune.LABELS;

    /* One sample: the single-report regression, which honours a measured Pb
       and dead-oil viscosity exactly. */
    if (items.length === 1) return single(items[0], samples[0], opts);

    var before = items.map(function (it) { return Tune.compare(it.base, it.data, it.data.pb || it.base.pb); });
    var splits = items.map(function () { return null; });

    function sum(keys, trial) {
      var tt = {}, k;
      for (k in t) tt[k] = t[k];
      for (k in trial) tt[k] = trial[k];
      var total = 0;
      items.forEach(function (it, i) {
        var m = lite(it.input, tt);
        keys.forEach(function (key) {
          var c = Tune.compare(m, it.data, splits[i] || undefined, key)[key];
          total += c.sae;
        });
      });
      return total;
    }
    function count(keys) {
      var n = 0;
      items.forEach(function (it, i) {
        var m = lite(it.input, t);
        keys.forEach(function (key) { n += Tune.compare(m, it.data, splits[i] || undefined, key)[key].n; });
      });
      return n;
    }
    function fit(param, keys) {
      var n = count(keys);
      if (!n) return;
      var r = Tune.minimize1D(function (m) { var tr = {}; tr[param] = m; return sum(keys, tr); }, B[param][0], B[param][1]);
      t[param] = r.value;
      fitted[param] = n;
      var b = B[param];
      if (Math.log(r.value / b[0]) < 0.01 || Math.log(b[1] / r.value) < 0.01) {
        notes.push(L[param] + ' stopped at its search limit (' + r.value.toFixed(3) + ') - the correlation may not suit this field, or a sample is inconsistent with the others.');
      }
    }

    /* 1. Pb and Rs(p): measured Pbs and Rs points together */
    if (run('pb')) fit('pbMult', ['pb', 'rs']);
    splits = items.map(function (it) { return it.data.pb || lite(it.input, t).pb; });
    if (run('bo')) fit('boMult', ['boSat']);
    if (run('co')) fit('coMult', ['boUns']);
    if (run('muo')) {
      if (count(['muod'])) { fit('muodMult', ['muod']); fit('muobMult', ['muoSat']); }
      else fit('muodMult', ['muoSat']);
    }
    if (run('muou') && (items[0] && (items[0].input.corr || {}).muou) !== 'none') fit('muouMult', ['muoUns']);
    if (run('z')) {
      var nz = count(['z']);
      if (nz >= 2) {
        for (var sw = 0; sw < 4; sw++) {
          ['tpcMult', 'ppcMult'].forEach(function (k) {
            t[k] = Tune.minimize1D(function (m) { var tr = {}; tr[k] = m; return sum(['z'], tr); }, B[k][0], B[k][1]).value;
          });
        }
        fitted.tpcMult = fitted.ppcMult = nz;
      } else if (nz === 1) fit('ppcMult', ['z']);
    }
    if (run('mug')) fit('mugMult', ['mug']);

    var after = items.map(function (it, i) {
      return Tune.compare(lite(it.input, t), it.data, splits[i] || undefined);
    });
    var props = Tune.PROPS.oil.map(function (pr) {
      var b = pooled(before, pr.key), a = pooled(after, pr.key);
      return { key: pr.key, label: pr.label, kind: pr.kind, n: a.n, samples: a.samples,
               before: b.aare, after: a.aare, maxAfter: a.maxAre };
    });
    var params = Model.TUNING_KEYS.filter(function (k) { return fitted[k]; }).map(function (k) {
      var b = B[k];
      return { key: k, label: L[k], value: t[k], points: fitted[k],
               atBound: Math.log(t[k] / b[0]) < 0.01 || Math.log(b[1] / t[k]) < 0.01 };
    });
    if (!params.length) notes.push('No property has enough laboratory data to regress.');
    var perSample = items.map(function (it, i) {
      var row = { id: it.id, name: it.name, props: {} };
      Tune.PROPS.oil.forEach(function (pr) {
        row.props[pr.key] = { n: after[i][pr.key].n, before: before[i][pr.key].aare, after: after[i][pr.key].aare };
      });
      return row;
    });
    return { tuning: t, params: params, props: props, perSample: perSample, notes: notes,
             splits: splits, items: items };
  }

  function single(it, sample, opts) {
    var r = Tune.regress(it.input, sample.lab, opts && opts.stages ? { stages: opts.stages } : undefined);
    var props = Tune.PROPS.oil.map(function (pr) {
      var a = r.after[pr.key], b = r.before[pr.key];
      return { key: pr.key, label: pr.label, kind: pr.kind, n: a.n, samples: a.n ? 1 : 0,
               before: b.aare, after: a.aare, maxAfter: a.maxAre };
    });
    var row = { id: it.id, name: it.name, props: {} };
    Tune.PROPS.oil.forEach(function (pr) {
      row.props[pr.key] = { n: r.after[pr.key].n, before: r.before[pr.key].aare, after: r.after[pr.key].aare };
    });
    return { tuning: r.tuning, params: r.params, props: props, perSample: [row], notes: r.notes,
             splits: [r.pbSplit], items: [it] };
  }

  /* Rank one correlation family on the pooled data: every candidate is
     swapped in, regressed on its stages, and scored on its property. */
  function rankFamilyPooled(base, samples, fam) {
    var probeItems = prep(base, samples);
    var probe = pooled(probeItems.map(function (it) {
      return Tune.compare(it.base, it.data, it.data.pb || it.base.pb);
    }), fam.prop);
    var probeAlt = fam.alt ? pooled(probeItems.map(function (it) {
      return Tune.compare(it.base, it.data, it.data.pb || it.base.pb);
    }), fam.alt) : { n: 0 };
    if (!probe.n && !probeAlt.n) return null;
    var rows = fam.list.map(function (name) {
      var b = JSON.parse(JSON.stringify(base));
      b.corr = b.corr || {};
      b.corr[fam.corr] = name;
      try {
        var r = regressPooled(b, samples, { stages: fam.stages });
        var pr = function (key) { return r.props.filter(function (x) { return x.key === key; })[0]; };
        var a = pr(fam.prop), c = fam.alt ? pr(fam.alt) : null;
        var n = (a.n || 0) + (c ? c.n || 0 : 0);
        var w = function (field) {
          var s = 0;
          if (a.n) s += a[field] * a.n;
          if (c && c.n) s += c[field] * c.n;
          return n ? s / n : null;
        };
        var mult = { pb: 'pbMult', bo: 'boMult', co: 'coMult', muod: 'muodMult', muob: 'muobMult',
                     muou: 'muouMult', z: 'ppcMult', pcrit: 'ppcMult', mug: 'mugMult' }[fam.corr];
        return { corr: name, n: n, aareRaw: w('before'), aareTuned: w('after'), mult: r.tuning[mult], tuning: r.tuning };
      } catch (e) {
        return { corr: name, n: 0, aareRaw: null, aareTuned: null, mult: null, error: e.message };
      }
    });
    var ranked = rows.filter(function (r) { return r.aareTuned !== null; }).sort(function (a, b) {
      var d = a.aareTuned - b.aareTuned;
      if (Math.abs(d) > 0.1) return d;
      return Math.abs(Math.log(a.mult || 1)) - Math.abs(Math.log(b.mult || 1));
    });
    return { corr: fam.corr, label: fam.label, prop: fam.prop, rows: rows,
             best: ranked.length ? ranked[0].corr : null, selected: (base.corr || {})[fam.corr] };
  }

  return {
    CHECKS: CHECKS, sampleInput: sampleInput, qcSample: qcSample, screenSamples: screenSamples,
    regressPooled: regressPooled, rankFamilyPooled: rankFamilyPooled, prep: prep
  };
});
