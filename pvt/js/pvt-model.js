/*
 * pvt-model.js -- assembles a complete black-oil PVT model (field units)
 * from a set of reservoir inputs and a choice of correlations.
 *
 * Output shape:
 *   {
 *     input, pb, rsb, bob, muob, rhoOsc, rhoGsc, rhoWsc, pcrit,
 *     oil:   [{p, rs, bo, muo, rhoO, co, saturated}],
 *     gas:   [{p, z, bg, bgRbMscf, eg, mug, rhoG, cg}],
 *     water: [{p, bw, muw, cw, rhoW}],
 *     pvto:  [{rs, pb, rows:[{p, bo, muo}]}],
 *     warnings: []
 *   }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./correlations.js'));
  } else {
    root.PVTModel = factory(root.PVTCorr);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var DEFAULTS = {
    api: 35, gammaG: 0.75, rsb: 600, pbMeas: null, spec: 'rsb',
    tempF: 180, tSepF: 80, pSepPsia: 114.7,
    pMax: 5000, pMin: 14.7, nSat: 15, nUnsat: 6,
    salinity: 3.0, pRefRock: 4000, rockComp: 4e-6,
    gasType: 'dry', yCO2: 0, yH2S: 0, yN2: 0,
    corr: {
      pb: 'standing', bo: 'standing', co: 'vasquezBeggs',
      muod: 'beggsRobinson', muob: 'beggsRobinson', muou: 'vasquezBeggs',
      pcrit: 'sutton', inertCorr: 'wichertAziz', z: 'dak', mug: 'leeGonzalezEakin'
    },
    calib: { pbMeas: null, bobMeas: null, muodMeas: null }
  };

  function merge(base, over) {
    var out = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in over || {}) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) {
        out[k] = merge(base[k] || {}, over[k]);
      } else if (over[k] !== undefined && over[k] !== null && over[k] !== '') {
        out[k] = over[k];
      }
    }
    return out;
  }

  /* Solve for the Rsb that reproduces a measured bubble-point pressure. */
  function rsbFromPb(corrName, pbTarget, s) {
    var f = C.PB[corrName], lo = 0, hi = 50, mid;
    while (f(hi, s) < pbTarget && hi < 1e5) hi *= 2;
    for (var i = 0; i < 100; i++) {
      mid = 0.5 * (lo + hi);
      if (f(mid, s) < pbTarget) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  function pressureGrid(pMin, pMax, pb, nSat, nUnsat) {
    var grid = [], i;
    pb = Math.min(Math.max(pb, pMin), pMax);
    for (i = 0; i <= nSat; i++) grid.push(pMin + (pb - pMin) * i / nSat);
    if (pMax > pb + 1e-6) {
      for (i = 1; i <= nUnsat; i++) grid.push(pb + (pMax - pb) * i / nUnsat);
    }
    /* de-duplicate and sort */
    grid.sort(function (a, b) { return a - b; });
    var out = [grid[0]];
    for (i = 1; i < grid.length; i++) if (grid[i] - out[out.length - 1] > 1e-6) out.push(grid[i]);
    return out;
  }

  function rangeWarnings(inp, pb) {
    var w = [], used = {}, k, c = inp.corr;
    used[c.pb] = 'bubble point / Rs';
    used[c.bo] = used[c.bo] ? used[c.bo] + ', Bo' : 'Bo';
    used[c.muod] = used[c.muod] ? used[c.muod] + ', dead-oil viscosity' : 'dead-oil viscosity';
    if (C.RANGES[c.co]) used[c.co] = used[c.co] ? used[c.co] + ', co' : 'co';
    var probe = { api: inp.api, tempF: inp.tempF, rsb: inp.rsb, pb: pb, gammaG: inp.gammaG };
    var label = { api: 'API gravity', tempF: 'temperature (degF)', rsb: 'Rsb (scf/STB)',
                  pb: 'bubble point (psia)', gammaG: 'gas gravity' };
    for (k in used) {
      var r = C.RANGES[k];
      if (!r) continue;
      for (var p in r) {
        var v = probe[p];
        if (v === undefined || v === null) continue;
        if (v < r[p][0] || v > r[p][1]) {
          w.push(k + ' (' + used[k] + '): ' + label[p] + ' = ' +
            (Math.round(v * 100) / 100) + ' is outside the published range ' +
            r[p][0] + ' - ' + r[p][1] + '.');
        }
      }
    }
    if (inp.yCO2 + inp.yH2S + inp.yN2 > 0.2) {
      w.push('Non-hydrocarbon content exceeds 20 mol% - z-factor correlations lose accuracy; use a laboratory or EOS-based table.');
    }
    if (inp.api > 45) {
      w.push('API > 45 - the fluid may be a volatile oil. Black-oil tables without vaporised-oil (Rv) data can under-predict recovery.');
    }
    return w;
  }

  /* Consistency checks a simulator will run on the table anyway. Catching
     them here saves a failed deck initialisation. */
  function tableChecks(m) {
    var w = [], i, eps = 1e-9;
    var sat = m.oil.filter(function (r) { return r.saturated; });
    for (i = 1; i < sat.length; i++) {
      if (sat[i].rs < sat[i - 1].rs - eps) { w.push('Saturated Rs is not monotonically increasing with pressure.'); break; }
    }
    for (i = 1; i < sat.length; i++) {
      if (sat[i].bo < sat[i - 1].bo - eps) { w.push('Saturated Bo is not monotonically increasing with pressure - the simulator will reject PVTO.'); break; }
    }
    for (i = 1; i < sat.length; i++) {
      if (sat[i].muo > sat[i - 1].muo + eps) { w.push('Saturated oil viscosity is not monotonically decreasing with pressure.'); break; }
    }
    var uns = m.oil.filter(function (r) { return !r.saturated; });
    for (i = 1; i < uns.length; i++) {
      if (uns[i].bo > uns[i - 1].bo + eps) { w.push('Undersaturated Bo is not monotonically decreasing with pressure.'); break; }
    }
    for (i = 1; i < m.gas.length; i++) {
      if (m.gas[i].bg > m.gas[i - 1].bg + eps) { w.push('Bg is not monotonically decreasing with pressure - check the z-factor correlation.'); break; }
    }
    m.gas.forEach(function (g) {
      if (g.z < 0.2 || g.z > 2.0) w.push('z-factor of ' + g.z.toFixed(3) + ' at ' + g.p.toFixed(0) + ' psia is outside a physical range.');
    });
    /* PVTO branches must not cross: at a common pressure, a higher Rs must
       give a higher Bo. */
    for (i = 1; i < m.pvto.length; i++) {
      var a = m.pvto[i - 1], b = m.pvto[i];
      var pTest = b.rows[b.rows.length - 1].p;
      var boA = a.rows[a.rows.length - 1].bo, boB = b.rows[b.rows.length - 1].bo;
      if (pTest > 0 && boB < boA - eps) {
        w.push('PVTO undersaturated branches cross between Rs = ' + a.rs.toFixed(1) +
          ' and ' + b.rs.toFixed(1) + ' scf/STB.');
        break;
      }
    }
    /* Extrapolating a ratio-type undersaturated viscosity correlation from a
       near-zero bubble point is the classic way to get an absurd branch. */
    var first = m.pvto[0];
    if (first && first.rows.length > 1) {
      var ratio = first.rows[first.rows.length - 1].muo / first.rows[0].muo;
      if (ratio > 3) {
        w.push('The lowest-Rs PVTO branch raises oil viscosity by a factor of ' +
          ratio.toFixed(1) + ' over the pressure range. Ratio-form undersaturated ' +
          'correlations (Vasquez-Beggs) over-extrapolate from a near-atmospheric ' +
          'saturation pressure - consider Petrosky-Farshad, or raise the minimum table pressure.');
      }
    }
    return w;
  }

  function build(userInput) {
    var inp = merge(DEFAULTS, userInput);
    var c = inp.corr;
    var s = {
      api: inp.api, gammaG: inp.gammaG, tempF: inp.tempF,
      tSepF: inp.tSepF, pSepPsia: inp.pSepPsia, rsb: inp.rsb, pb: 0
    };

    /* --- bubble point / Rsb ------------------------------------------- */
    var pbCalc, pbFactor = 1;
    if (inp.spec === 'pb' && inp.pbMeas > 0) {
      s.rsb = rsbFromPb(c.pb, inp.pbMeas, s);
      inp.rsb = s.rsb;
      pbCalc = inp.pbMeas;
    } else {
      pbCalc = C.PB[c.pb](s.rsb, s);
    }
    var pb = pbCalc;
    /* Calibration to a measured bubble point: the saturated Rs curve is
       stretched in pressure so that Rs(pb_meas) = Rsb exactly. */
    if (inp.calib && inp.calib.pbMeas > 0 && inp.spec !== 'pb') {
      pbFactor = inp.calib.pbMeas / pbCalc;
      pb = inp.calib.pbMeas;
    }
    s.pb = pb;
    s.rsb = inp.rsb;

    if (!(pb > 0) || !isFinite(pb)) {
      var lim = C.RANGES[c.pb] && C.RANGES[c.pb].pb;
      throw new Error('The ' + c.pb + ' correlation returns a non-physical bubble point (' +
        (isFinite(pb) ? pb.toFixed(0) + ' psia' : 'not a number') + ') for these inputs' +
        (lim ? ', which sit well below its published range of ' + lim[0] + ' - ' + lim[1] + ' psia' : '') +
        '. Choose a different Pb correlation.');
    }
    var pMax = Math.max(inp.pMax, pb * 1.0001);

    /* --- Bo calibration factor ---------------------------------------- */
    var rsAt = function (p) {
      if (p >= pb) return s.rsb;
      var pEq = p / pbFactor;           /* equivalent pressure on the raw curve */
      var sRaw = merge(s, { pb: pbCalc });
      return C.solutionGor(c.pb, pEq, sRaw);
    };
    var bobRaw = C.BO[c.bo](s.rsb, s);
    var boFactor = 1;
    if (inp.calib && inp.calib.bobMeas > 0 && bobRaw > 1.0001) {
      boFactor = (inp.calib.bobMeas - 1) / (bobRaw - 1);
    }
    var boSat = function (rs) { return 1 + boFactor * (C.BO[c.bo](rs, s) - 1); };

    /* --- dead / saturated oil viscosity -------------------------------- */
    var muOd = inp.calib && inp.calib.muodMeas > 0 ? inp.calib.muodMeas : C.MU_OD[c.muod](s);
    var muSat = function (rs) { return C.MU_OB[c.muob](muOd, rs); };

    /* --- compressibility and the undersaturated branch ------------------ */
    var coAt = function (p) { return C.CO[c.co](p, s); };
    var bob = boSat(s.rsb), muob = muSat(s.rsb);

    /* Bo(p>pb) = Bob * exp(-Int(co dp)) integrated with the trapezoid rule. */
    function undersaturated(pTarget, pbLocal, bobLocal, muobLocal, sLocal) {
      var n = 24, integral = 0, i, p0, p1;
      for (i = 0; i < n; i++) {
        p0 = pbLocal + (pTarget - pbLocal) * i / n;
        p1 = pbLocal + (pTarget - pbLocal) * (i + 1) / n;
        integral += 0.5 * (C.CO[c.co](Math.max(p0, 1), sLocal) +
                           C.CO[c.co](Math.max(p1, 1), sLocal)) * (p1 - p0);
      }
      return {
        bo: bobLocal * Math.exp(-integral),
        muo: c.muou === 'none' ? muobLocal : C.MU_OU[c.muou](muobLocal, pTarget, pbLocal),
        co: C.CO[c.co](pTarget, sLocal)
      };
    }

    /* --- property tables ------------------------------------------------ */
    var grid = pressureGrid(inp.pMin, pMax, pb, inp.nSat, inp.nUnsat);
    var pcrit = C.pseudoCriticals(inp.gammaG, {
      method: c.pcrit === 'standing' ? (inp.gasType === 'wet' ? 'standingWet' : 'standingDry') : 'sutton',
      correction: c.inertCorr === 'carr' ? 'carr' : 'wichertAziz',
      yCO2: inp.yCO2, yH2S: inp.yH2S, yN2: inp.yN2
    });
    var gasOpt = { _pc: pcrit, yCO2: inp.yCO2, yH2S: inp.yH2S, yN2: inp.yN2 };

    var oil = [], gas = [], water = [];
    grid.forEach(function (p) {
      /* oil */
      var row;
      if (p <= pb + 1e-9) {
        var rs = rsAt(p), bo = boSat(rs), mu = muSat(rs);
        row = { p: p, rs: rs, bo: bo, muo: mu, co: null, saturated: true };
      } else {
        var u = undersaturated(p, pb, bob, muob, s);
        row = { p: p, rs: s.rsb, bo: u.bo, muo: u.muo, co: u.co, saturated: false };
      }
      row.rhoO = C.oilDensity(row.rs, row.bo, inp.gammaG, inp.api);
      oil.push(row);

      /* gas */
      var z = C.gasZ(c.z, p, inp.tempF, inp.gammaG, gasOpt);
      var bg = C.gasBg(z, p, inp.tempF);                 /* ft3/scf */
      var rhoG = C.gasDensity(z, p, inp.tempF, inp.gammaG);
      var mug = c.mug === 'carrKobayashiBurrows'
        ? C.MU_G.carrKobayashiBurrows(p / pcrit.ppc, (inp.tempF + C.TZERO) / pcrit.tpc,
            inp.tempF, inp.gammaG, gasOpt)
        : C.MU_G.leeGonzalezEakin(rhoG, inp.tempF, inp.gammaG);
      gas.push({
        p: p, z: z, bg: bg, bgRbMscf: bg * 1000 / 5.614583, eg: 1 / bg,
        mug: mug, rhoG: rhoG,
        cg: C.gasCompressibility(c.z, p, inp.tempF, inp.gammaG, gasOpt)
      });

      /* water */
      var bw = C.waterBw(p, inp.tempF);
      water.push({
        p: p, bw: bw,
        muw: C.waterViscosity(p, inp.tempF, inp.salinity),
        cw: C.waterCompressibility(p, inp.tempF, inp.salinity),
        rhoW: C.waterDensitySC(inp.salinity) / bw
      });
    });

    /* --- PVTO records: saturated node + undersaturated extension -------- */
    var satNodes = grid.filter(function (p) { return p <= pb + 1e-9; });
    var pvto = satNodes.map(function (pNode) {
      var rs = rsAt(pNode);
      var sNode = merge(s, { rsb: rs, pb: pNode });
      var boNode = boSat(rs), muNode = muSat(rs);
      var rows = [{ p: pNode, bo: boNode, muo: muNode }];
      if (pMax > pNode + 1e-6) {
        for (var i = 1; i <= inp.nUnsat; i++) {
          var p = pNode + (pMax - pNode) * i / inp.nUnsat;
          var u = undersaturated(p, pNode, boNode, muNode, sNode);
          rows.push({ p: p, bo: u.bo, muo: u.muo });
        }
      }
      return { rs: rs, pb: pNode, rows: rows };
    });

    var out = {
      input: inp,
      pb: pb, pbCalc: pbCalc, pbFactor: pbFactor, boFactor: boFactor,
      rsb: s.rsb, bob: bob, muob: muob, muod: muOd,
      cob: coAt(pb),
      rhoOsc: 62.428 * C.apiToSg(inp.api),
      rhoGsc: C.RHO_AIR_SC * inp.gammaG,
      rhoWsc: C.waterDensitySC(inp.salinity),
      pcrit: pcrit,
      oil: oil, gas: gas, water: water, pvto: pvto,
      warnings: rangeWarnings(inp, pb)
    };
    out.warnings = out.warnings.concat(tableChecks(out));
    return out;
  }

  return { build: build, DEFAULTS: DEFAULTS, pressureGrid: pressureGrid, rsbFromPb: rsbFromPb };
});
