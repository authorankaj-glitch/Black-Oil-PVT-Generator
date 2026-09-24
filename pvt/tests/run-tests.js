/*
 * run-tests.js -- regression tests for the PVT correlation library.
 *   node pvt/tests/run-tests.js
 *
 * Reference values were produced from an independent implementation of the
 * published equations; the remaining tests assert the physical invariants a
 * reservoir simulator relies on (monotonicity, continuity at the bubble point,
 * deck structure and unit conversions) and the regression against laboratory
 * data (recovery of known multipliers, correlation ranking, deck headers).
 */
'use strict';
var C = require('../js/correlations.js');
var M = require('../js/pvt-model.js');
var E = require('../js/export.js');
var FS = require('../js/fluid-state.js');
var TU = require('../js/tuning.js');

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}
function near(name, got, want, relTol) {
  var tol = relTol === undefined ? 1e-4 : relTol;
  var err = Math.abs(got - want) / Math.max(Math.abs(want), 1e-12);
  ok(name, err <= tol, 'got ' + got + ', expected ' + want + ' (rel err ' + err.toExponential(2) + ')');
}
function section(t) { console.log('\n' + t); }

var S = { api: 35, gammaG: 0.75, tempF: 180, tSepF: 80, pSepPsia: 114.7, rsb: 600, pb: 0 };
var RS = 600;

section('1. Bubble-point correlations (reference values)');
near('Standing (1947)',          C.PB.standing(RS, S),        2463.0110, 1e-6);
near('Vasquez & Beggs (1980)',   C.PB.vasquezBeggs(RS, S),    2758.0998, 1e-6);
near('Glaso (1980)',             C.PB.glaso(RS, S),           2854.0233, 1e-6);
near('Al-Marhoun (1988)',        C.PB.alMarhoun(RS, S),       2832.9853, 1e-6);
near('Lasater (1958)',           C.PB.lasater(RS, S),         2790.7589, 1e-6);
ok('Petrosky & Farshad within 20% of the correlation family',
   Math.abs(C.PB.petroskyFarshad(RS, S) - 2800) / 2800 < 0.20,
   'got ' + C.PB.petroskyFarshad(RS, S));

section('2. Bubble point responds correctly to the inputs');
Object.keys(C.PB).forEach(function (k) {
  var light = C.PB[k](RS, Object.assign({}, S, { api: 45 }));
  var heavy = C.PB[k](RS, Object.assign({}, S, { api: 25 }));
  ok(k + ': Pb falls as the oil gets lighter', light < heavy, light + ' vs ' + heavy);
  ok(k + ': Pb rises with Rs', C.PB[k](RS * 1.5, S) > C.PB[k](RS, S));
  ok(k + ': Pb rises with temperature', C.PB[k](RS, Object.assign({}, S, { tempF: 250 })) > C.PB[k](RS, S));
});

section('3. Rs(p) inverts Pb(Rs) exactly');
Object.keys(C.PB).forEach(function (k) {
  var s = Object.assign({}, S, { pb: C.PB[k](RS, S) });
  near(k + ': Rs(Pb) = Rsb', C.solutionGor(k, s.pb, s), RS, 1e-6);
  ok(k + ': Rs increases with pressure',
     C.solutionGor(k, 0.4 * s.pb, s) < C.solutionGor(k, 0.8 * s.pb, s));
  ok(k + ': Rs clipped at Rsb above Pb', C.solutionGor(k, 2 * s.pb, s) === RS);
});

section('4. Oil FVF and viscosity (reference values)');
near('Bo Standing',          C.BO.standing(RS, S),        1.3351887, 1e-6);
near('Bo Glaso',             C.BO.glaso(RS, S),           1.3102581, 1e-6);
near('Bo Al-Marhoun',        C.BO.alMarhoun(RS, S),       1.3347652, 1e-6);
near('Bo Petrosky-Farshad',  C.BO.petroskyFarshad(RS, S), 1.3331954, 1e-6);
near('mu_od Beggs-Robinson', C.MU_OD.beggsRobinson(S),    2.1833493, 1e-6);
near('mu_od Beal',           C.MU_OD.beal(S),             1.6656215, 1e-6);
near('mu_od Glaso',          C.MU_OD.glaso(S),            1.7446399, 1e-6);
near('mu_od Ng-Egbogah',     C.MU_OD.ngEgbogah(S),        2.2968617, 1e-6);
near('mu_ob Beggs-Robinson', C.MU_OB.beggsRobinson(C.MU_OD.beggsRobinson(S), RS), 0.5776164, 1e-6);
ok('Bo -> ~1.0 as Rs -> 0', Math.abs(C.BO.standing(0, S) - 1.0) < 0.06, C.BO.standing(0, S));
ok('dissolved gas thins the oil', C.MU_OB.beggsRobinson(2.18, RS) < 2.18);
ok('undersaturated oil thickens above Pb',
   C.MU_OU.vasquezBeggs(0.578, 4000, 2463) > 0.578 &&
   C.MU_OU.petroskyFarshad(0.578, 4000, 2463) > 0.578);

section('5. Gas z-factor');
near('Standing-Katz anchor z(Ppr=2.0, Tpr=1.5) ~ 0.82', C.ZFACTOR.dak(2.0, 1.5), 0.82, 0.02);
[[0.5, 1.1], [1.0, 1.3], [2.0, 1.5], [4.0, 2.0], [6.0, 1.8], [8.0, 2.4]].forEach(function (pt) {
  var d = C.ZFACTOR.dak(pt[0], pt[1]), h = C.ZFACTOR.hallYarborough(pt[0], pt[1]);
  ok('DAK vs Hall-Yarborough agree within 1.5% at Ppr=' + pt[0] + ', Tpr=' + pt[1],
     Math.abs(d - h) / h < 0.015, d.toFixed(4) + ' vs ' + h.toFixed(4));
});
ok('z -> 1 at low pressure', Math.abs(C.ZFACTOR.dak(0.01, 1.5) - 1) < 0.01);
ok('z stays physical over a wide grid', (function () {
  for (var ppr = 0.2; ppr <= 12; ppr += 0.4) {
    for (var tpr = 1.05; tpr <= 3.0; tpr += 0.15) {
      var z = C.ZFACTOR.dak(ppr, tpr);
      if (!(z > 0.15 && z < 3.0) || !isFinite(z)) return false;
    }
  }
  return true;
})());

