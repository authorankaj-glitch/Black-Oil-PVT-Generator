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
 *     tuning, warnings: []
 *   }
 *
 * Tuning (optional, input.tuning): multipliers regressed against laboratory
 * data by tuning.js. Every one defaults to 1, i.e. the published correlation.
 *   pbMult    stretch of the Rs(p) curve in pressure; Pb = Pb(corr) * pbMult
 *   boMult    scales the dissolved-gas expansion, Bo = 1 + boMult (Bo(corr) - 1)
 *   coMult    scales the undersaturated oil compressibility
 *   muodMult  scales the dead-oil viscosity
 *   muobMult  scales the saturated (live) oil viscosity
 *   muouMult  scales the rise of oil viscosity above the saturation pressure
 *   tpcMult, ppcMult  scale the gas pseudo-critical T and p (z, Bg, rho_g, cg)
 *   mugMult   scales the gas viscosity
 *
 * The model also carries a non-enumerable model.at(p) that evaluates every
 * property at an arbitrary pressure through exactly the code that fills the
 * tables - the regression compares laboratory points against it.
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
    /* salinity is weight % NaCl equivalent - the page converts its ppm input */
    salinity: 3.0, pRefRock: 4000, rockComp: 4e-6,
    gasType: 'dry', yCO2: 0, yH2S: 0, yN2: 0,
    /* gas-reservoir mode (fluid = 'gas') */
    fluid: 'oil', gasKind: 'dry', cgr: 0, apiC: 50,
    corr: {
      pb: 'standing', bo: 'standing', co: 'vasquezBeggs',
      muod: 'beggsRobinson', muob: 'beggsRobinson', muou: 'vasquezBeggs',
      pcrit: 'sutton', inertCorr: 'wichertAziz', z: 'dak', mug: 'leeGonzalezEakin'
    },
    calib: { pbMeas: null, bobMeas: null, muodMeas: null },
    tuning: null
  };

  var TUNING_KEYS = ['pbMult', 'boMult', 'coMult', 'muodMult', 'muobMult', 'muouMult',
                     'tpcMult', 'ppcMult', 'mugMult'];

  /* Tuning multipliers with every missing or invalid entry set to 1. */
  function tuningOf(inp) {
    var t = inp.tuning || {}, out = { active: false };
    TUNING_KEYS.forEach(function (k) {
      var v = t[k];
      out[k] = typeof v === 'number' && isFinite(v) && v > 0 ? v : 1;
      if (out[k] !== 1) out.active = true;
    });
    return out;
  }

  /* Pseudo-criticals of the gas, with the tuning multipliers applied. */
  function tunedPseudoCriticals(g, inp, method, T) {
    var pc = C.pseudoCriticals(g, {
      method: method,
      correction: inp.corr.inertCorr === 'carr' ? 'carr' : 'wichertAziz',
      yCO2: inp.yCO2, yH2S: inp.yH2S, yN2: inp.yN2
    });
    return { tpc: pc.tpc * T.tpcMult, ppc: pc.ppc * T.ppcMult, eps: pc.eps,
             tpcCorr: pc.tpc, ppcCorr: pc.ppc };
  }

  /* z, Bg, density, viscosity and cg of a gas at one pressure. */
  function gasPoint(p, inp, g, pcrit, T) {
    var c = inp.corr, opt = { _pc: pcrit, yCO2: inp.yCO2, yH2S: inp.yH2S, yN2: inp.yN2 };
    var z = C.gasZ(c.z, p, inp.tempF, g, opt);
    var rhoG = C.gasDensity(z, p, inp.tempF, g);
    var mug = c.mug === 'carrKobayashiBurrows'
      ? C.MU_G.carrKobayashiBurrows(p / pcrit.ppc, (inp.tempF + C.TZERO) / pcrit.tpc,
          inp.tempF, g, opt)
      : C.MU_G.leeGonzalezEakin(rhoG, inp.tempF, g);
    return {
      z: z, bg: C.gasBg(z, p, inp.tempF), rhoG: rhoG, mug: mug * T.mugMult,
      cg: C.gasCompressibility(c.z, p, inp.tempF, g, opt)
    };
  }

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
    var pb = pbCalc, T = tuningOf(inp);
    /* Calibration to a measured bubble point: the saturated Rs curve is
       stretched in pressure so that Rs(pb_meas) = Rsb exactly. A regressed
       pbMult does the same thing and takes precedence. With Pb specified as
       an input the curve is already anchored, so neither applies. */
    if (inp.spec !== 'pb') {
      if (T.pbMult !== 1) {
        pbFactor = T.pbMult;
        pb = pbCalc * pbFactor;
      } else if (inp.calib && inp.calib.pbMeas > 0) {
        pbFactor = inp.calib.pbMeas / pbCalc;
        pb = inp.calib.pbMeas;
      }
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
    if (T.boMult !== 1) {
      boFactor = T.boMult;
    } else if (inp.calib && inp.calib.bobMeas > 0 && bobRaw > 1.0001) {
      boFactor = (inp.calib.bobMeas - 1) / (bobRaw - 1);
    }
    var boSat = function (rs) { return 1 + boFactor * (C.BO[c.bo](rs, s) - 1); };

    /* --- dead / saturated oil viscosity -------------------------------- */
    var muOd = inp.calib && inp.calib.muodMeas > 0 && T.muodMult === 1
      ? inp.calib.muodMeas : C.MU_OD[c.muod](s) * T.muodMult;
    var muSat = function (rs) { return T.muobMult * C.MU_OB[c.muob](muOd, rs); };

    /* --- compressibility and the undersaturated branch ------------------ */
    var coOf = function (p, sLocal) { return T.coMult * C.CO[c.co](p, sLocal); };
    var coAt = function (p) { return coOf(p, s); };
    var bob = boSat(s.rsb), muob = muSat(s.rsb);

    /* Bo(p>pb) = Bob * exp(-Int(co dp)) integrated with the trapezoid rule. */
    function undersaturated(pTarget, pbLocal, bobLocal, muobLocal, sLocal) {
      var n = 24, integral = 0, i, p0, p1;
      for (i = 0; i < n; i++) {
        p0 = pbLocal + (pTarget - pbLocal) * i / n;
        p1 = pbLocal + (pTarget - pbLocal) * (i + 1) / n;
        integral += 0.5 * (coOf(Math.max(p0, 1), sLocal) +
                           coOf(Math.max(p1, 1), sLocal)) * (p1 - p0);
      }
      var muo = c.muou === 'none' ? muobLocal
        : muobLocal + T.muouMult * (C.MU_OU[c.muou](muobLocal, pTarget, pbLocal) - muobLocal);
      return { bo: bobLocal * Math.exp(-integral), muo: muo, co: coOf(pTarget, sLocal) };
    }

    var pcrit = tunedPseudoCriticals(inp.gammaG, inp,
      c.pcrit === 'standing' ? (inp.gasType === 'wet' ? 'standingWet' : 'standingDry') : 'sutton', T);

    /* Point evaluator: the same equations as the tables, at any pressure.
       part = 'oil' or 'gas' skips the other half (the regression's hot path). */
    function at(p, part) {
      var r = { p: p };
      if (part === 'gas') {
        /* oil columns not needed */
      } else if (p <= pb + 1e-9) {
        var rs = rsAt(p);
        r = { p: p, rs: rs, bo: boSat(rs), muo: muSat(rs), saturated: true };
      } else {
        var u = undersaturated(p, pb, bob, muob, s);
        r = { p: p, rs: s.rsb, bo: u.bo, muo: u.muo, saturated: false };
      }
      if (part === 'oil') return r;
      var gp = gasPoint(p, inp, inp.gammaG, pcrit, T);
      r.z = gp.z; r.bg = gp.bg; r.mug = gp.mug;
      return r;
    }

    var out = {
      fluid: 'oil', input: inp, psat: pb,
      pb: pb, pbCalc: pbCalc, pbFactor: pbFactor, boFactor: boFactor,
      rsb: s.rsb, bob: bob, muob: muob, muod: muOd,
      cob: coAt(pb),
      rhoOsc: 62.428 * C.apiToSg(inp.api),
      rhoGsc: C.RHO_AIR_SC * inp.gammaG,
      rhoWsc: C.waterDensitySC(inp.salinity),
      pcrit: pcrit, tuning: T.active ? T : null
    };
    Object.defineProperty(out, 'at', { value: at, enumerable: false });
    /* the regression only needs the point evaluator - skip the tables */
    if (inp.pointsOnly) return out;

    /* --- property tables ------------------------------------------------ */
    var grid = pressureGrid(inp.pMin, pMax, pb, inp.nSat, inp.nUnsat);

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

      /* gas (bg in ft3/scf) */
      var gp = gasPoint(p, inp, inp.gammaG, pcrit, T);
      gas.push({
        p: p, z: gp.z, bg: gp.bg, bgRbMscf: gp.bg * 1000 / 5.614583, eg: 1 / gp.bg,
        mug: gp.mug, rhoG: gp.rhoG, cg: gp.cg
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

    out.oil = oil; out.gas = gas; out.water = water; out.pvto = pvto;
    out.warnings = rangeWarnings(inp, pb);
    out.warnings = out.warnings.concat(tableChecks(out));
    return out;
  }

  /* ================================================================== *
   * Gas reservoirs: dry gas and wet gas
   *
   * Basis: one scf of SEPARATOR gas (the dry-gas basis ECLIPSE PVDG uses).
   * The reservoir gas is the separator gas recombined with the condensate it
   * yields at the surface (CGR, STB/MMscf):
   *   gamma_w = (R gamma_g + 4584 gamma_o) / (R + 132800 gamma_o / Mo)
   *   Bg(separator basis) = Bg(well stream) * (1 + Veq * CGR / 1e6)
   *
   * Both fluids stay single-phase everywhere in the reservoir: a dry gas
   * drops no liquid at all, a wet gas only at the separator. Retrograde
   * condensation is out of scope - a gas condensate needs a CCE/CVD study or
   * a compositional model, not black-oil correlations.
   * ================================================================== */

  function gasWarnings(inp, m) {
    var w = [];
    if (inp.yCO2 + inp.yH2S + inp.yN2 > 0.2) {
      w.push('Non-hydrocarbon content exceeds 20 mol% - z-factor correlations lose accuracy; use a laboratory or EOS-based table.');
    }
    if (m.gammaW > 1.2) {
      w.push('Reservoir-gas gravity ' + m.gammaW.toFixed(3) + ' is above 1.2 - the pseudo-critical correlations were fitted to lighter gases.');
    }
    if (inp.gasKind === 'wet') {
      if (inp.apiC < 40 || inp.apiC > 70) {
        w.push('Condensate gravity of ' + inp.apiC.toFixed(1) + ' API is unusual for a wet gas (typically 40 - 70 API).');
      }
      if (inp.cgr > 50) {
        w.push('A CGR of ' + inp.cgr.toFixed(0) + ' STB/MMscf usually means a gas condensate, which drops liquid in the reservoir below its dew point. This tool models the reservoir as single-phase gas - check that the reservoir temperature lies above the cricondentherm, or use a compositional model.');
      }
    }
    return w;
  }

  function buildGas(userInput) {
    var inp = merge(DEFAULTS, userInput);
    var c = inp.corr, kind = inp.gasKind === 'wet' ? 'wet' : 'dry', T = tuningOf(inp);
    var cgr = kind === 'dry' ? 0 : Math.max(inp.cgr || 0, 0);
    var apiC = inp.apiC;
    var grid = pressureGrid(inp.pMin, inp.pMax, inp.pMax, inp.nSat, 0);

    var gammaW = C.wellstreamGravity(inp.gammaG, cgr, apiC);
    var fws = C.wellstreamFactor(cgr, apiC);
    var pcrit = tunedPseudoCriticals(gammaW, inp,
      c.pcrit === 'standing' ? (kind === 'dry' ? 'standingDry' : 'standingWet') : 'sutton', T);

    /* Point evaluator (z of the reservoir gas, Bg on the separator basis). */
    function at(p) {
      var gp = gasPoint(p, inp, gammaW, pcrit, T);
      return { p: p, z: gp.z, bg: gp.bg * fws, mug: gp.mug };
    }
    if (inp.pointsOnly) {
      var lite = { fluid: 'gas', gasKind: kind, input: inp, gammaW: gammaW, pcrit: pcrit,
                   tuning: T.active ? T : null };
      Object.defineProperty(lite, 'at', { value: at, enumerable: false });
      return lite;
    }

    var gas = [], water = [];
    grid.forEach(function (p) {
      var gp = gasPoint(p, inp, gammaW, pcrit, T);
      var bgw = gp.bg;                                   /* well stream, ft3/scf */
      var bg = bgw * fws;                                /* separator-gas basis  */
      gas.push({
        p: p, rv: cgr, z: gp.z, bg: bg, bgw: bgw, bgRbMscf: bg * 1000 / 5.614583,
        eg: 1 / bg, mug: gp.mug, rhoG: gp.rhoG, cg: gp.cg
      });
      var bw = C.waterBw(p, inp.tempF);
      water.push({
        p: p, bw: bw,
        muw: C.waterViscosity(p, inp.tempF, inp.salinity),
        cw: C.waterCompressibility(p, inp.tempF, inp.salinity),
        rhoW: C.waterDensitySC(inp.salinity) / bw
      });
    });

    var out = {
      fluid: 'gas', gasKind: kind, input: inp,
      cgr: cgr, apiC: apiC, gammaW: gammaW, fws: fws,
      ogr: cgr > 0 ? 1e6 / cgr : null,
      rhoOsc: 62.428 * C.apiToSg(kind === 'dry' ? 50 : apiC),
      rhoGsc: C.RHO_AIR_SC * inp.gammaG,
      rhoWsc: C.waterDensitySC(inp.salinity),
      pcrit: pcrit, gas: gas, water: water,
      /* no saturation pressure exists in the reservoir for either fluid */
      psat: null, tuning: T.active ? T : null
    };
    Object.defineProperty(out, 'at', { value: at, enumerable: false });
    out.warnings = gasWarnings(inp, out).concat(gasTableChecks(out));
    return out;
  }

  function gasTableChecks(m) {
    var w = [], i, eps = 1e-9;
    for (i = 1; i < m.gas.length; i++) {
      if (m.gas[i].bg > m.gas[i - 1].bg + eps) { w.push('Bg is not monotonically decreasing with pressure - check the z-factor correlation.'); break; }
    }
    m.gas.forEach(function (g) {
      if (g.z < 0.2 || g.z > 2.0) w.push('z-factor of ' + g.z.toFixed(3) + ' at ' + g.p.toFixed(0) + ' psia is outside a physical range.');
    });
    return w;
  }

  function buildAny(userInput) {
    return userInput && userInput.fluid === 'gas' ? buildGas(userInput) : build(userInput);
  }

  return { build: buildAny, buildOil: build, buildGas: buildGas, DEFAULTS: DEFAULTS,
           pressureGrid: pressureGrid, rsbFromPb: rsbFromPb, TUNING_KEYS: TUNING_KEYS };
});
