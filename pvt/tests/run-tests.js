/*
 * run-tests.js -- regression tests for the PVT correlation library.
 *   node pvt/tests/run-tests.js
 *
 * Reference values were produced from an independent implementation of the
 * published equations; the remaining tests assert the physical invariants a
 * reservoir simulator relies on (monotonicity, continuity at the bubble point,
 * deck structure and unit conversions).
 */
'use strict';
var C = require('../js/correlations.js');
var M = require('../js/pvt-model.js');
var E = require('../js/export.js');

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
  return /P1-Calculator PVT tool/.test(ecl) && /P1-Calculator PVT tool/.test(imex) &&
         /P1-Calculator PVT tool/.test(csv) && /CORRELATIONS/.test(ecl);
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