section('6. Pseudo-criticals and non-hydrocarbon corrections');
var pcSweet = C.pseudoCriticals(0.75, { method: 'sutton' });
near('Sutton Tpc (0.75 sg)', pcSweet.tpc, 169.2 + 349.5 * 0.75 - 74.0 * 0.5625, 1e-9);
var pcSour = C.pseudoCriticals(0.75, { method: 'sutton', yCO2: 0.05, yH2S: 0.10 });
ok('Wichert-Aziz lowers Tpc for sour gas', pcSour.tpc < pcSweet.tpc, pcSour.tpc + ' vs ' + pcSweet.tpc);
ok('Wichert-Aziz epsilon is positive for sour gas', pcSour.eps > 0);

section('7. Gas density, FVF and viscosity (reference values)');
near('rho_g at 3000 psia, z = 0.9', C.gasDensity(0.9, 3000, 180, 0.75), 10.5477043, 1e-6);
near('mu_g Lee-Gonzalez-Eakin', C.MU_G.leeGonzalezEakin(10.5477043, 180, 0.75), 0.0203499, 1e-5);
near('Bg at 3000 psia, z = 0.9', C.gasBg(0.9, 3000, 180), 0.0282793 * 0.9 * 639.67 / 3000, 1e-9);
ok('cg ~ 1/p at low pressure',
   Math.abs(C.gasCompressibility('dak', 100, 180, 0.75, {}) - 1 / 100) / (1 / 100) < 0.05);

section('8. Formation water (reference values)');
near('Bw at 3000 psia, 180 degF', C.waterBw(3000, 180), 1.0272697, 1e-6);
near('mu_w at 3 wt% NaCl',        C.waterViscosity(3000, 180, 3.0), 0.4302322, 1e-6);
ok('cw is of order 3e-6 1/psi', (function () {
  var cw = C.waterCompressibility(3000, 180, 3.0);
  return cw > 1e-6 && cw < 6e-6;
})(), C.waterCompressibility(3000, 180, 3.0));
ok('brine is denser than fresh water', C.waterDensitySC(10) > C.waterDensitySC(0));

section('9. Model assembly and physical consistency');
var m = M.build({ api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMax: 6000, nSat: 12, nUnsat: 5 });
near('model Pb matches the correlation', m.pb, C.PB.standing(600, S), 1e-9);
ok('table spans the requested pressure range',
   Math.abs(m.oil[m.oil.length - 1].p - 6000) < 1e-6 && m.oil[0].p > 0);
ok('the bubble point is a table node',
   m.oil.some(function (r) { return Math.abs(r.p - m.pb) < 1e-6; }));
ok('Rs is monotonic and capped at Rsb', (function () {
  for (var i = 1; i < m.oil.length; i++) {
    if (m.oil[i].rs < m.oil[i - 1].rs - 1e-9) return false;
    if (m.oil[i].rs > m.rsb + 1e-9) return false;
  }
  return true;
})());
ok('Bo peaks at the bubble point', (function () {
  var maxRow = m.oil.reduce(function (a, b) { return b.bo > a.bo ? b : a; });
  return Math.abs(maxRow.p - m.pb) < 1e-6;
})());
ok('oil viscosity is minimum at the bubble point', (function () {
  var minRow = m.oil.reduce(function (a, b) { return b.muo < a.muo ? b : a; });
  return Math.abs(minRow.p - m.pb) < 1e-6;
})());
ok('Bo and mu_o are continuous across Pb', (function () {
  var i = m.oil.findIndex(function (r) { return Math.abs(r.p - m.pb) < 1e-6; });
  return Math.abs(m.oil[i].bo - m.bob) < 1e-9 && Math.abs(m.oil[i].muo - m.muob) < 1e-9;
})());
ok('Bg decreases monotonically with pressure', (function () {
  for (var i = 1; i < m.gas.length; i++) if (m.gas[i].bg > m.gas[i - 1].bg) return false;
  return true;
})());
ok('gas viscosity increases monotonically with pressure', (function () {
  for (var i = 1; i < m.gas.length; i++) if (m.gas[i].mug < m.gas[i - 1].mug) return false;
  return true;
})());
ok('oil density decreases as gas goes into solution', (function () {
  var sat = m.oil.filter(function (r) { return r.saturated; });
  return sat[0].rhoO > sat[sat.length - 1].rhoO;
})());
ok('PVTO branches do not cross', (function () {
  for (var i = 1; i < m.pvto.length; i++) {
    var a = m.pvto[i - 1].rows, b = m.pvto[i].rows;
    if (b[b.length - 1].bo < a[a.length - 1].bo) return false;
  }
  return true;
})());

section('10. Specification by measured bubble point and calibration');
var mp = M.build({ api: 35, gammaG: 0.75, spec: 'pb', pbMeas: 3200, tempF: 180, pMax: 6000 });
near('spec=pb reproduces the measured Pb', mp.pb, 3200, 1e-6);
near('spec=pb back-solves a consistent Rsb', C.PB.standing(mp.rsb, S), 3200, 1e-5);
var mc = M.build({
  api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMax: 6000,
  calib: { pbMeas: 3000, bobMeas: 1.42 }
});
near('calibrated Pb honours the measurement', mc.pb, 3000, 1e-9);
near('calibrated Bob honours the measurement', mc.bob, 1.42, 1e-9);
near('Rs still reaches Rsb at the calibrated Pb',
     mc.oil.filter(function (r) { return r.saturated; }).pop().rs, 600, 1e-6);
