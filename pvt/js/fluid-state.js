/*
 * fluid-state.js -- the state of the fluid at one pressure, and a schematic
 * pressure-temperature phase envelope for it.
 *
 * Both are driven by the cursor pressure so the barrel and the phase diagram
 * always show the same instant as the charts.
 *
 * Field units throughout (psia, degF, scf/STB, bbl/STB, ft3/scf).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PVTFluidState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BBL_FT3 = 5.614583;

  /* Piecewise-linear lookup on a model table. The tables carry Pb as a node,
     so the kink at the bubble point is preserved rather than smoothed over. */
  function interp(rows, p, key) {
    if (!rows.length) return NaN;
    if (p <= rows[0].p) return rows[0][key];
    var last = rows[rows.length - 1];
    if (p >= last.p) return last[key];
    for (var i = 1; i < rows.length; i++) {
      if (p <= rows[i].p) {
        var a = rows[i - 1], b = rows[i];
        var f = (p - a.p) / (b.p - a.p || 1);
        return a[key] + f * (b[key] - a[key]);
      }
    }
    return last[key];
  }

  /*
   * What one stock-tank barrel of oil plus its solution gas looks like at
   * pressure p -- a constant-composition expansion.
   *
   *   oilRb      reservoir volume of the liquid phase,  bbl per STB
   *   freeGasRb  reservoir volume of the evolved gas,   bbl per STB
   *   liquidFrac volume fraction of the cell that is liquid
   *   relVol     total volume relative to the volume at Pb (V/Vb)
   */
  function barrelState(model, p) {
    if (model.fluid === 'gas') return gasBarrelState(model, p);
    p = Math.max(Math.min(p, model.oil[model.oil.length - 1].p), model.oil[0].p);
    var rs = interp(model.oil, p, 'rs');
    var bo = interp(model.oil, p, 'bo');
    var muo = interp(model.oil, p, 'muo');
    var rhoO = interp(model.oil, p, 'rhoO');
    var bg = interp(model.gas, p, 'bg');          /* ft3/scf */
    var z = interp(model.gas, p, 'z');
    var freeGasScf = Math.max(model.rsb - rs, 0);
    var freeGasRb = freeGasScf * bg / BBL_FT3;
    var total = bo + freeGasRb;
    return {
      p: p, rs: rs, bo: bo, bg: bg, z: z, muo: muo, rhoO: rhoO,
      freeGasScf: freeGasScf, freeGasRb: freeGasRb,
      oilRb: bo, totalRb: total,
      liquidFrac: bo / total,
      gasFrac: freeGasRb / total,
      dissolvedFrac: model.rsb > 0 ? rs / model.rsb : 1,
      relVol: total / model.bob,
      saturated: p <= model.pb + 1e-6
    };
  }

  /*
   * Gas reservoirs -- the expansion of the reservoir gas that 1 Mscf of
   * separator gas (plus the condensate a wet gas carries) occupies. Both dry
   * and wet gas stay single-phase in the reservoir, so the cell only grows as
   * pressure falls; the condensate of a wet gas appears at the separator, not
   * here.
   *
   *   gasRb        reservoir volume of the cell,               bbl
   *   relVol       V / Vi, against the volume at the highest table pressure
   *   densityFrac  gas density relative to its value at that pressure
   */
  function gasBarrelState(model, p) {
    var rows = model.gas, top = rows[rows.length - 1];
    p = Math.max(Math.min(p, top.p), rows[0].p);
    var bg = interp(rows, p, 'bg'), z = interp(rows, p, 'z');
    var rhoG = interp(rows, p, 'rhoG'), mug = interp(rows, p, 'mug');
    var gasRb = 1000 * bg / BBL_FT3;
    var vRef = 1000 * top.bg / BBL_FT3;
    return {
      p: p, bg: bg, z: z, rv: model.cgr, rhoG: rhoG, mug: mug,
      gasRb: gasRb, liquidRb: 0, totalRb: gasRb,
      liquidFrac: 0, gasFrac: 1,
      relVol: gasRb / vRef,
      densityFrac: rhoG / top.rhoG,
      saturated: false
    };
  }

  /* ------------------------------------------------------------------ *
   * Schematic P-T phase envelope.
   *
   * A true envelope needs a compositional EOS. What is available here is one
   * hard point -- the computed bubble point (Tres, Pb) -- plus the fluid's
   * volatility, which sets how far the critical temperature sits above the
   * reservoir temperature. The envelope is built to pass through that point
   * exactly and is labelled schematic everywhere it is shown.
   *
   * Bubble branch:  P(T) = Pc - (Pc - P0)*((Tc - T)/(Tc - T0))^m
   * which is P0 at T0, Pc at Tc, and flattens as it approaches the critical
   * point. Pc then follows in closed form from P(Tres) = Pb.
   * ------------------------------------------------------------------ */
  var T0 = 60, P0 = 14.696, M_EXP = 1.8;

  function volatility(api, rsb) {
    var v = 0.6 * (rsb / 2000) + 0.4 * ((api - 25) / 25);
    return Math.max(0, Math.min(1, v));
  }

  function phaseEnvelope(model) {
    if (model.fluid === 'gas') return gasPhaseEnvelope(model);
    var inp = model.input;
    var tres = inp.tempF, pb = model.pb;
    var v = volatility(inp.api, model.rsb);
    var dT = 20 + (1 - v) * 320;                 /* degF from Tres to Tc */
    var tc = tres + dT;
    var r = Math.pow((tc - tres) / (tc - T0), M_EXP);
    var pc = (pb - P0 * r) / (1 - r);

    var fluidType = dT > 150 ? 'black oil' : (dT > 60 ? 'volatile oil' : 'near-critical fluid');

    function bubbleAt(t) {
      var x = Math.pow((tc - t) / (tc - T0), M_EXP);
      return pc - (pc - P0) * x;
    }

    var bubble = [], i, n = 60;
    for (i = 0; i <= n; i++) {
      var t = T0 + (tc - T0) * i / n;
      bubble.push({ t: t, p: bubbleAt(t) });
    }

    /* Dew branch: out to the cricondentherm, then down and back to the left.
       Drawn through control points with a Catmull-Rom sampling so it stays
       smooth without a spline library. */
    var dTc = 0.20 * (tc - T0);
    var ctrl = [
      { t: tc, p: pc },
      { t: tc + 0.55 * dTc, p: 0.86 * pc },
      { t: tc + dTc, p: 0.55 * pc },
      { t: tc + 0.72 * dTc, p: 0.22 * pc },
      { t: tc + 0.30 * dTc, p: 0.06 * pc },
      { t: T0 + 0.55 * (tc - T0), p: P0 }
    ];
    var dew = catmullRom(ctrl, 14);

    /* Iso-liquid-volume lines fan out from the critical point: q = 1 is the
       bubble line, q = 0 the dew line. */
    var bubbleFromC = bubble.slice().reverse();      /* C -> low T */
    var quality = [0.75, 0.5, 0.25].map(function (q) {
      var m = Math.min(bubbleFromC.length, dew.length), pts = [], k;
      for (k = 0; k < m; k++) {
        var fb = k / (m - 1), a = bubbleFromC[Math.round(fb * (bubbleFromC.length - 1))];
        var b = dew[Math.round(fb * (dew.length - 1))];
        pts.push({ t: q * a.t + (1 - q) * b.t, p: q * a.p + (1 - q) * b.p });
      }
      return { q: q, points: pts };
    });

    var tMax = Math.max.apply(null, dew.map(function (d) { return d.t; }));
    return {
      kind: 'oil', psat: pb, satLabel: 'Pb',
      t0: T0, p0: P0, tc: tc, pc: pc, tres: tres, pb: pb,
      dT: dT, volatility: v, fluidType: fluidType,
      bubble: bubble, dew: dew, quality: quality,
      bubbleAt: bubbleAt,
      tMin: T0, tMax: tMax,
      pMaxPlot: Math.max(pc, model.oil[model.oil.length - 1].p) * 1.08
    };
  }

  /* ------------------------------------------------------------------ *
   * Schematic envelope for a gas reservoir.
   *
   *  wet gas   cricondentherm between separator and reservoir temperature:
   *            the reservoir path stays single-phase, and the separator point
   *            sits inside the envelope, where the condensate forms.
   *  dry gas   the envelope lies left of both the reservoir and the separator.
   *
   * Neither fluid has a computed saturation pressure, so the envelope is
   * sized from the pseudo-critical (Tpc, Ppc) of the reservoir gas -- Tc at
   * Tpc, Pc a little above Ppc (a mixture's true critical pressure always
   * exceeds its pseudo-critical pressure). It places the fluid, it does not
   * measure it.
   * ------------------------------------------------------------------ */
  function gasPhaseEnvelope(model) {
    var inp = model.input, kind = model.gasKind;
    var tres = inp.tempF, tsep = inp.tSepF, psep = inp.pSepPsia;
    var tc = model.pcrit.tpc - 459.67;
    var pc = model.pcrit.ppc, tct, pcb, fluidType;
    if (kind === 'wet') {
      var lo = Math.min(tsep, tres - 20);
      tct = lo + 0.55 * (tres - lo);
      pc *= 1.5;
      pcb = pc * 1.6;
      fluidType = 'wet gas';
    } else {
      tct = Math.min(tsep, tres) - 30;
      pc *= 1.1;
      pcb = pc * 1.25;
      fluidType = 'dry gas';
    }
    if (tct < tc + 60) tct = tc + 60;
    var w = tct - tc;
    var ctrl = [
      { t: tc, p: pc },
      { t: tc + 0.30 * w, p: pcb },
      { t: tc + 0.72 * w, p: 0.80 * pcb },
      { t: tct, p: 0.42 * pcb },
      { t: tct - 0.10 * w, p: 0.12 * pcb },
      { t: tc + 0.30 * w, p: P0 }
    ];
    var dew = catmullRom(ctrl, 14);
    var tb0 = tc - 0.6 * w;
    function bubbleAt(t) {
      var x = Math.pow(Math.max(tc - t, 0) / (tc - tb0), M_EXP);
      return pc - (pc - P0) * x;
    }
    var bubble = [], i, n = 60;
    for (i = 0; i <= n; i++) {
      var t = tb0 + (tc - tb0) * i / n;
      bubble.push({ t: t, p: bubbleAt(t) });
    }
    var bubbleFromC = bubble.slice().reverse();
    /* iso-liquid lines hug the dew line in a gas: 50, 25, 10 % liquid */
    var quality = [0.5, 0.25, 0.10].map(function (q) {
      var m = Math.min(bubbleFromC.length, dew.length), pts = [], k;
      for (k = 0; k < m; k++) {
        var fb = k / (m - 1), a = bubbleFromC[Math.round(fb * (bubbleFromC.length - 1))];
        var b = dew[Math.round(fb * (dew.length - 1))];
        pts.push({ t: q * a.t + (1 - q) * b.t, p: q * a.p + (1 - q) * b.p });
      }
      return { q: q, points: pts };
    });
    var polygon = bubble.concat(dew);
    var tDewMax = Math.max.apply(null, dew.map(function (d) { return d.t; }));
    var pTop = Math.max.apply(null, dew.map(function (d) { return d.p; }));
    var tHi = Math.max(tDewMax, tres, tsep), tLo = Math.min(tb0, tsep);
    return {
      kind: kind, psat: null, satLabel: null,
      t0: tb0, p0: P0, tc: tc, pc: pc, tres: tres,
      tct: tDewMax, pcb: pTop,
      dT: tres - tc, fluidType: fluidType,
      bubble: bubble, dew: dew, quality: quality, bubbleAt: bubbleAt,
      sep: { t: tsep, p: psep, inside: pointInPolygon(polygon, tsep, psep) },
      inside: function (t, p) { return pointInPolygon(polygon, t, p); },
      tMin: tLo, tMax: tHi + 0.06 * (tHi - tLo),
      pMaxPlot: Math.max(pTop, pc, model.gas[model.gas.length - 1].p) * 1.08
    };
  }

  /* Even-odd rule on the closed envelope outline. */
  function pointInPolygon(poly, t, p) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if (((a.p > p) !== (b.p > p)) &&
          (t < (b.t - a.t) * (p - a.p) / (b.p - a.p) + a.t)) inside = !inside;
    }
    return inside;
  }

  function catmullRom(pts, perSeg) {
    var out = [], i, j;
    function at(k) { return pts[Math.max(0, Math.min(pts.length - 1, k))]; }
    for (i = 0; i < pts.length - 1; i++) {
      var p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (j = 0; j < perSeg; j++) {
        var s = j / perSeg, s2 = s * s, s3 = s2 * s;
        out.push({
          t: 0.5 * ((2 * p1.t) + (-p0.t + p2.t) * s +
            (2 * p0.t - 5 * p1.t + 4 * p2.t - p3.t) * s2 +
            (-p0.t + 3 * p1.t - 3 * p2.t + p3.t) * s3),
          p: 0.5 * ((2 * p1.p) + (-p0.p + p2.p) * s +
            (2 * p0.p - 5 * p1.p + 4 * p2.p - p3.p) * s2 +
            (-p0.p + 3 * p1.p - 3 * p2.p + p3.p) * s3)
        });
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /* Where the cursor pressure sits relative to the envelope, on the
     reservoir isotherm. */
  function stateAt(env, model, p) {
    var bs = barrelState(model, p);
    if (model.fluid === 'gas') {
      return {
        phase: 'Single-phase gas',
        detail: model.gasKind === 'wet'
          ? 'Wet gas — its ' + model.cgr.toFixed(0) + ' STB/MMscf of condensate stays vaporised until the separator'
          : 'Dry gas at every reservoir pressure',
        liquidFrac: 0,
        barrel: bs
      };
    }
    var above = p > env.pb + 1e-6;
    return {
      phase: above ? 'Single-phase liquid' : 'Two-phase',
      detail: above
        ? 'Undersaturated oil — all ' + model.rsb.toFixed(0) + ' scf/STB still in solution'
        : 'Saturated oil with free gas — ' + bs.freeGasScf.toFixed(0) + ' scf/STB has evolved',
      liquidFrac: bs.liquidFrac,
      barrel: bs
    };
  }

  return {
    interp: interp, barrelState: barrelState, phaseEnvelope: phaseEnvelope,
    gasBarrelState: gasBarrelState, pointInPolygon: pointInPolygon,
    stateAt: stateAt, volatility: volatility, BBL_FT3: BBL_FT3
  };
});
