/*
 * tuning.js -- regression of the PVT correlations against laboratory data.
 *
 * Laboratory data (field units throughout):
 *   lab = {
 *     pb:   measured bubble-point pressure, psia        (oil, optional)
 *     muod: measured dead-oil viscosity at Tres, cp     (oil, optional)
 *     rows: [{ p, rs, bo, muo, z, mug }]                any cell may be null
 *   }
 * Rs and Bo should be separator-adjusted (flash-corrected) values - the
 * basis a black-oil simulator uses - not raw differential-liberation data.
 * z and mug are the liberated gas in oil mode and the reservoir gas in gas
 * mode.
 *
 * Method: one multiplier per property (see pvt-model.js), regressed in the
 * order the properties depend on each other, each against the laboratory
 * points of its own property:
 *
 *   1. pbMult    - Rs(p), or set exactly from a measured Pb
 *   2. boMult    - saturated Bo            (needs Rs(p))
 *   3. coMult    - undersaturated Bo       (needs Bob)
 *   4. muodMult  - dead-oil viscosity: exact from a measured value,
 *                  otherwise fitted to the saturated viscosities
 *      muobMult  - saturated viscosity, when a measured muod fixes muodMult
 *   5. muouMult  - undersaturated viscosity (needs muob)
 *   6. tpcMult, ppcMult - z-factor (coordinate descent, both together)
 *   7. mugMult   - gas viscosity           (needs z through the density)
 *
 * Each 1-D fit minimises the average absolute relative error (AARE, the
 * figure PVT reports quote - and less swayed by one bad point than least
 * squares) with a coarse log-spaced scan followed by a golden-section
 * refinement, so a non-convex objective cannot trap it in a poor local
 * minimum. The untuned correlation (multiplier 1) is always a candidate, so
 * tuning never makes the fit worse. A multiplier that ends
 * at a search bound is reported: the correlation is probably unsuitable for
 * this fluid, or a data point is wrong.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./pvt-model.js'));
  } else {
    root.PVTTuning = factory(root.PVTModel);
  }
})(typeof self !== 'undefined' ? self : this, function (Model) {
  'use strict';

  /* Search bounds per multiplier. */
  var BOUNDS = {
    pbMult: [0.5, 2], boMult: [0.5, 2], coMult: [0.2, 5],
    muodMult: [0.2, 5], muobMult: [0.3, 3], muouMult: [0.05, 10],
    tpcMult: [0.85, 1.15], ppcMult: [0.85, 1.15], mugMult: [0.5, 2]
  };

  var LABELS = {
    pbMult: 'Pb / Rs(p) pressure stretch', boMult: 'Bo expansion multiplier',
    coMult: 'Oil compressibility multiplier', muodMult: 'Dead-oil viscosity multiplier',
    muobMult: 'Saturated viscosity multiplier', muouMult: 'Undersaturated viscosity multiplier',
    tpcMult: 'Pseudo-critical T multiplier', ppcMult: 'Pseudo-critical p multiplier',
    mugMult: 'Gas viscosity multiplier'
  };

  /* Properties compared against the laboratory, in display order. */
  var PROPS = {
    oil: [
      { key: 'pb', label: 'Bubble-point pressure', kind: 'p' },
      { key: 'rs', label: 'Solution GOR', kind: 'rs', col: 'rs' },
      { key: 'boSat', label: 'Bo, saturated', kind: 'bo', col: 'bo', branch: 'sat' },
      { key: 'boUns', label: 'Bo, undersaturated', kind: 'bo', col: 'bo', branch: 'uns' },
      { key: 'muod', label: 'Dead-oil viscosity', kind: 'mu' },
      { key: 'muoSat', label: 'Oil viscosity, saturated', kind: 'mu', col: 'muo', branch: 'sat' },
      { key: 'muoUns', label: 'Oil viscosity, undersaturated', kind: 'mu', col: 'muo', branch: 'uns' },
      { key: 'z', label: 'Gas z-factor', kind: null, col: 'z' },
      { key: 'mug', label: 'Gas viscosity', kind: 'mu', col: 'mug' }
    ],
    gas: [
      { key: 'z', label: 'Gas z-factor', kind: null, col: 'z' },
      { key: 'mug', label: 'Gas viscosity', kind: 'mu', col: 'mug' }
    ]
  };

  /* Correlation families the screening ranks, and the property each drives. */
  var FAMILIES = {
    oil: [
      { corr: 'pb', label: 'Bubble point / Rs', prop: 'rs', alt: 'pb', stages: ['pb'],
        list: ['standing', 'vasquezBeggs', 'glaso', 'alMarhoun', 'petroskyFarshad', 'lasater'] },
      { corr: 'bo', label: 'Oil FVF (saturated)', prop: 'boSat', stages: ['pb', 'bo'],
        list: ['standing', 'vasquezBeggs', 'glaso', 'alMarhoun', 'petroskyFarshad'] },
      { corr: 'co', label: 'Undersaturated compressibility', prop: 'boUns', stages: ['pb', 'bo', 'co'],
        list: ['vasquezBeggs', 'petroskyFarshad', 'mccain'] },
      { corr: 'muod', label: 'Dead-oil viscosity', prop: 'muoSat', alt: 'muod', stages: ['pb', 'muo'],
        list: ['beggsRobinson', 'beal', 'glaso', 'ngEgbogah'] },
      { corr: 'muob', label: 'Saturated oil viscosity', prop: 'muoSat', stages: ['pb', 'muo'],
        list: ['beggsRobinson', 'chewConnally'] },
      { corr: 'muou', label: 'Undersaturated oil viscosity', prop: 'muoUns', stages: ['pb', 'muo', 'muou'],
        list: ['vasquezBeggs', 'petroskyFarshad', 'none'] },
      { corr: 'z', label: 'z-factor', prop: 'z', stages: ['z'], list: ['dak', 'hallYarborough', 'beggsBrill'] },
      { corr: 'pcrit', label: 'Pseudo-critical properties', prop: 'z', stages: ['z'], list: ['sutton', 'standing'] },
      { corr: 'mug', label: 'Gas viscosity', prop: 'mug', stages: ['z', 'mug'], list: ['leeGonzalezEakin', 'carrKobayashiBurrows'] }
    ]
  };
  FAMILIES.gas = FAMILIES.oil.filter(function (f) { return ['z', 'pcrit', 'mug'].indexOf(f.corr) >= 0; });

  /* ---------------------------------------------------------------- data */

  function pos(v) { return typeof v === 'number' && isFinite(v) && v > 0 ? v : null; }
  function nonNeg(v) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null; }

  /* Keep only rows with a positive pressure and at least one value; sort by
     pressure. Rs may legitimately be zero (dead oil at atmospheric). */
  function normalize(lab, fluid) {
    lab = lab || {};
    var rows = (lab.rows || []).map(function (r) {
      return { p: pos(r.p), rs: fluid === 'gas' ? null : nonNeg(r.rs),
               bo: fluid === 'gas' ? null : pos(r.bo), muo: fluid === 'gas' ? null : pos(r.muo),
               z: pos(r.z), mug: pos(r.mug) };
    }).filter(function (r) {
      return r.p !== null && (r.rs !== null || r.bo !== null || r.muo !== null ||
                              r.z !== null || r.mug !== null);
    }).sort(function (a, b) { return a.p - b.p; });
    return {
      pb: fluid === 'gas' ? null : pos(lab.pb),
      muod: fluid === 'gas' ? null : pos(lab.muod),
      rows: rows
    };
  }

  function hasData(lab, fluid) {
    var d = normalize(lab, fluid);
    return d.rows.length > 0 || d.pb !== null || d.muod !== null;
  }

  function withTuning(input, tuning) {
    var o = JSON.parse(JSON.stringify(input));
    o.tuning = tuning;
    return o;
  }

  function lite(input, tuning) {
    var o = withTuning(input, tuning);
    o.pointsOnly = true;
    return Model.build(o);
  }

  /* ------------------------------------------------------------ statistics */

  /* Relative residual with a floor on the denominator, so a zero Rs at
     atmospheric pressure neither divides by zero nor dominates the fit. */
  function relErr(calc, meas, floor) {
    return (calc - meas) / Math.max(Math.abs(meas), floor);
  }

  /* Compare a model with the laboratory. branchPb fixes which rows count as
     saturated; by default the model's own saturation pressure. */
  function compare(model, data, branchPb, only) {
    var fluid = model.fluid, out = {};
    var pbSplit = branchPb || model.pb || Infinity;
    var props = PROPS[fluid].filter(function (pr) { return !only || pr.key === only; });
    /* evaluate only the half of the model the requested properties need */
    var part = only ? (only === 'z' || only === 'mug' ? 'gas' : 'oil') : undefined;
    var evals = data.rows.map(function (r) { return model.at(r.p, part); });
    props.forEach(function (pr) {
      var pts = [];
      if (pr.key === 'pb') {
        if (data.pb !== null) pts.push({ p: data.pb, meas: data.pb, calc: model.pb });
      } else if (pr.key === 'muod') {
        if (data.muod !== null) pts.push({ p: 14.696, meas: data.muod, calc: model.muod });
      } else {
        data.rows.forEach(function (r, i) {
          if (r[pr.col] === null) return;
          if (pr.branch === 'sat' && r.p > pbSplit + 1e-6) return;
          if (pr.branch === 'uns' && r.p <= pbSplit + 1e-6) return;
          pts.push({ p: r.p, meas: r[pr.col], calc: evals[i][pr.col] });
        });
      }
      var scale = pts.reduce(function (a, q) { return Math.max(a, Math.abs(q.meas)); }, 0);
      var floor = Math.max(scale * 0.02, 1e-12);
      var sum = 0, max = 0;
      pts.forEach(function (q) {
        q.err = relErr(q.calc, q.meas, floor);
        sum += Math.abs(q.err);
        max = Math.max(max, Math.abs(q.err));
      });
      out[pr.key] = {
        key: pr.key, label: pr.label, kind: pr.kind, n: pts.length, points: pts,
        aare: pts.length ? 100 * sum / pts.length : null,
        maxAre: pts.length ? 100 * max : null, sae: sum
      };
    });
    return out;
  }

  /* ------------------------------------------------------------ optimisers */

  /* Minimise f(m) over m in [lo, hi] on a log scale: 17-point scan, then a
     golden-section search in the bracket around the best scan point. */
  function minimize1D(f, lo, hi) {
    var a = Math.log(lo), b = Math.log(hi), n = 12, best = 0, bestV = Infinity, i, v;
    var xs = [];
    for (i = 0; i <= n; i++) {
      xs.push(a + (b - a) * i / n);
      v = safe(f, Math.exp(xs[i]));
      if (v < bestV) { bestV = v; best = i; }
    }
    var L = xs[Math.max(best - 1, 0)], R = xs[Math.min(best + 1, n)];
    var g = (Math.sqrt(5) - 1) / 2;
    var c = R - g * (R - L), d = L + g * (R - L);
    var fc = safe(f, Math.exp(c)), fd = safe(f, Math.exp(d));
    for (i = 0; i < 40 && R - L > 2e-5; i++) {
      if (fc < fd) { R = d; d = c; fd = fc; c = R - g * (R - L); fc = safe(f, Math.exp(c)); }
      else { L = c; c = d; fc = fd; d = L + g * (R - L); fd = safe(f, Math.exp(d)); }
    }
    var m = Math.exp(0.5 * (L + R));
    var fm = safe(f, m);
    if (bestV < fm) { m = Math.exp(xs[best]); fm = bestV; }
    /* never worse than the published correlation */
    var f1 = lo <= 1 && hi >= 1 ? safe(f, 1) : Infinity;
    if (f1 <= fm * (1 + 1e-9)) { m = 1; fm = f1; }
    return { value: m, objective: fm };
  }

  /* A trial the model rejects (non-physical Pb, NaN) scores as infinitely bad. */
  function safe(f, m) {
    try { var v = f(m); return isFinite(v) ? v : Infinity; }
    catch (e) { return Infinity; }
  }

  function atBound(key, m) {
    var b = BOUNDS[key];
    return Math.log(m / b[0]) < 0.01 || Math.log(b[1] / m) < 0.01;
  }

  /* ------------------------------------------------------------ regression */

  /* opts.stages (optional) limits the regression to some stages - 'pb', 'bo',
     'co', 'muo', 'muou', 'z', 'mug' - which is all the screening needs. */
  function regress(input, lab, opts) {
    var fluid = input.fluid === 'gas' ? 'gas' : 'oil';
    var stages = opts && opts.stages;
    var run = function (st) { return !stages || stages.indexOf(st) >= 0; };
    var data = normalize(lab, fluid);
    var t = {};
    Model.TUNING_KEYS.forEach(function (k) { t[k] = 1; });
    var notes = [], fitted = {};
    var base = Model.build(withTuning(input, null));
    var before = compare(lite(input, null), data, data.pb || base.pb);

    /* objective of one property with trial multiplier(s) merged into t */
    function objective(propKey, trial, branchPb) {
      var tt = {}, k;
      for (k in t) tt[k] = t[k];
      for (k in trial) tt[k] = trial[k];
      var m = lite(input, tt);
      return compare(m, data, branchPb, propKey)[propKey].sae;
    }
    function fit(key, propKey, branchPb) {
      var n = compare(lite(input, t), data, branchPb, propKey)[propKey].n;
      if (!n) return;
      var r = minimize1D(function (m) {
        var trial = {}; trial[key] = m;
        return objective(propKey, trial, branchPb);
      }, BOUNDS[key][0], BOUNDS[key][1]);
      t[key] = r.value;
      fitted[key] = n;
      if (atBound(key, r.value)) {
        notes.push(LABELS[key] + ' stopped at its search limit (' + r.value.toFixed(3) +
          ') - the selected correlation may not suit this fluid, or a data point is wrong.');
      }
    }

    var pbSplit = null;
    if (fluid === 'oil' && run('pb')) {
      /* 1. saturation pressure / Rs(p) */
      if (input.spec === 'pb') {
        if (data.pb !== null && Math.abs(data.pb - base.pb) > 0.5) {
          notes.push('Pb is specified as an input (' + base.pb.toFixed(0) +
            ' psia), so the measured Pb and Rs points are compared but not regressed. ' +
            'Specify the fluid by Rsb to let the regression place Pb.');
        }
      } else if (data.pb !== null) {
        t.pbMult = data.pb / base.pbCalc;
        fitted.pbMult = 1;
        if (atBound('pbMult', t.pbMult) || t.pbMult < BOUNDS.pbMult[0] || t.pbMult > BOUNDS.pbMult[1]) {
          notes.push('The measured Pb is ' + (100 * (t.pbMult - 1)).toFixed(0) +
            ' % away from the correlation - check Rsb and the gas gravity before trusting the tables.');
        }
      } else {
        fit('pbMult', 'rs', undefined);
      }
    }
    if (fluid === 'oil') {
      pbSplit = data.pb || lite(input, t).pb;

      /* 2-3. oil FVF */
      if (run('bo')) fit('boMult', 'boSat', pbSplit);
      if (run('co')) fit('coMult', 'boUns', pbSplit);

      /* 4. dead and saturated viscosity */
      if (!run('muo')) {
        /* skipped */
      } else if (data.muod !== null) {
        var raw = lite(input, { muodMult: 1 }).muod;
        t.muodMult = data.muod / raw;
        fitted.muodMult = 1;
        fit('muobMult', 'muoSat', pbSplit);
      } else {
        fit('muodMult', 'muoSat', pbSplit);
      }

      /* 5. undersaturated viscosity */
      if (run('muou') && (input.corr || {}).muou !== 'none') fit('muouMult', 'muoUns', pbSplit);
    }

    /* 6. z-factor: coordinate descent on the two pseudo-critical multipliers */
    var nz = run('z') ? compare(lite(input, t), data, pbSplit, 'z').z.n : 0;
    if (nz >= 2) {
      for (var sweep = 0; sweep < 4; sweep++) {
        ['tpcMult', 'ppcMult'].forEach(function (k) {
          var r = minimize1D(function (m) {
            var trial = {}; trial[k] = m;
            return objective('z', trial, pbSplit);
          }, BOUNDS[k][0], BOUNDS[k][1]);
          t[k] = r.value;
        });
      }
      fitted.tpcMult = fitted.ppcMult = nz;
      ['tpcMult', 'ppcMult'].forEach(function (k) {
        if (atBound(k, t[k])) notes.push(LABELS[k] + ' stopped at its search limit (' + t[k].toFixed(3) + ').');
      });
    } else if (nz === 1) {
      /* one point cannot separate Tpc from Ppc - move Ppc only */
      fit('ppcMult', 'z', pbSplit);
    }

    /* 7. gas viscosity */
    if (run('mug')) fit('mugMult', 'mug', pbSplit);

    var tunedModel = lite(input, t);
    var after = compare(tunedModel, data, pbSplit || undefined);
    var params = Model.TUNING_KEYS.filter(function (k) { return fitted[k]; }).map(function (k) {
      return { key: k, label: LABELS[k], value: t[k], points: fitted[k], atBound: atBound(k, t[k]) };
    });
    if (!params.length) notes.push('No property has enough laboratory data to regress.');

    return {
      tuning: t, params: params, before: before, after: after, notes: notes,
      pbSplit: pbSplit, data: data
    };
  }

  /* ------------------------------------------------------------ screening */

  /* For every correlation family, swap in each candidate (everything else
     as selected), regress, and report the untuned and tuned fit of the
     property it drives. Families without data are left out. */
  function screen(input, lab) {
    var fluid = input.fluid === 'gas' ? 'gas' : 'oil';
    return FAMILIES[fluid].map(function (fam) { return screenFamily(input, lab, fam); })
      .filter(function (x) { return x; });
  }

  /* One family of the screening; null when it has no data. The page calls
     this family by family so the browser stays responsive. */
  function screenFamily(input, lab, fam) {
    var fluid = input.fluid === 'gas' ? 'gas' : 'oil';
    var data = normalize(lab, fluid);
    var probe = compare(lite(input, null), data, data.pb || undefined);
    var n = probe[fam.prop].n + (fam.alt && probe[fam.alt] ? probe[fam.alt].n : 0);
    if (!n) return null;
    var rows = fam.list.map(function (name) {
      var inp = JSON.parse(JSON.stringify(input));
        inp.corr = inp.corr || {};
        inp.corr[fam.corr] = name;
        try {
          var r = regress(inp, lab, { stages: fam.stages });
          var raw = pick(r.before, fam), tuned = pick(r.after, fam);
          var mult = paramFor(fam.corr, r.tuning);
          /* count the points on the tuned saturated/undersaturated split */
          var nt = r.after[fam.prop].n + (fam.alt && r.after[fam.alt] ? r.after[fam.alt].n : 0);
          return { corr: name, n: nt, aareRaw: raw, aareTuned: tuned, mult: mult, tuning: r.tuning };
        } catch (e) {
          return { corr: name, n: n, aareRaw: null, aareTuned: null, mult: null, error: e.message };
        }
      });
    /* rank by the tuned fit; within 0.1 % call it a tie and prefer the
       correlation that needed the smaller adjustment */
    var ranked = rows.filter(function (r) { return r.aareTuned !== null; })
      .sort(function (a, b) {
        var d = a.aareTuned - b.aareTuned;
        if (Math.abs(d) > 0.1) return d;
        return Math.abs(Math.log(a.mult || 1)) - Math.abs(Math.log(b.mult || 1));
      });
    return {
      corr: fam.corr, label: fam.label, prop: fam.prop, rows: rows,
      best: ranked.length ? ranked[0].corr : null, selected: (input.corr || {})[fam.corr]
    };
  }

  /* point-weighted AARE over a family's property (and its alternate) */
  function pick(stats, fam) {
    var a = stats[fam.prop], b = fam.alt ? stats[fam.alt] : null;
    var n = (a ? a.n : 0) + (b ? b.n : 0);
    if (!n) return null;
    return ((a && a.n ? a.aare * a.n : 0) + (b && b.n ? b.aare * b.n : 0)) / n;
  }

  function paramFor(corr, t) {
    switch (corr) {
      case 'pb': return t.pbMult;
      case 'bo': return t.boMult;
      case 'co': return t.coMult;
      case 'muod': return t.muodMult;
      case 'muob': return t.muobMult;
      case 'muou': return t.muouMult;
      case 'z': case 'pcrit': return t.ppcMult;
      case 'mug': return t.mugMult;
      default: return null;
    }
  }

  /* ------------------------------------------------------------ text I/O */

  /* Parse tab-, comma- or semicolon-separated text pasted from a spreadsheet.
     Header or unit rows (no numbers) are skipped; empty cells stay null. */
  function parseTable(text, cols) {
    var rows = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var cells = line.split(/\t|;|,(?=\s*[-+.\d]|\s*$)/);
      var nums = cells.map(function (c) {
        var v = parseFloat(String(c).trim().replace(/\s/g, ''));
        return isFinite(v) ? v : null;
      });
      if (nums[0] === null) return;
      var row = {};
      cols.forEach(function (k, i) { row[k] = i < nums.length ? nums[i] : null; });
      rows.push(row);
    });
    return rows;
  }

  return {
    normalize: normalize, hasData: hasData, compare: compare, regress: regress,
    screen: screen, screenFamily: screenFamily, parseTable: parseTable, minimize1D: minimize1D,
    PROPS: PROPS, FAMILIES: FAMILIES, LABELS: LABELS, BOUNDS: BOUNDS
  };
});