ok('calibration leaves Rs monotonic', (function () {
  for (var i = 1; i < mc.oil.length; i++) if (mc.oil[i].rs < mc.oil[i - 1].rs - 1e-9) return false;
  return true;
})());

section('11. Export formats');
var ecl = E.eclipse(m, 'field');
['DENSITY', 'PVTO', 'PVDG', 'PVTW', 'ROCK', 'FIELD'].forEach(function (kw) {
  ok('Eclipse deck contains ' + kw, new RegExp('^' + kw + '\\s*$', 'm').test(ecl));
});
ok('every PVTO record is terminated', (function () {
  var body = ecl.split('PVTO\n')[1].split('\n/\n')[0];
  var slashes = body.split('\n').filter(function (l) { return /\/\s*$/.test(l); }).length;
  return slashes === m.pvto.length;
})());
function pvtoRecordHeads(deck) {
  /* a record head carries four columns (Rs, Pbub, Bo, Visc); continuation
     rows leave the Rs column blank */
  return deck.split('PVTO\n')[1].split('\n/\n')[0].trim().split('\n')
    .map(function (l) { return l.replace(/\/\s*$/, '').trim().split(/\s+/); })
    .filter(function (c) { return c.length === 4; });
}
ok('PVTO has one record head per saturated node',
   pvtoRecordHeads(ecl).length === m.pvto.length);
ok('PVTO Rs is written in Mscf/STB', (function () {
  var heads = pvtoRecordHeads(ecl);
  var rsb = parseFloat(heads[heads.length - 1][0]);
  return Math.abs(rsb - m.rsb / 1000) < 1e-4;
})(), 'last head = ' + pvtoRecordHeads(ecl).pop().join(' '));
ok('no unparsable numbers in the deck', (function () {
  return ecl.split('\n').every(function (l) {
    if (/^\s*(--|$)/.test(l) || /^[A-Z]+\s*$/.test(l)) return true;
    return l.replace(/\//g, '').trim().split(/\s+/).every(function (t) {
      return t === '' || isFinite(parseFloat(t));
    });
  });
})());
var eclM = E.eclipse(m, 'metric');
ok('metric deck is labelled METRIC', /^METRIC\s*$/m.test(eclM));
ok('metric pressures are converted to bar', (function () {
  var rows = eclM.split('PVDG\n')[1].split('\n/')[0].trim().split('\n');
  var pFirst = parseFloat(rows[0].trim().split(/\s+/)[0]);
  return Math.abs(pFirst - m.gas[0].p * 0.0689475729) < 1e-2;
})());
ok('metric Rs is converted to sm3/sm3', (function () {
  var heads = pvtoRecordHeads(eclM);
  var rs = parseFloat(heads[heads.length - 1][0]);
  return Math.abs(rs - m.rsb * 0.178107607) < 1e-2;
})());
var imex = E.cmg(m, 'field');
['\\*MODEL \\*BLACKOIL', '\\*PVT \\*BG 1', '\\*DENSITY \\*OIL', '\\*CO ', '\\*BWI'].forEach(function (kw) {
  ok('IMEX deck contains ' + kw.replace(/\\/g, ''), new RegExp(kw).test(imex));
});
function imexTable(deck) {
  var rows = [];
  deck.split('*PVT *BG 1\n')[1].split('\n').every(function (l) {
    if (!l.trim()) return false;
    rows.push(l.trim().split(/\s+/));
    return true;
  });
  return rows;
}
ok('IMEX gas expansion factor is 5.6146/Bg (scf/bbl)', (function () {
  var rows = imexTable(imex);
  var eg = parseFloat(rows[0][3]);
  return Math.abs(eg - 5.614583 / m.gas[0].bg) / eg < 1e-4;
})());
ok('IMEX saturated table ends at the bubble point', (function () {
  var rows = imexTable(imex);
  return Math.abs(parseFloat(rows[rows.length - 1][0]) - m.pb) < 0.5;
})());
ok('IMEX table holds only saturated nodes',
   imexTable(imex).length === m.oil.filter(function (r) { return r.saturated; }).length);
