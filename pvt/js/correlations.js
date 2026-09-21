/*
 * correlations.js -- Black-oil PVT correlations for oil, gas and formation water.
 *
 * All functions are pure and work in FIELD units unless stated otherwise:
 *   pressure      psia
 *   temperature   degF (deg R where noted)
 *   Rs, Rsb       scf/STB
 *   Bo            bbl/STB      Bg   ft3/scf (and bbl/scf)
 *   viscosity     cp           density  lbm/ft3
 *   compressibility  1/psi
 *
 * References are given per correlation; page-level documentation lives in
 * pvt/README.md.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PVTCorr = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TZERO = 459.67;          // degF -> degR
  var AIR_MW = 28.9625;        // lbm/lbmol
  var RHO_AIR_SC = 0.0763;     // lbm/ft3 at 60 degF, 14.696 psia

  function log10(x) { return Math.log(x) / Math.LN10; }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function apiToSg(api) { return 141.5 / (api + 131.5); }
  function sgToApi(sg) { return 141.5 / sg - 131.5; }

  /* ------------------------------------------------------------------ *
   * 1. Bubble-point pressure / solution GOR
   *
   * Every correlation is expressed as pb(Rs). Rs(p) is then obtained by
   * bisection on that monotonic function, which guarantees Rs(pb) = Rsb
   * exactly and keeps the saturated branch self-consistent (for Standing,
   * Vasquez-Beggs and Petrosky-Farshad this is identical to their published
   * explicit Rs forms).
   * ------------------------------------------------------------------ */

  /* Separator-corrected gas gravity used by Vasquez & Beggs (1980):
     gas gravity normalised to a 100 psig separator. */
  function vbGasGravity(gammaG, api, tSepF, pSepPsia) {
    if (!(tSepF > 0) || !(pSepPsia > 0)) return gammaG;
    return gammaG * (1 + 5.912e-5 * api * tSepF * log10(pSepPsia / 114.7));
  }

  var PB = {
    /* Standing, M.B. (1947) -- California crudes. */
    standing: function (rs, s) {
      var x = 0.00091 * s.tempF - 0.0125 * s.api;
      return 18.2 * (Math.pow(Math.max(rs, 1e-9) / s.gammaG, 0.83) * Math.pow(10, x) - 1.4);
    },
    /* Vasquez, M.E. & Beggs, H.D. (1980) -- worldwide data bank. */
    vasquezBeggs: function (rs, s) {
      var g = vbGasGravity(s.gammaG, s.api, s.tSepF, s.pSepPsia);
      var c = s.api <= 30 ? [0.0362, 1.0937, 25.7240] : [0.0178, 1.1870, 23.9310];
      var a = c[2] * s.api / (s.tempF + TZERO);
      return Math.pow(Math.max(rs, 1e-9) / (c[0] * g * Math.exp(a)), 1 / c[1]);
    },
    /* Glaso, O. (1980) -- North Sea crudes. */
    glaso: function (rs, s) {
      var pbStar = Math.pow(Math.max(rs, 1e-9) / s.gammaG, 0.816) *
        Math.pow(s.tempF, 0.172) / Math.pow(s.api, 0.989);
      var x = log10(pbStar);
      return Math.pow(10, 1.7669 + 1.7447 * x - 0.30218 * x * x);
    },
    /* Al-Marhoun, M.A. (1988) -- Middle East crudes. */
    alMarhoun: function (rs, s) {
      var tR = s.tempF + TZERO;
      return 5.38088e-3 * Math.pow(Math.max(rs, 1e-9), 0.715082) *
        Math.pow(s.gammaG, -1.87784) * Math.pow(apiToSg(s.api), 3.1437) *
        Math.pow(tR, 1.32657);
    },
    /* Petrosky, G.E. & Farshad, F.F. (1993) -- Gulf of Mexico crudes. */
    petroskyFarshad: function (rs, s) {
      /* x rises with API and falls with temperature: a lighter oil dissolves
         gas more readily, so the same Rs saturates at a lower pressure. */
      var x = 7.916e-4 * Math.pow(s.api, 1.5410) - 4.561e-5 * Math.pow(s.tempF, 1.3911);
      return 112.727 * Math.pow(Math.max(rs, 1e-9), 0.5774) /
        (Math.pow(s.gammaG, 0.8439) * Math.pow(10, x)) - 1391.051;
    },
    /* Lasater, J.A. (1958) -- physically based (gas mole fraction). */
    lasater: function (rs, s) {
      var sgO = apiToSg(s.api);
      var mo = s.api <= 40 ? 630 - 10 * s.api : 73110 * Math.pow(s.api, -1.562);
      var nG = Math.max(rs, 1e-9) / 379.3;
      var yg = nG / (nG + 350 * sgO / mo);
      yg = clamp(yg, 1e-9, 0.99);
      var pf = yg <= 0.6 ? 0.679 * Math.exp(2.786 * yg) - 0.323
                         : 8.26 * Math.pow(yg, 3.56) + 1.95;
      return pf * (s.tempF + TZERO) / s.gammaG;
    }
  };

  /* Solution GOR at pressure p (p <= pb) by inversion of pb(Rs). */
  function solutionGor(name, p, s) {
    var f = PB[name];
    if (p >= s.pb) return s.rsb;
    var lo = 0, hi = s.rsb, mid;
    if (f(lo, s) >= p) return 0;
    for (var i = 0; i < 80; i++) {
      mid = 0.5 * (lo + hi);
      if (f(mid, s) < p) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /* ------------------------------------------------------------------ *
   * 2. Oil formation volume factor (saturated branch)
   * ------------------------------------------------------------------ */
  var BO = {
    standing: function (rs, s) {
      var f = rs * Math.sqrt(s.gammaG / apiToSg(s.api)) + 1.25 * s.tempF;
      return 0.9759 + 1.2e-4 * Math.pow(f, 1.2);
    },
    vasquezBeggs: function (rs, s) {
      var g = vbGasGravity(s.gammaG, s.api, s.tSepF, s.pSepPsia);
      var c = s.api <= 30 ? [4.677e-4, 1.751e-5, -1.811e-8]
                          : [4.670e-4, 1.100e-5, 1.337e-9];
      var r = s.api / g;
      return 1 + c[0] * rs + c[1] * (s.tempF - 60) * r + c[2] * rs * (s.tempF - 60) * r;
    },
    glaso: function (rs, s) {
      var bStar = rs * Math.pow(s.gammaG / apiToSg(s.api), 0.526) + 0.968 * s.tempF;
      var x = log10(bStar);
      return 1 + Math.pow(10, -6.58511 + 2.91329 * x - 0.27683 * x * x);
    },
    alMarhoun: function (rs, s) {
      var tR = s.tempF + TZERO;
      var f = Math.pow(Math.max(rs, 0), 0.742390) * Math.pow(s.gammaG, 0.323294) *
        Math.pow(apiToSg(s.api), -1.202040);
      return 0.497069 + 0.862963e-3 * tR + 0.182594e-2 * f + 0.318099e-5 * f * f;
    },
    petroskyFarshad: function (rs, s) {
      var f = Math.pow(Math.max(rs, 0), 0.3738) *
        (Math.pow(s.gammaG, 0.2914) / Math.pow(apiToSg(s.api), 0.6265)) +
        0.24626 * Math.pow(s.tempF, 0.5371);
      return 1.0113 + 7.2046e-5 * Math.pow(f, 3.0936);
    }
  };

  /* ------------------------------------------------------------------ *
   * 3. Undersaturated oil compressibility, 1/psi
   * ------------------------------------------------------------------ */
  var CO = {
    vasquezBeggs: function (p, s) {
      var g = vbGasGravity(s.gammaG, s.api, s.tSepF, s.pSepPsia);
      return (-1433 + 5 * s.rsb + 17.2 * s.tempF - 1180 * g + 12.61 * s.api) / (1e5 * p);
    },
    petroskyFarshad: function (p, s) {
      return 1.705e-7 * Math.pow(Math.max(s.rsb, 1e-9), 0.69357) *
        Math.pow(s.gammaG, 0.1885) * Math.pow(s.api, 0.3272) *
        Math.pow(s.tempF, 0.6729) * Math.pow(p, -0.5906);
    },
    /* McCain, W.D., Rollins, J.B. & Villena-Lanzi, A.J. (1988) */
    mccain: function (p, s) {
      var ln = -7.573 - 1.450 * Math.log(p) - 0.383 * Math.log(Math.max(s.pb, 1)) +
        1.402 * Math.log(s.tempF + TZERO) + 0.256 * Math.log(s.api) +
        0.449 * Math.log(Math.max(s.rsb, 1e-9));
      return Math.exp(ln);
    }
  };

  /* ------------------------------------------------------------------ *
   * 4. Oil viscosity
   * ------------------------------------------------------------------ */
  var MU_OD = {
    beggsRobinson: function (s) {
      var z = 3.0324 - 0.02023 * s.api;
      var x = Math.pow(10, z) * Math.pow(s.tempF, -1.163);
      return Math.pow(10, x) - 1;
    },
    beal: function (s) {
      var a = Math.pow(10, 0.43 + 8.33 / s.api);
      return (0.32 + 1.8e7 / Math.pow(s.api, 4.53)) *
        Math.pow(360 / (s.tempF + 200), a);
    },
    glaso: function (s) {
      return 3.141e10 * Math.pow(s.tempF, -3.444) *
        Math.pow(log10(s.api), 10.313 * log10(s.tempF) - 36.447);
    },
    ngEgbogah: function (s) {
      var y = 1.8653 - 0.025086 * s.api - 0.5644 * log10(s.tempF);
      return Math.pow(10, Math.pow(10, y)) - 1;
    }
  };

  var MU_OB = {
    beggsRobinson: function (muOd, rs) {
      var a = 10.715 * Math.pow(rs + 100, -0.515);
      var b = 5.44 * Math.pow(rs + 150, -0.338);
      return a * Math.pow(muOd, b);
    },
    chewConnally: function (muOd, rs) {
      var a = Math.pow(10, rs * (2.2e-7 * rs - 7.4e-4));
      var b = 0.68 / Math.pow(10, 8.62e-5 * rs) +
        0.25 / Math.pow(10, 1.1e-3 * rs) +
        0.062 / Math.pow(10, 3.74e-3 * rs);
      return a * Math.pow(muOd, b);
    }
  };

  var MU_OU = {
    vasquezBeggs: function (muOb, p, pb) {
      var m = 2.6 * Math.pow(p, 1.187) * Math.exp(-11.513 - 8.98e-5 * p);
      return muOb * Math.pow(p / pb, m);
    },
    petroskyFarshad: function (muOb, p, pb) {
      var l = log10(muOb);
      var a = -1.0146 + 1.3322 * l - 0.4876 * l * l - 1.15036 * l * l * l;
      return muOb + 1.3449e-3 * (p - pb) * Math.pow(10, a);
    }
  };

  /* ------------------------------------------------------------------ *
   * 5. Gas properties
   * ------------------------------------------------------------------ */

  /* Pseudo-critical properties of the hydrocarbon portion. */
  var PSEUDO_CRIT = {
    standingDry: function (g) {
      return { tpc: 168 + 325 * g - 12.5 * g * g, ppc: 677 + 15.0 * g - 37.5 * g * g };
    },
    standingWet: function (g) {
      return { tpc: 187 + 330 * g - 71.5 * g * g, ppc: 706 - 51.7 * g - 11.1 * g * g };
    },
    sutton: function (g) {
      return { tpc: 169.2 + 349.5 * g - 74.0 * g * g, ppc: 756.8 - 131.0 * g - 3.6 * g * g };
    }
  };

  /* Wichert & Aziz (1972) acid-gas correction (N2 handled by mole-fraction mixing). */
  function wichertAziz(tpc, ppc, yCO2, yH2S) {
    var a = yCO2 + yH2S, b = yH2S;
    if (a <= 0) return { tpc: tpc, ppc: ppc, eps: 0 };
    var eps = 120 * (Math.pow(a, 0.9) - Math.pow(a, 1.6)) +
      15 * (Math.pow(b, 0.5) - Math.pow(b, 4));
    var tpcC = tpc - eps;
    return { tpc: tpcC, ppc: ppc * tpcC / (tpc + b * (1 - b) * eps), eps: eps };
  }

  /* Carr, Kobayashi & Burrows (1954) non-hydrocarbon corrections. */
  function carrCorrection(tpc, ppc, yCO2, yH2S, yN2) {
    return {
      tpc: tpc - 80 * yCO2 + 130 * yH2S - 250 * yN2,
      ppc: ppc + 440 * yCO2 + 600 * yH2S - 170 * yN2,
      eps: 0
    };
  }

  /* Pseudo-criticals including non-hydrocarbons.
     g   = total gas gravity (air = 1), y* = mole fractions of inerts. */
  function pseudoCriticals(g, opt) {
    opt = opt || {};
    var yCO2 = opt.yCO2 || 0, yH2S = opt.yH2S || 0, yN2 = opt.yN2 || 0;
    var yInert = yCO2 + yH2S + yN2;
    var base = PSEUDO_CRIT[opt.method || 'sutton'];
    var out;
    if (opt.correction === 'carr') {
      out = base(g);
      out = carrCorrection(out.tpc, out.ppc, yCO2, yH2S, yN2);
    } else {
      /* Kay mixing: strip inerts, evaluate the HC fraction at its own gravity,
         recombine, then apply Wichert-Aziz to the acid gases. */
      var mwInert = 44.010 * yCO2 + 34.082 * yH2S + 28.0134 * yN2;
      var yHC = 1 - yInert;
      var gHC = yHC > 1e-6 ? (g * AIR_MW - mwInert) / (yHC * AIR_MW) : g;
      gHC = clamp(gHC, 0.55, 1.8);
      var hc = base(gHC);
      var tpc = yHC * hc.tpc + yCO2 * 547.58 + yH2S * 672.35 + yN2 * 227.16;
      var ppc = yHC * hc.ppc + yCO2 * 1071.0 + yH2S * 1300.0 + yN2 * 492.8;
      out = wichertAziz(tpc, ppc, yCO2, yH2S);
    }
    return out;
  }

  /* Gas deviation factor. */
  var ZFACTOR = {
    /* Dranchuk & Abou-Kassem (1975) fit of the Standing-Katz chart.
       Solved for reduced density with a bounded Newton iteration and a
       bracket-and-bisect fallback - successive substitution on z oscillates
       between roots above about Ppr = 8. */
    dak: function (ppr, tpr) {
      var A = [0.3265, -1.0700, -0.5339, 0.01569, -0.05165, 0.5475,
               -0.7361, 0.1844, 0.1056, 0.6134, 0.7210];
      var t3 = tpr * tpr * tpr;
      var c1 = A[0] + A[1] / tpr + A[2] / t3 + A[3] / Math.pow(tpr, 4) + A[4] / Math.pow(tpr, 5);
      var c2 = A[5] + A[6] / tpr + A[7] / (tpr * tpr);
      var c3 = A[8] * (A[6] / tpr + A[7] / (tpr * tpr));
      var k = 0.27 * ppr / tpr;          /* = rho_r * z */
      function fn(r) {
        var u = A[10] * r * r;
        return -k / r + 1 + c1 * r + c2 * r * r - c3 * Math.pow(r, 5) +
          A[9] * (1 + u) * (r * r / t3) * Math.exp(-u);
      }
      function dfn(r) {
        var u = A[10] * r * r;
        return k / (r * r) + c1 + 2 * c2 * r - 5 * c3 * Math.pow(r, 4) +
          (A[9] / t3) * Math.exp(-u) * 2 * r * (1 + u - u * u);
      }
      var r = clamp(k, 1e-4, 2.2), i;
      for (i = 0; i < 100; i++) {
        var f0 = fn(r), d0 = dfn(r);
        if (!isFinite(f0) || !isFinite(d0) || d0 === 0) break;
        var rn = r - f0 / d0;
        if (!(rn > 1e-8) || rn > 3) rn = 0.5 * (r + (rn > 3 ? 3 : 1e-8));
        if (Math.abs(rn - r) < 1e-13) { r = rn; break; }
        r = rn;
      }
      if (!(r > 0) || !isFinite(r) || Math.abs(fn(r)) > 1e-8) {
        /* first sign change from the low-density side is the physical root */
        var lo = 1e-6, fl = fn(lo), hi, found = false;
        for (hi = 0.005; hi <= 3.0; hi += 0.005) {
          var fh = fn(hi);
          if (fl * fh <= 0) { found = true; break; }
          lo = hi; fl = fh;
        }
        if (found) {
          for (i = 0; i < 200; i++) {
            var mid = 0.5 * (lo + hi);
            if (fl * fn(mid) <= 0) hi = mid; else { lo = mid; fl = fn(mid); }
          }
          r = 0.5 * (lo + hi);
        }
      }
      return k / r;
    },
    /* Hall & Yarborough (1973). */
    hallYarborough: function (ppr, tpr) {
      var t = 1 / tpr;
      var a = 0.06125 * t * Math.exp(-1.2 * (1 - t) * (1 - t));
      var y = 0.001, i, f, df;
      for (i = 0; i < 200; i++) {
        var om = 1 - y;
        f = -a * ppr + (y + y * y + y * y * y - Math.pow(y, 4)) / Math.pow(om, 3) -
          (14.76 * t - 9.76 * t * t + 4.58 * t * t * t) * y * y +
          (90.7 * t - 242.2 * t * t + 42.4 * t * t * t) * Math.pow(y, 2.18 + 2.82 * t);
        df = (1 + 4 * y + 4 * y * y - 4 * y * y * y + Math.pow(y, 4)) / Math.pow(om, 4) -
          2 * (14.76 * t - 9.76 * t * t + 4.58 * t * t * t) * y +
          (2.18 + 2.82 * t) * (90.7 * t - 242.2 * t * t + 42.4 * t * t * t) *
          Math.pow(y, 1.18 + 2.82 * t);
        var dy = f / df;
        if (y - dy <= 0 || y - dy >= 1) dy = 0.5 * (y - (dy > 0 ? 1e-6 : 0.999));
        y -= dy;
        if (Math.abs(dy) < 1e-12) break;
      }
      return a * ppr / y;
    },
    /* Beggs & Brill (1973) explicit approximation. */
    beggsBrill: function (ppr, tpr) {
      var a = 1.39 * Math.sqrt(Math.max(tpr - 0.92, 1e-6)) - 0.36 * tpr - 0.101;
      var b = (0.62 - 0.23 * tpr) * ppr +
        (0.066 / (tpr - 0.86) - 0.037) * ppr * ppr +
        0.32 * Math.pow(ppr, 6) / Math.pow(10, 9 * (tpr - 1));
      var c = 0.132 - 0.32 * log10(tpr);
      var d = Math.pow(10, 0.3106 - 0.49 * tpr + 0.1824 * tpr * tpr);
      return a + (1 - a) / Math.exp(clamp(b, -50, 50)) + c * Math.pow(ppr, d);
    }
  };

  function gasZ(method, p, tempF, gammaG, opt) {
    var pc = opt && opt._pc ? opt._pc : pseudoCriticals(gammaG, opt);
    var tpr = (tempF + TZERO) / pc.tpc;
    var ppr = p / pc.ppc;
    return ZFACTOR[method](ppr, tpr);
  }

  /* Gas FVF, ft3/scf (standard conditions 14.696 psia, 60 degF). */
  function gasBg(z, p, tempF) { return 0.0282793 * z * (tempF + TZERO) / p; }
  /* Gas density, lbm/ft3. */
  function gasDensity(z, p, tempF, gammaG) {
    return 2.69882 * gammaG * p / (z * (tempF + TZERO));
  }
  /* Isothermal gas compressibility, 1/psi (numerical dZ/dp). */
  function gasCompressibility(method, p, tempF, gammaG, opt) {
    var dp = Math.max(0.5, 1e-3 * p);
    var z = gasZ(method, p, tempF, gammaG, opt);
    var zp = gasZ(method, p + dp, tempF, gammaG, opt);
    var zm = gasZ(method, Math.max(p - dp, 1e-3), tempF, gammaG, opt);
    return 1 / p - (zp - zm) / (2 * dp) / z;
  }

  var MU_G = {
    /* Lee, A.L., Gonzalez, M.H. & Eakin, B.E. (1966). */
    leeGonzalezEakin: function (rhoG, tempF, gammaG) {
      var tR = tempF + TZERO, m = AIR_MW * gammaG;
      var k = (9.4 + 0.02 * m) * Math.pow(tR, 1.5) / (209 + 19 * m + tR);
      var x = 3.5 + 986 / tR + 0.01 * m;
      var y = 2.4 - 0.2 * x;
      return 1e-4 * k * Math.exp(x * Math.pow(rhoG / 62.428, y));
    },
    /* Carr, Kobayashi & Burrows (1954) with the Dempsey (1965) polynomial. */
    carrKobayashiBurrows: function (ppr, tpr, tempF, gammaG, opt) {
      opt = opt || {};
      var mu1 = (1.709e-5 - 2.062e-6 * gammaG) * tempF + 8.188e-3 - 6.15e-3 * log10(gammaG);
      mu1 += (opt.yN2 || 0) * (8.48e-3 * log10(gammaG) + 9.59e-3);
      mu1 += (opt.yCO2 || 0) * (9.08e-3 * log10(gammaG) + 6.24e-3);
      mu1 += (opt.yH2S || 0) * (8.49e-3 * log10(gammaG) + 3.73e-3);
      var a = [-2.46211820, 2.97054714, -0.28626405, 0.00805420,
                2.80860949, -3.49803305, 0.36037302, -0.01044324,
               -0.79338568, 1.39643306, -0.14914493, 0.00441016,
                0.08393872, -0.18640885, 0.02033679, -0.00060958];
      var p1 = ppr, p2 = ppr * ppr, p3 = p2 * ppr;
      var s = a[0] + a[1] * p1 + a[2] * p2 + a[3] * p3 +
        tpr * (a[4] + a[5] * p1 + a[6] * p2 + a[7] * p3) +
        tpr * tpr * (a[8] + a[9] * p1 + a[10] * p2 + a[11] * p3) +
        tpr * tpr * tpr * (a[12] + a[13] * p1 + a[14] * p2 + a[15] * p3);
      return mu1 * Math.exp(s) / tpr;
    }
  };

  /* ------------------------------------------------------------------ *
   * 6. Formation water (McCain, 1991 / Osif, 1988 / Meehan)
   *    salinity in weight % NaCl equivalent
   * ------------------------------------------------------------------ */
  function waterBw(p, tempF) {
    var dVt = -1.0001e-2 + 1.33391e-4 * tempF + 5.50654e-7 * tempF * tempF;
    var dVp = -1.95301e-9 * p * tempF - 1.72834e-13 * p * p * tempF -
      3.58922e-7 * p - 2.25341e-10 * p * p;
    return (1 + dVp) * (1 + dVt);
  }
  function waterDensitySC(saltWtPct) {
    return 62.368 + 0.438603 * saltWtPct + 1.60074e-3 * saltWtPct * saltWtPct;
  }
  function waterViscosity(p, tempF, saltWtPct) {
    var s = saltWtPct;
    var a = 109.574 - 8.40564 * s + 0.313314 * s * s + 8.72213e-3 * s * s * s;
    var b = -1.12166 + 2.63951e-2 * s - 6.79461e-4 * s * s -
      5.47119e-5 * s * s * s + 1.55586e-6 * Math.pow(s, 4);
    var mu1 = a * Math.pow(tempF, b);
    return mu1 * (0.9994 + 4.0295e-5 * p + 3.1062e-9 * p * p);
  }
  function waterCompressibility(p, tempF, saltWtPct) {
    /* Osif (1988): salt concentration in g/L of solution. */
    var cNaCl = saltWtPct / 100 * waterDensitySC(saltWtPct) / 62.428 * 1000;
    return 1 / (7.033 * p + 541.5 * cNaCl - 537 * tempF + 403300);
  }

  /* ------------------------------------------------------------------ *
   * 7. Applicability ranges (for input QC warnings)
   * ------------------------------------------------------------------ */
  var RANGES = {
    standing:        { api: [16.5, 63.8], tempF: [100, 258], rsb: [20, 1425],  pb: [130, 7000],  gammaG: [0.59, 0.95] },
    vasquezBeggs:    { api: [15.3, 59.5], tempF: [75, 294],  rsb: [0, 2199],   pb: [15, 6055],   gammaG: [0.51, 1.35] },
    glaso:           { api: [22.3, 48.1], tempF: [80, 280],  rsb: [90, 2637],  pb: [165, 7142],  gammaG: [0.65, 1.28] },
    alMarhoun:       { api: [19.4, 44.6], tempF: [74, 240],  rsb: [26, 1602],  pb: [130, 3573],  gammaG: [0.75, 1.37] },
    petroskyFarshad: { api: [16.3, 45.0], tempF: [114, 288], rsb: [21, 1885],  pb: [1574, 6523], gammaG: [0.58, 0.85] },
    lasater:         { api: [17.9, 51.1], tempF: [82, 272],  rsb: [3, 2905],   pb: [48, 5780],   gammaG: [0.574, 1.223] },
    beggsRobinson:   { api: [16, 58],     tempF: [70, 295],  rsb: [20, 2070] },
    beal:            { api: [10.1, 52.5], tempF: [98, 250] },
    ngEgbogah:       { api: [5, 58],      tempF: [59, 176] },
    chewConnally:    { rsb: [51, 3544],   tempF: [72, 292] },
    mccain:          { api: [18, 52],     tempF: [78, 330],  rsb: [15, 1947],  pb: [500, 5300] }
  };

  return {
    /* constants + helpers */
    TZERO: TZERO, AIR_MW: AIR_MW, RHO_AIR_SC: RHO_AIR_SC,
    apiToSg: apiToSg, sgToApi: sgToApi, log10: log10,
    /* oil */
    PB: PB, BO: BO, CO: CO, MU_OD: MU_OD, MU_OB: MU_OB, MU_OU: MU_OU,
    vbGasGravity: vbGasGravity, solutionGor: solutionGor,
    oilDensity: function (rs, bo, gammaG, api) {
      return (62.428 * apiToSg(api) + 0.01357 * rs * gammaG) / bo;
    },
    /* gas */
    PSEUDO_CRIT: PSEUDO_CRIT, ZFACTOR: ZFACTOR, MU_G: MU_G,
    pseudoCriticals: pseudoCriticals, wichertAziz: wichertAziz,
    gasZ: gasZ, gasBg: gasBg, gasDensity: gasDensity,
    gasCompressibility: gasCompressibility,
    /* water */
    waterBw: waterBw, waterDensitySC: waterDensitySC,
    waterViscosity: waterViscosity, waterCompressibility: waterCompressibility,
    /* metadata */
    RANGES: RANGES
  };
});