var csv = E.csv(m);
ok('CSV has one data row per pressure node', (function () {
  var lines = csv.split('\n').filter(function (l) { return l && !/^#/.test(l); });
  return lines.length === m.oil.length + 1;
})());
ok('CSV parses as numbers', (function () {
  var lines = csv.split('\n').filter(function (l) { return l && !/^#/.test(l); });
  return lines.slice(1).every(function (l) {
    var c = l.split(',');
    return isFinite(parseFloat(c[0])) && isFinite(parseFloat(c[7]));
  });
})());
ok('JSON round-trips', (function () {
  var j = JSON.parse(E.json(m));
  return j.oil.length === m.oil.length && Math.abs(j.pb - m.pb) < 1e-9;
})());
ok('every export carries the provenance header', (function () {
  return /Black-Oil PVT Generator/.test(ecl) && /Black-Oil PVT Generator/.test(imex) &&
         /Black-Oil PVT Generator/.test(csv) && /CORRELATIONS/.test(ecl);
})());

section('12. Robustness across a fluid sweep');
var swept = 0, refused = 0, bad = [];
[20, 30, 40, 50].forEach(function (api) {
  [0.65, 0.85, 1.05].forEach(function (gg) {
    [120, 200, 280].forEach(function (t) {
      [100, 500, 1200, 2000].forEach(function (rsb) {
        Object.keys(C.PB).forEach(function (pbCorr) {
          var mm;
          try {
            mm = M.build({ api: api, gammaG: gg, rsb: rsb, tempF: t, pMax: 8000,
                           nSat: 8, nUnsat: 4, corr: { pb: pbCorr } });
          } catch (e) {
            /* A refusal is acceptable only when the correlation itself returns a
               non-physical bubble point; it must name the correlation and say so. */
            var raw = C.PB[pbCorr](rsb, { api: api, gammaG: gg, tempF: t, tSepF: 80, pSepPsia: 114.7 });
            if (!(raw <= 0) || !/non-physical bubble point/.test(e.message)) {
              bad.push([api, gg, t, rsb, pbCorr, e.message].join('/'));
            } else { refused++; }
            return;
          }
          swept++;
          var finite = mm.oil.every(function (r) { return isFinite(r.bo) && isFinite(r.muo) && r.bo > 0 && r.muo > 0; }) &&
                       mm.gas.every(function (r) { return isFinite(r.z) && r.z > 0.15 && isFinite(r.mug) && r.mug > 0; });
          if (!finite) bad.push([api, gg, t, rsb, pbCorr].join('/'));
        });
      });
    });
  });
});
ok(swept + ' fluid/correlation combinations produce finite, positive properties (' +
   refused + ' refused with a non-physical bubble point)',
   bad.length === 0, bad.slice(0, 5).join(' | '));

section('13. Cursor-linked fluid state (barrel)');
var fm = M.build({ api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMin: 100, pMax: 6000, nSat: 15, nUnsat: 6 });
near('table lookup is exact at a node', FS.interp(fm.oil, fm.pb, 'bo'), fm.bob, 1e-9);
ok('table lookup clamps outside the range',
   FS.interp(fm.oil, 1e9, 'rs') === fm.rsb && FS.interp(fm.oil, -5, 'rs') === fm.oil[0].rs);
var atPb = FS.barrelState(fm, fm.pb);
near('no free gas at the bubble point', atPb.freeGasScf, 0, 1e-6);
near('the cell is all liquid at the bubble point', atPb.liquidFrac, 1, 1e-9);
near('V/Vb is 1 at the bubble point', atPb.relVol, 1, 1e-9);
ok('above Pb nothing comes out of solution', (function () {
  for (var p = fm.pb + 50; p <= 6000; p += 250) {
    var s = FS.barrelState(fm, p);
    if (s.freeGasScf > 1e-9 || Math.abs(s.liquidFrac - 1) > 1e-9) return false;
  }
  return true;
})());
ok('below Pb the gas fraction grows as pressure falls', (function () {
  var prev = -1;
  for (var p = fm.pb; p >= 100; p -= 100) {
    var g = FS.barrelState(fm, p).gasFrac;
    if (g < prev - 1e-12) return false;
    prev = g;
  }
  return prev > 0.8;
})());
ok('below Pb the cell expands as pressure falls', (function () {
  var prev = 0;
  for (var p = fm.pb; p >= 100; p -= 100) {
    var v = FS.barrelState(fm, p).totalRb;
    if (v < prev - 1e-9) return false;
    prev = v;
  }
  return prev > FS.barrelState(fm, fm.pb).totalRb;
})());
ok('dissolved fraction falls monotonically with pressure', (function () {
  var prev = 2;
  for (var p = fm.pb; p >= 100; p -= 100) {
    var d = FS.barrelState(fm, p).dissolvedFrac;
    if (d > prev + 1e-12) return false;
    prev = d;
  }
  return prev < 0.1;
})());
ok('liquid and gas fractions sum to one', (function () {
  for (var p = 100; p <= 6000; p += 137) {
    var s = FS.barrelState(fm, p);
    if (Math.abs(s.liquidFrac + s.gasFrac - 1) > 1e-12) return false;
  }
  return true;
})());
ok('free gas volume equals the evolved gas times Bg', (function () {
  var s = FS.barrelState(fm, 1000);
  var bg = FS.interp(fm.gas, 1000, 'bg');
  return Math.abs(s.freeGasRb - s.freeGasScf * bg / 5.614583) < 1e-12;
})());

section('14. Schematic phase envelope');
var env = FS.phaseEnvelope(fm);
near('the bubble branch passes through the computed bubble point',
     env.bubbleAt(fm.input.tempF), fm.pb, 1e-9);
ok('the critical point sits above and right of the bubble point',
   env.pc > fm.pb && env.tc > fm.input.tempF, env.pc + ' / ' + env.tc);
ok('the bubble branch rises monotonically with temperature', (function () {
  for (var i = 1; i < env.bubble.length; i++) {
    if (env.bubble[i].p <= env.bubble[i - 1].p) return false;
  }
  return true;
})());
ok('the bubble branch starts at standard conditions and ends at the critical point',
   Math.abs(env.bubble[0].t - 60) < 1e-9 && Math.abs(env.bubble[0].p - 14.696) < 1e-6 &&
   Math.abs(env.bubble[env.bubble.length - 1].t - env.tc) < 1e-6 &&
   Math.abs(env.bubble[env.bubble.length - 1].p - env.pc) < 1e-6);
ok('the dew branch starts at the critical point and turns back to low pressure',
   Math.abs(env.dew[0].t - env.tc) < 1e-6 &&
   env.dew[env.dew.length - 1].p < 0.05 * env.pc);
ok('the cricondentherm lies beyond the critical temperature', env.tMax > env.tc);
ok('quality lines fan out from the critical point', env.quality.every(function (q) {
  return Math.abs(q.points[0].t - env.tc) < 1e-6 && Math.abs(q.points[0].p - env.pc) < 1e-6;
}));
ok('quality lines are ordered between the two branches', (function () {
  var k = 20, a = env.quality[0].points[k], b = env.quality[1].points[k], c = env.quality[2].points[k];
  return a.t < b.t && b.t < c.t;    /* 75% closest to the bubble line */
})());
ok('a heavier, lower-GOR fluid sits further from its critical point', (function () {
  var heavy = FS.phaseEnvelope(M.build({ api: 18, gammaG: 0.65, rsb: 120, tempF: 130, pMin: 50, pMax: 3000 }));
  var vol = FS.phaseEnvelope(M.build({ api: 45, gammaG: 0.85, rsb: 1800, tempF: 250, pMin: 200, pMax: 8000, corr: { pb: 'glaso' } }));
  return heavy.dT > vol.dT && heavy.fluidType === 'black oil' && vol.fluidType !== 'black oil';
})());
ok('the envelope is anchored for every preset fluid', (function () {
  var cases = [
    { api: 38, gammaG: 0.72, rsb: 900, tempF: 200, pMax: 6500 },
    { api: 18, gammaG: 0.65, rsb: 120, tempF: 130, pMin: 50, pMax: 3000 },
    { api: 45, gammaG: 0.85, rsb: 1800, tempF: 250, pMin: 200, pMax: 8000 },
    { api: 30, gammaG: 0.88, rsb: 500, tempF: 210, pMax: 5500, yH2S: 0.08, yCO2: 0.04 }
  ];
  return cases.every(function (c) {
    var mm = M.build(c), ee = FS.phaseEnvelope(mm);
    return Math.abs(ee.bubbleAt(c.tempF) - mm.pb) / mm.pb < 1e-9 && ee.pc > mm.pb && isFinite(ee.tMax);
  });
})());
var st = FS.stateAt(env, fm, fm.pb + 500);
ok('state above Pb reports a single liquid phase',
   st.phase === 'Single-phase liquid' && Math.abs(st.liquidFrac - 1) < 1e-9);
ok('state below Pb reports two phases',
   FS.stateAt(env, fm, fm.pb - 500).phase === 'Two-phase');

section('15. Gas reservoirs - recombination and model assembly');
near('well-stream gravity (McCain) reference value', C.wellstreamGravity(0.7, 100, 50), 0.98670481, 1e-6);
ok('no condensate leaves the separator gravity unchanged', C.wellstreamGravity(0.7, 0, 50) === 0.7);
ok('richer gas is heavier', C.wellstreamGravity(0.7, 200, 50) > C.wellstreamGravity(0.7, 50, 50));
near('condensate MW = 5954/(API - 8.811)', C.condensateMW(50), 5954 / 41.189, 1e-12);
ok('well-stream factor is 1 for a dry gas and above 1 otherwise',
   C.wellstreamFactor(0, 50) === 1 && C.wellstreamFactor(100, 50) > 1);

var GBASE = { fluid: 'gas', gammaG: 0.68, tempF: 230, apiC: 55, pMin: 200, pMax: 6000,
              tSepF: 80, pSepPsia: 514.7, nSat: 20 };
function gm(o) { return M.build(Object.assign({}, GBASE, o)); }
var gDry = gm({ gasKind: 'dry', cgr: 50 });
var gWet = gm({ gasKind: 'wet', cgr: 12 });

ok('fluid flag is carried on every model', gDry.fluid === 'gas' && M.build({}).fluid === 'oil');
ok('only dry and wet gas are modelled - a condensate input falls back to dry',
   M.build({ fluid: 'gas', gasKind: 'condensate', gammaG: 0.7, cgr: 90, apiC: 52, tempF: 250 }).gasKind === 'dry');
ok('neither gas has a saturation pressure in the reservoir',
   gDry.psat === null && gWet.psat === null);
ok('a dry gas ignores any CGR entered', gDry.cgr === 0 && gDry.gammaW === 0.68 && gDry.fws === 1 &&
   gDry.gas.every(function (g) { return g.rv === 0 && Math.abs(g.bg - g.bgw) < 1e-15; }));
ok('dry-gas Bg = 0.0282793 z T / p', gDry.gas.every(function (g) {
  return Math.abs(g.bg - 0.0282793 * g.z * (230 + 459.67) / g.p) < 1e-12;
}));
ok('Eg is 1/Bg at every node', gWet.gas.every(function (g) { return Math.abs(g.eg - 1 / g.bg) < 1e-12; }));
ok('wet gas: reservoir gas is heavier than separator gas', gWet.gammaW > gWet.input.gammaG);
ok('wet gas: Bg on the separator basis = well-stream Bg x well-stream factor',
   gWet.gas.every(function (g) { return Math.abs(g.bg - g.bgw * gWet.fws) < 1e-12; }));
ok('wet gas: Rv stays at the CGR at every pressure',
   gWet.gas.every(function (g) { return g.rv === 12; }));
ok('Bg falls monotonically with pressure', [gDry, gWet].every(function (m) {
  for (var i = 1; i < m.gas.length; i++) if (m.gas[i].bg >= m.gas[i - 1].bg) return false;
  return true;
}));
ok('a rich wet gas is flagged as a possible condensate',
   gm({ gasKind: 'wet', cgr: 120 }).warnings.some(function (w) { return /gas condensate/.test(w); }));
ok('clean dry and wet gases carry no QC warnings',
   gDry.warnings.length === 0 && gWet.warnings.length === 0, gDry.warnings.concat(gWet.warnings).join(' | '));

section('16. Gas barrel (single-phase expansion)');
ok('no liquid anywhere in the reservoir', [gDry, gWet].every(function (m) {
  for (var p = 200; p <= 6000; p += 200) {
    var s = FS.barrelState(m, p);
    if (s.liquidFrac !== 0 || s.gasFrac !== 1) return false;
  }
  return true;
}));
near('V/Vi is 1 at the top of the table', FS.barrelState(gWet, 6000).relVol, 1, 1e-9);
ok('the cell expands as pressure falls', (function () {
  var prev = 0;
  for (var p = 6000; p >= 200; p -= 100) {
    var v = FS.barrelState(gDry, p).relVol;
    if (v < prev - 1e-9) return false;
    prev = v;
  }
  return prev > 1;
})());
ok('the gas thins out as it expands', FS.barrelState(gDry, 1000).densityFrac < FS.barrelState(gDry, 4000).densityFrac);
ok('the barrel reports the vaporised condensate a wet gas carries',
   FS.barrelState(gWet, 3000).rv === 12 && FS.barrelState(gDry, 3000).rv === 0);

section('17. Gas phase envelopes');
var eWet = FS.phaseEnvelope(gWet), eDry = FS.phaseEnvelope(gDry);
ok('wet gas: cricondentherm below the reservoir temperature, separator inside',
   eWet.tct < 230 && eWet.sep.inside && !eWet.inside(230, 2000));
ok('dry gas: cricondentherm below the separator temperature, separator outside',
   eDry.tct < 80 && !eDry.sep.inside);
ok('the critical point sits at the gas pseudo-criticals, pressure a little above Ppc',
   Math.abs(eDry.tc - (gDry.pcrit.tpc - 459.67)) < 1e-9 && eDry.pc > gDry.pcrit.ppc);
ok('fluid type follows the gas type', eDry.fluidType === 'dry gas' && eWet.fluidType === 'wet gas');
ok('neither envelope reports a saturation pressure', eDry.psat === null && eWet.psat === null);
ok('state reporting is single-phase gas at every pressure', [[eDry, gDry], [eWet, gWet]].every(function (c) {
  for (var p = 200; p <= 6000; p += 400) if (FS.stateAt(c[0], c[1], p).phase !== 'Single-phase gas') return false;
  return true;
}));

section('18. Gas exports');
var eclW = E.generate(gWet, 'eclipse', 'field'), eclD = E.generate(gDry, 'eclipse', 'field');
['DENSITY', 'PVDG', 'PVTW', 'ROCK'].forEach(function (kw) {
  ok('gas deck contains ' + kw, new RegExp('^' + kw + '\\s*$', 'm').test(eclW));
});
ok('no live-oil or wet-gas keywords in a gas deck',
   !/^PVTO\s*$/m.test(eclW) && !/^PVTG\s*$/m.test(eclW) && !/^PVTO\s*$/m.test(eclD));
ok('PVDG carries one row per pressure node in rb/Mscf', (function () {
  var body = eclD.split(/^PVDG\s*$/m)[1].split(/^\/\s*$/m)[0];
  var rows = body.split('\n').filter(function (l) { return /^\s+\d/.test(l); });
  if (rows.length !== gDry.gas.length) return false;
  var first = rows[0].trim().split(/\s+/);
  return Math.abs(parseFloat(first[1]) - gDry.gas[0].bg * 1000 / 5.614583) < 1e-5;
})());

/* CMG IMEX gas decks follow the keyword set in the user-supplied example:
   dry gas *MODEL *GASWATER with *PVTG (p, Eg, visg); wet gas
   *MODEL *GASWATER_WITH_CONDENSATE with *PVTG *RV (p, Eg, Rv, visg). */
var cmgD = E.generate(gDry, 'cmg', 'field'), cmgW = E.generate(gWet, 'cmg', 'field');
ok('dry-gas CMG deck: *MODEL *GASWATER and a plain *PVTG table',
   /^\*MODEL \*GASWATER\b/m.test(cmgD) && /^\*PVTG\s*$/m.test(cmgD) && !/\*PVTG \*RV/.test(cmgD));
ok('wet-gas CMG deck: *MODEL *GASWATER_WITH_CONDENSATE and *PVTG *RV',
   /^\*MODEL \*GASWATER_WITH_CONDENSATE\b/m.test(cmgW) && /^\*PVTG \*RV\s*$/m.test(cmgW));
ok('CMG decks declare the surface densities they need',
   /^\*RESERVOIR \*GAS\s*$/m.test(cmgD) && /^\*DENSITY \*GAS/m.test(cmgD) && /^\*DENSITY \*WATER/m.test(cmgD) &&
   !/^\*DENSITY \*OIL/m.test(cmgD) && /^\*DENSITY \*OIL/m.test(cmgW));
ok('dry-gas *PVTG rows are p, Eg, visg', (function () {
  var body = cmgD.split(/^\*PVTG\s*$/m)[1];
  var rows = body.split('\n').filter(function (l) { return /^\s+\d/.test(l); });
  if (rows.length !== gDry.gas.length) return false;
  var f = rows[0].trim().split(/\s+/), g = gDry.gas[0];
  return f.length === 3 && Math.abs(parseFloat(f[0]) - g.p) < 0.01 &&
         Math.abs(parseFloat(f[1]) - g.eg) < 1e-3 && Math.abs(parseFloat(f[2]) - g.mug) < 1e-6;
})());
ok('wet-gas *PVTG *RV rows are p, Eg, Rv, visg with Rv in STB/MMscf', (function () {
  var body = cmgW.split(/^\*PVTG \*RV\s*$/m)[1];
  var rows = body.split('\n').filter(function (l) { return /^\s+\d/.test(l); });
  if (rows.length !== gWet.gas.length) return false;
  var f = rows[0].trim().split(/\s+/), g = gWet.gas[0];
  return f.length === 4 && Math.abs(parseFloat(f[1]) - g.eg) < 1e-3 &&
         Math.abs(parseFloat(f[2]) - 12) < 1e-6 && Math.abs(parseFloat(f[3]) - g.mug) < 1e-6;
})());
ok('the SI CMG deck converts pressure to kPa and Rv to m3/m3', (function () {
  var si = E.generate(gWet, 'cmg', 'metric');
  var rows = si.split(/^\*PVTG \*RV\s*$/m)[1].split('\n').filter(function (l) { return /^\s+\d/.test(l); });
  var f = rows[0].trim().split(/\s+/), g = gWet.gas[0];
  return /^\*INUNIT \*SI\s*$/m.test(si) && Math.abs(parseFloat(f[0]) - g.p * 6.89475729) < 0.05 &&
         Math.abs(parseFloat(f[2]) - 12 * 5.614583e-6) < 1e-10;
})());
ok('gas CMG decks carry the water and rock sections',
   /^\*REFPW /m.test(cmgW) && /^\*BWI /m.test(cmgW) && /^\*CW /m.test(cmgW) &&
   /^\*CPOR /m.test(cmgW) && /^\*PRPOR /m.test(cmgW));
ok('gas CSV has one row per pressure with an Rv column', (function () {
  var lines = E.generate(gWet, 'csv').split('\n').filter(function (l) { return l && !/^#/.test(l); });
  return /Rv_STB_MMscf/.test(lines[0]) && !/Liquid_dropout/.test(lines[0]) && lines.length - 1 === gWet.gas.length;
})());
ok('every gas export header states the single-phase scope',
   /single-phase gas/.test(eclW) && /single-phase gas/.test(cmgW));

section('19. Brine salinity reporting (page takes ppm, correlations take wt%)');
ok('every deck header reports salinity in ppm with the weight percent beside it', (function () {
  var m = M.build({ api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMax: 6000, salinity: 3 });
  var line = E.generate(m, 'eclipse', 'field').split('\n').filter(function (l) { return /Brine salinity/.test(l); })[0];
  return /30000 ppm NaCl equivalent \(3\.000 wt%\)/.test(line);
})());
ok('the gas decks report it the same way', (function () {
  var g = M.build({ fluid: 'gas', gasKind: 'wet', gammaG: 0.68, cgr: 12, apiC: 58, tempF: 230,
                    pMax: 6000, salinity: 5 });
  return /50000 ppm NaCl equivalent \(5\.000 wt%\)/.test(
    E.generate(g, 'cmg', 'field').split('\n').filter(function (l) { return /Brine salinity/.test(l); })[0]);
})());
ok('water properties still respond to salinity', (function () {
  var fresh = M.build({ api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMax: 6000, salinity: 0.1 });
  var briny = M.build({ api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMax: 6000, salinity: 20 });
  return briny.rhoWsc > fresh.rhoWsc && briny.water[0].muw > fresh.water[0].muw;
})());

section('20. Robustness across a gas sweep');
ok('every gas case builds finite, positive tables', (function () {
  var bad = [];
  ['dry', 'wet'].forEach(function (kind) {
    [0.56, 0.65, 0.8, 0.95].forEach(function (g) {
      [120, 200, 300].forEach(function (t) {
        [5, 25, 60].forEach(function (cgr) {
          [[0, 0, 0], [0.06, 0.10, 0.02]].forEach(function (inert) {
            try {
              var m = M.build({ fluid: 'gas', gasKind: kind, gammaG: g, tempF: t, cgr: cgr, apiC: 50,
                                pMin: 150, pMax: 8000, tSepF: 80, pSepPsia: 314.7,
                                yCO2: inert[0], yH2S: inert[1], yN2: inert[2] });
              var fine = m.gas.every(function (r) {
                return r.bg > 0 && r.eg > 0 && r.z > 0.2 && r.mug > 0 && isFinite(r.cg) && r.rv >= 0;
              });
              var e = FS.phaseEnvelope(m);
              var decks = E.generate(m, 'cmg', 'field').length > 500 && E.generate(m, 'eclipse', 'metric').length > 500;
              if (!fine || !isFinite(e.tct) || !isFinite(e.pc) || !decks) bad.push([kind, g, t, cgr].join('/'));
            } catch (ex) { bad.push([kind, g, t, cgr, ex.message].join('/')); }
          });
        });
      });
    });
  });
  if (bad.length) console.log('     ' + bad.slice(0, 5).join('\n     '));
  return bad.length === 0;
})());


section('21. Laboratory data: tuning and correlation ranking');
(function () {
  var base = { api: 35, gammaG: 0.75, rsb: 600, tempF: 180, tSepF: 80, pSepPsia: 114.7, pMax: 6000 };
  var clone = function (o, extra) { var r = JSON.parse(JSON.stringify(o)); for (var k in extra) r[k] = extra[k]; return r; };

  /* no tuning = the published correlations, bit for bit */
  var m0 = M.build(base), m1 = M.build(clone(base, { tuning: { pbMult: 1, boMult: 1 } }));
  ok('unit multipliers leave the model unchanged',
     m0.pb === m1.pb && m0.oil.every(function (r, i) { return r.bo === m1.oil[i].bo && r.muo === m1.oil[i].muo; }));
  ok('an untuned model reports no tuning', m0.tuning === null);

  /* model.at() is the table's own evaluator */
  ok('model.at(p) reproduces every oil and gas table row', m0.oil.every(function (r, i) {
    var a = m0.at(r.p), g = m0.gas[i];
    return Math.abs(a.bo - r.bo) < 1e-12 && Math.abs(a.rs - r.rs) < 1e-9 &&
           Math.abs(a.muo - r.muo) < 1e-12 && Math.abs(a.z - g.z) < 1e-12 && Math.abs(a.mug - g.mug) < 1e-15;
  }));
  ok('model.at is not serialised into the JSON export', !/"at"/.test(E.generate(m0, 'json', 'field')));

  /* each multiplier does what it says */
  var t = M.build(clone(base, { tuning: { pbMult: 1.1, boMult: 0.9, muodMult: 1.3, tpcMult: 1.02, mugMult: 1.1 } }));
  near('pbMult stretches Pb', t.pb, m0.pbCalc * 1.1, 1e-9);
  near('boMult scales Bob - 1', t.bob - 1, 0.9 * (C.BO.standing(600, { api: 35, gammaG: 0.75, tempF: 180, tSepF: 80, pSepPsia: 114.7 }) - 1), 1e-9);
  near('muodMult scales the dead-oil viscosity', t.muod, m0.muod * 1.3, 1e-12);
  near('tpcMult scales Tpc', t.pcrit.tpc, m0.pcrit.tpc * 1.02, 1e-12);
  ok('tuned PVTO still passes the simulator consistency checks',
     !t.warnings.some(function (w) { return /monoton|cross/.test(w); }), t.warnings.join(' | '));

  /* synthetic laboratory data from known multipliers is recovered */
  var truth = { pbMult: 1.12, boMult: 0.93, coMult: 1.4, muodMult: 1.3, muouMult: 0.7,
                tpcMult: 1.03, ppcMult: 0.97, mugMult: 1.08 };
  var ref = M.build(clone(base, { tuning: truth, pointsOnly: true }));
  var rows = [5000, 4000, 3000, ref.pb, 2400, 2000, 1500, 1000, 600, 300, 100].map(function (p) {
    var r = ref.at(p); return { p: p, rs: r.rs, bo: r.bo, muo: r.muo, z: r.z, mug: r.mug };
  });
  var reg = TU.regress(base, { rows: rows });
  Object.keys(truth).forEach(function (k) { near('regression recovers ' + k, reg.tuning[k], truth[k], 2e-3); });
  ok('every property fits to better than 0.1 % AARE after tuning', Object.keys(reg.after).every(function (k) {
    return !reg.after[k].n || reg.after[k].aare < 0.1;
  }));

  var reg2 = TU.regress(base, { pb: 2750, muod: 3.1, rows: rows });
  near('a measured Pb is honoured exactly', M.build(clone(base, { tuning: reg2.tuning })).pb, 2750, 1e-9);
  near('a measured dead-oil viscosity is honoured exactly', M.build(clone(base, { tuning: reg2.tuning })).muod, 3.1, 1e-9);
  ok('Pb specified as an input is not moved by the regression',
     TU.regress(clone(base, { spec: 'pb', pbMeas: 2500 }), { pb: 2800, rows: rows }).tuning.pbMult === 1);

  /* tuning never worsens the fit: a wrong correlation gets multiplier 1 or better */
  var worst = TU.regress(clone(base, { corr: { pb: 'petroskyFarshad' } }), { rows: rows });
  ok('tuned AARE never exceeds untuned AARE', Object.keys(worst.after).every(function (k) {
    var a = worst.after[k], b = worst.before[k];
    return !a.n || !b.n || a.n !== b.n || a.aare <= b.aare + 1e-9;
  }));

  /* ranking: the generating correlation wins its family */
  var sc = TU.screen(base, { rows: rows });
  var fam = function (c) { return sc.filter(function (f) { return f.corr === c; })[0]; };
  ok('ranking picks the correlation the data came from for Rs', fam('pb').best === 'standing', fam('pb') && fam('pb').best);
  ok('ranking picks the correlation the data came from for Bo', fam('bo').best === 'standing', fam('bo') && fam('bo').best);
  ok('ranking covers all nine oil-mode families', sc.length === 9, sc.length);

  /* gas reservoir */
  var gi = { fluid: 'gas', gasKind: 'wet', gammaG: 0.68, cgr: 12, apiC: 58, tempF: 230, pMax: 6000 };
  var gref = M.build(clone(gi, { tuning: { tpcMult: 0.97, ppcMult: 1.04, mugMult: 0.9 }, pointsOnly: true }));
  var grows = [500, 1500, 3000, 4500, 6000].map(function (p) { var q = gref.at(p); return { p: p, z: q.z, mug: q.mug }; });
  var greg = TU.regress(gi, { rows: grows });
  near('gas: Tpc multiplier recovered', greg.tuning.tpcMult, 0.97, 2e-3);
  near('gas: Ppc multiplier recovered', greg.tuning.ppcMult, 1.04, 2e-3);
  near('gas: viscosity multiplier recovered', greg.tuning.mugMult, 0.9, 2e-3);
  var gm = M.build(clone(gi, { tuning: greg.tuning }));
  ok('gas: tuned z carries into Bg and Eg = 1/Bg', gm.gas.every(function (r) {
    return Math.abs(r.eg * r.bg - 1) < 1e-12 && Math.abs(r.bg - r.bgw * gm.fws) < 1e-15;
  }));
  ok('gas: oil-only laboratory columns are ignored', TU.normalize({ pb: 3000, rows: [{ p: 1000, bo: 1.2 }] }, 'gas').rows.length === 0);

  /* decks record the tuning */
  var tm = M.build(clone(base, { tuning: { pbMult: 1.1, fit: [{ label: 'Solution GOR', n: 9, before: 8.7, after: 0.4 }] } }));
  var deck = E.generate(tm, 'eclipse', 'field'), cdeck = E.generate(gm, 'cmg', 'field');
  ok('ECLIPSE header lists the multipliers and the fit',
     /TUNED TO LABORATORY DATA/.test(deck) && /Pb \/ Rs\(p\) stretch\s+: x 1\.1000/.test(deck) && /8\.70 -> 0\.40/.test(deck));
  ok('CMG gas header lists the multipliers', /\*\* TUNED TO LABORATORY DATA/.test(cdeck) && /Pseudo-critical T/.test(cdeck));
  ok('an untuned deck has no tuning block', !/TUNED TO LABORATORY/.test(E.generate(m0, 'eclipse', 'field')));

  /* spreadsheet paste */
  var pr = TU.parseTable('Pressure\tRs\tBo\npsia\tscf/STB\trb/STB\n3000\t600\t1.31\n2000\t\t1.25\n', ['p', 'rs', 'bo']);
  ok('pasted table: header and unit rows skipped, blanks kept as null',
     pr.length === 2 && pr[0].p === 3000 && pr[1].rs === null && pr[1].bo === 1.25, JSON.stringify(pr));
  ok('1-D minimiser finds a bracketed minimum',
     Math.abs(TU.minimize1D(function (m) { return Math.abs(Math.log(m / 1.37)); }, 0.5, 2).value - 1.37) < 1e-3);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
