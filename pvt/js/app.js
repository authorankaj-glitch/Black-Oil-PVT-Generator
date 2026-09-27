/*
 * Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. MIT licence (see LICENSE).
 *
 * app.js -- UI wiring for the PVT generator.
 *
 * Two fluid systems share one page: an oil reservoir (black oil with its
 * solution gas) and a gas reservoir (dry gas or wet gas).
 * The Oil / Gas switch swaps the inputs, presets, charts, tables, exports and
 * the two cursor-linked pictures; each fluid keeps its own inputs.
 *
 * Inputs are held in FIELD units internally; the unit toggle converts what is
 * shown (inputs, charts, tables) and the export panel writes decks in either
 * unit system independently.
 *
 * Laboratory data (Lab data & tuning tab) is held per fluid, also in field
 * units. With tuning switched on, every recompute regresses the selected
 * correlations against it (tuning.js) and the tuned model feeds the charts,
 * tables and exports; the untuned model is kept for the match charts.
 *
 * The PVT samples tab holds several PVT reports (samples.js screens them
 * and fits one set of multipliers to the accepted ones). With its field-wide
 * tuning switched on, that tuning takes precedence over the Lab data tab.
 */
(function () {
  'use strict';

  var C = window.PVTCorr, Model = window.PVTModel, Exp = window.PVTExport, Chart = window.PVTChart;
  var FS = window.PVTFluidState, Vis = window.PVTVisuals, Tune = window.PVTTuning;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- unit handling ---------------- */
  var U = {
    field: {
      p: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'psia', d: 0 },
      T: { f: function (x) { return x; }, inv: function (x) { return x; }, u: '°F', d: 1 },
      rs: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'scf/STB', d: 1 },
      bo: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'bbl/STB', d: 4 },
      bg: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'ft³/scf', d: 5 },
      rho: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'lb/ft³', d: 3 },
      c: { f: function (x) { return x; }, inv: function (x) { return x; }, u: '1/psi', d: -1 },
      mu: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'cp', d: 4 },
      cgr: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'STB/MMscf', d: 2 },
      len: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'ft', d: 0 },
      none: { f: function (x) { return x; }, inv: function (x) { return x; }, u: '\u2013', d: 4 }
    },
    metric: {
      p: { f: function (x) { return x * 0.0689475729; }, inv: function (x) { return x / 0.0689475729; }, u: 'bara', d: 1 },
      T: { f: function (x) { return (x - 32) / 1.8; }, inv: function (x) { return x * 1.8 + 32; }, u: '°C', d: 1 },
      rs: { f: function (x) { return x * 0.178107607; }, inv: function (x) { return x / 0.178107607; }, u: 'sm³/sm³', d: 2 },
      bo: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'rm³/sm³', d: 4 },
      bg: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'rm³/sm³', d: 5 },
      rho: { f: function (x) { return x * 16.0184634; }, inv: function (x) { return x / 16.0184634; }, u: 'kg/m³', d: 1 },
      c: { f: function (x) { return x / 0.0689475729; }, inv: function (x) { return x * 0.0689475729; }, u: '1/bar', d: -1 },
      mu: { f: function (x) { return x; }, inv: function (x) { return x; }, u: 'mPa·s', d: 4 },
      /* 1 STB/MMscf = 0.158987 m3 / 28316.85 m3 -> 5.614583 sm3 per 1e6 sm3 */
      cgr: { f: function (x) { return x * 5.614583; }, inv: function (x) { return x / 5.614583; }, u: 'sm³/10⁶sm³', d: 2 },
      len: { f: function (x) { return x * 0.3048; }, inv: function (x) { return x / 0.3048; }, u: 'm', d: 1 },
      none: { f: function (x) { return x; }, inv: function (x) { return x; }, u: '–', d: 4 }
    }
  };
  var units = 'field';
  function uu(kind) { return U[units][kind]; }
  function conv(kind, v) { return uu(kind).f(v); }
  function fmt(kind, v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var m = uu(kind), x = m.f(v);
    return m.d < 0 ? x.toExponential(3) : x.toFixed(m.d);
  }
  function label(kind) { return uu(kind).u; }

  /* which input carries which physical kind (null = dimensionless) */
  var INPUT_KIND = {
    api: null, gammaG: null, tempF: 'T', rsb: 'rs', pbMeas: 'p', pSepPsia: 'p',
    tSepF: 'T', yCO2: null, yH2S: null, yN2: null, salinity: null,
    pRefRock: 'p', rockComp: 'c', pMin: 'p', pMax: 'p', nSat: null, nUnsat: null,
    labPb: 'p', labMuod: 'mu', labPRes: 'p', labPwf: 'p', labGor: 'rs',
    cgr: 'cgr', apiC: null
  };

  /* which reservoir fluid the page is modelling: 'oil' or 'gas' */
  var fluid = 'oil';

  /* Brine salinity is entered in ppm (mg NaCl per kg of brine), which is how
     water analyses report it; every correlation takes weight percent. */
  function ppmToWtPct(ppm) { return ppm === null || ppm === undefined ? null : ppm / 1e4; }
  function wtPctToPpm(pct) { return pct === null || pct === undefined ? null : pct * 1e4; }

  /* ---------------- presets (field units) ---------------- */
  var PRESETS = {
    light:    { api: 38, gammaG: 0.72, tempF: 200, rsb: 900, pMin: 100, pMax: 6500, yCO2: 0, yH2S: 0, yN2: 0, salinity: 30000, cPb: 'standing' },
    medium:   { api: 35, gammaG: 0.75, tempF: 180, rsb: 600, pMin: 100, pMax: 6000, yCO2: 0, yH2S: 0, yN2: 0, salinity: 30000, cPb: 'standing' },
    heavy:    { api: 18, gammaG: 0.65, tempF: 130, rsb: 120, pMin: 50, pMax: 3000, yCO2: 0, yH2S: 0, yN2: 0, salinity: 50000, cPb: 'standing' },
    volatile: { api: 45, gammaG: 0.85, tempF: 250, rsb: 1800, pMin: 200, pMax: 8000, yCO2: 1, yH2S: 0, yN2: 0.5, salinity: 20000, cPb: 'glaso' },
    sour:     { api: 30, gammaG: 0.88, tempF: 210, rsb: 500, pMin: 100, pMax: 5500, yCO2: 4, yH2S: 8, yN2: 1, salinity: 80000, cPb: 'vasquezBeggs' },
    northsea: { api: 36, gammaG: 0.78, tempF: 220, rsb: 700, pMin: 100, pMax: 7000, yCO2: 0.5, yH2S: 0, yN2: 0.5, salinity: 35000, cPb: 'glaso' }
  };
  var PRESET_LABELS = {
    oil: [['light', 'Light oil — 38 API, 900 scf/STB'], ['medium', 'Medium oil — 35 API, 600 scf/STB'],
          ['heavy', 'Heavy oil — 18 API, 120 scf/STB'], ['volatile', 'Volatile oil — 45 API, 1800 scf/STB'],
          ['sour', 'Sour medium oil — 30 API, 8% H2S'], ['northsea', 'North Sea oil — 36 API, 700 scf/STB']],
    gas: [['gDry', 'Dry gas — 0.60 gravity, 200 °F'],
          ['gLeanDry', 'Deep dry gas — 0.64 gravity, 300 °F'],
          ['gWet', 'Wet gas — 0.68 gravity, 12 STB/MMscf'],
          ['gRichWet', 'Rich wet gas — 0.74 gravity, 35 STB/MMscf'],
          ['gSour', 'Sour wet gas — 10% H2S, 6% CO2'],
          ['gN2', 'Nitrogen-rich dry gas — 12% N2']]
  };
  var DEFAULT_PRESET = { oil: 'medium', gas: 'gWet' };
  var GAS_PRESETS = {
    gDry:     { gasKind: 'dry', gammaG: 0.60, tempF: 200, cgr: 0, apiC: 55, pMin: 200, pMax: 5000, yCO2: 1, yH2S: 0, yN2: 1, salinity: 30000, tSepF: 80, pSepPsia: 814.7 },
    gLeanDry: { gasKind: 'dry', gammaG: 0.64, tempF: 300, cgr: 0, apiC: 55, pMin: 500, pMax: 9000, yCO2: 2, yH2S: 0, yN2: 2, salinity: 50000, tSepF: 90, pSepPsia: 1014.7 },
    gWet:     { gasKind: 'wet', gammaG: 0.68, tempF: 230, cgr: 12, apiC: 58, pMin: 200, pMax: 6000, yCO2: 2, yH2S: 0, yN2: 0.5, salinity: 30000, tSepF: 80, pSepPsia: 514.7 },
    gRichWet: { gasKind: 'wet', gammaG: 0.74, tempF: 250, cgr: 35, apiC: 52, pMin: 300, pMax: 7000, yCO2: 3, yH2S: 0, yN2: 0.5, salinity: 40000, tSepF: 85, pSepPsia: 614.7 },
    gSour:    { gasKind: 'wet', gammaG: 0.78, tempF: 260, cgr: 8, apiC: 55, pMin: 200, pMax: 7000, yCO2: 6, yH2S: 10, yN2: 1, salinity: 60000, tSepF: 90, pSepPsia: 814.7 },
    gN2:      { gasKind: 'dry', gammaG: 0.66, tempF: 210, cgr: 0, apiC: 55, pMin: 200, pMax: 5500, yCO2: 1, yH2S: 0, yN2: 12, salinity: 40000, tSepF: 80, pSepPsia: 714.7 }
  };

  /* ---------------- input <-> model ---------------- */
  function num(id) { var v = parseFloat($(id).value); return isFinite(v) ? v : null; }

  /* Converting a displayed value back and forth would otherwise drift
     (180 degF -> 82.2 degC -> 180.0 degF). Remember the exact field-unit value
     behind every string this code writes, and reuse it until the user edits
     that input. */
  var exact = {};
  function setInput(id, fieldValue) {
    var k = INPUT_KIND[id];
    var str = fieldValue === null || fieldValue === undefined || fieldValue === ''
      ? '' : trim(k ? U[units][k].f(fieldValue) : fieldValue, k);
    $(id).value = str;
    exact[id] = { shown: str, field: str === '' ? null : fieldValue };
  }
  function toField(id) {
    var raw = $(id).value;
    if (exact[id] && exact[id].shown === raw) return exact[id].field;
    var v = num(id);
    if (v === null) return null;
    var k = INPUT_KIND[id];
    return k ? U[units][k].inv(v) : v;
  }

  function readInputs() {
    return {
      fluid: fluid,
      gasKind: $('gasKind').value, cgr: toField('cgr'), apiC: toField('apiC'),
      api: toField('api'), gammaG: toField('gammaG'), tempF: toField('tempF'),
      spec: $('spec').value,
      rsb: toField('rsb'), pbMeas: toField('pbMeas'),
      tSepF: toField('tSepF'), pSepPsia: toField('pSepPsia'),
      gasType: $('gasType').value,
      yCO2: (toField('yCO2') || 0) / 100, yH2S: (toField('yH2S') || 0) / 100, yN2: (toField('yN2') || 0) / 100,
      /* the correlations take weight percent; the page asks for ppm */
      salinity: ppmToWtPct(toField('salinity')), salinityPpm: toField('salinity'),
      pRefRock: toField('pRefRock'), rockComp: toField('rockComp'),
      pMin: toField('pMin'), pMax: toField('pMax'),
      nSat: Math.round(toField('nSat')), nUnsat: Math.round(toField('nUnsat')),
      corr: {
        pb: $('cPb').value, bo: $('cBo').value, co: $('cCo').value,
        muod: $('cMuod').value, muob: $('cMuob').value, muou: $('cMuou').value,
        pcrit: $('cPcrit').value, inertCorr: $('cInert').value,
        z: $('cZ').value, mug: $('cMug').value
      },
      lab: labForModel(), tune: lab[fluid].tune, labMode: labMode
    };
  }

  function writeInputs(o) {
    Object.keys(o).forEach(function (k) {
      var elm = $(k);
      if (!elm) return;
      if (elm.tagName === 'SELECT') { elm.value = o[k]; return; }
      var v = o[k];
      setInput(k, v === null || v === undefined || v === '' ? null : v);
    });
  }
  function trim(v, kind) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    if (Math.abs(v) > 0 && Math.abs(v) < 1e-3) return v.toExponential(2);
    /* show a converted value at the precision its unit deserves, never
       1.8000000000000003 degC */
    var d = kind ? uu(kind).d : 6;
    if (d < 0) return v.toExponential(3);
    /* keep at least four significant figures */
    var mag = Math.floor(Math.log(Math.abs(v) || 1) / Math.LN10);
    d = Math.max(d, Math.min(6, 3 - mag));
    return String(Number(v.toFixed(d)));
  }

  /* ---------------- rendering ---------------- */
  var model = null, charts = {};
  var barrel = null, phase = null, envelope = null, cursorP = null, playTimer = null;

  function tile(parent, label, value, unit, hero) {
    var d = document.createElement('div');
    d.className = 'tile' + (hero ? ' hero' : '');
    var l = document.createElement('div');
    l.className = 'label'; l.textContent = label;
    var v = document.createElement('div');
    v.className = 'value'; v.textContent = value;
    if (unit) { var s = document.createElement('small'); s.textContent = unit; v.appendChild(s); }
    d.appendChild(l); d.appendChild(v);
    parent.appendChild(d);
  }

  function renderSummary() {
    var t = $('tiles');
    t.textContent = '';
    if (model.fluid === 'gas') renderGasTiles(t);
    else renderOilTiles(t);
    renderQc();
  }

  function renderGasTiles(t) {
    var g = model.gas, top = g[g.length - 1];
    var wet = model.gasKind === 'wet';
    tile(t, 'Fluid type', wet ? 'Wet gas' : 'Dry gas', '', true);
    tile(t, 'z at max pressure', top.z.toFixed(4), '(' + fmt('p', top.p) + ' ' + label('p') + ')');
    tile(t, 'Bg at max pressure', fmt('bg', top.bg), label('bg'));
    tile(t, 'Eg at max pressure', top.eg.toFixed(1), 'scf/ft³');
    tile(t, 'Gas viscosity at max pressure', fmt('mu', top.mug), label('mu'));
    tile(t, 'Gas density at max pressure', fmt('rho', top.rhoG), label('rho'));
    if (wet) {
      tile(t, 'Condensate-gas ratio', fmt('cgr', model.cgr), label('cgr'));
      tile(t, 'Condensate gravity', model.apiC.toFixed(1), '°API');
    }
    tile(t, 'Reservoir-gas gravity', model.gammaW.toFixed(4), 'air = 1');
    tile(t, 'Gas Tpc / Ppc', model.pcrit.tpc.toFixed(0) + ' / ' + model.pcrit.ppc.toFixed(0), '°R, psia');
  }

  function renderOilTiles(t) {
    tile(t, 'Bubble-point pressure', fmt('p', model.pb), label('p'), true);
    tile(t, 'Solution GOR at Pb', fmt('rs', model.rsb), label('rs'));
    tile(t, 'Oil FVF at Pb', fmt('bo', model.bob), label('bo'));
    tile(t, 'Oil viscosity at Pb', fmt('mu', model.muob), label('mu'));
    tile(t, 'Dead-oil viscosity', fmt('mu', model.muod), label('mu'));
    tile(t, 'Oil density at Pb', fmt('rho', model.oil.filter(function (r) { return r.saturated; }).pop().rhoO), label('rho'));
    tile(t, 'co at Pb', fmt('c', model.cob), label('c'));
    tile(t, 'Stock-tank oil density', fmt('rho', model.rhoOsc), label('rho'));
    tile(t, 'Gas Tpc / Ppc', model.pcrit.tpc.toFixed(0) + ' / ' + model.pcrit.ppc.toFixed(0), '°R, psia');
  }

  function renderQc() {
    var qc = $('qc');
    qc.textContent = '';
    if (model.tuning && fieldTuned) {
      qc.appendChild(notice('info', 'i', 'These tables use the field-wide tuning fitted to ' + fieldTuned.perSample.length +
        ' screened PVT sample' + (fieldTuned.perSample.length === 1 ? '' : 's') + ' - the PVT samples & tuning tab shows the screening and the fit.'));
    }
    if (model.tuning && regression) {
      var n = regression.data.rows.length + (regression.data.pb ? 1 : 0) + (regression.data.muod ? 1 : 0);
      qc.appendChild(notice('info', 'i', 'These tables are tuned to ' + n + ' laboratory value' +
        (n === 1 ? '' : 's') + ' - the Lab data & tuning tab shows the multipliers and the fit.'));
    }
    if (!model.warnings.length) {
      qc.appendChild(notice('ok', '✓', 'All inputs lie inside the published range of the selected correlations, and the generated tables pass the monotonicity checks a simulator applies.'));
    } else {
      model.warnings.forEach(function (w) { qc.appendChild(notice('warn', '!', w)); });
    }
  }

  function notice(kind, icon, text) {
    var d = document.createElement('div');
    d.className = 'notice ' + kind;
    var i = document.createElement('span');
    i.className = 'icon'; i.textContent = icon;
    var p = document.createElement('span');
    p.textContent = text;
    d.appendChild(i); d.appendChild(p);
    return d;
  }

  function series(name, slot, rows, xKey, yKey, yKind) {
    return {
      name: name, slot: slot,
      points: rows.map(function (r) {
        return { x: conv('p', r[xKey]), y: yKind ? conv(yKind, r[yKey]) : r[yKey] };
      })
    };
  }

  function chartInto(container, key, opts) {
    var host = document.createElement('div');
    container.appendChild(host);
    charts[key] = Chart.create(host, opts);
  }

  var CHART_DEFS = [
    { key: 'rs', title: 'Solution gas-oil ratio', slot: 1, src: 'oil', y: 'rs', kind: 'rs', yMinZero: true,
      sub: 'Gas dissolved in the oil; constant above the bubble point' },
    { key: 'bo', title: 'Oil formation volume factor', slot: 1, src: 'oil', y: 'bo', kind: 'bo',
      sub: 'Peaks at Pb, then falls as the undersaturated oil is compressed' },
    { key: 'muo', title: 'Oil viscosity', slot: 1, src: 'oil', y: 'muo', kind: 'mu',
      sub: 'Minimum at Pb: gas thins the oil below it, pressure thickens it above' },
    { key: 'rhoO', title: 'Oil density', slot: 1, src: 'oil', y: 'rhoO', kind: 'rho',
      sub: 'Reservoir-condition live-oil density' },
    { key: 'z', title: 'Gas deviation factor', slot: 2, src: 'gas', y: 'z', kind: null,
      sub: 'z-factor from the selected correlation' },
    { key: 'bg', title: 'Gas formation volume factor', slot: 2, src: 'gas', y: 'bg', kind: 'bg',
      sub: 'Free gas shrinks sharply as pressure rises' },
    { key: 'mug', title: 'Gas viscosity', slot: 2, src: 'gas', y: 'mug', kind: 'mu',
      sub: 'Rises monotonically with pressure' },
    { key: 'rhoG', title: 'Gas density', slot: 2, src: 'gas', y: 'rhoG', kind: 'rho',
      sub: 'Reservoir-condition free-gas density' },
    { key: 'bw', title: 'Water formation volume factor', slot: 3, src: 'water', y: 'bw', kind: 'bo',
      sub: 'McCain (1991) correlation' },
    { key: 'muw', title: 'Water viscosity', slot: 3, src: 'water', y: 'muw', kind: 'mu',
      sub: 'Brine viscosity at the stated salinity' }
  ];

  var GAS_CHART_DEFS = [
    { key: 'z', title: 'Gas deviation factor', slot: 2, src: 'gas', y: 'z', kind: null,
      sub: 'z-factor of the reservoir gas from the selected correlation' },
    { key: 'bg', title: 'Gas formation volume factor', slot: 2, src: 'gas', y: 'bg', kind: 'bg',
      sub: 'Reservoir volume per standard volume of separator gas' },
    { key: 'mug', title: 'Gas viscosity', slot: 2, src: 'gas', y: 'mug', kind: 'mu',
      sub: 'Rises with pressure as the gas densifies' },
    { key: 'rhoG', title: 'Gas density', slot: 2, src: 'gas', y: 'rhoG', kind: 'rho',
      sub: 'Reservoir-condition gas density' },
    { key: 'cg', title: 'Gas compressibility', slot: 2, src: 'gas', y: 'cg', kind: 'c',
      sub: 'Isothermal compressibility, roughly 1/p at low pressure' },
    { key: 'eg', title: 'Gas expansion factor', slot: 2, src: 'gas', y: 'eg', kind: 'eg', yMinZero: true,
      sub: 'Standard volume per reservoir volume — the CMG *PVTG column' },
    { key: 'bw', title: 'Water formation volume factor', slot: 3, src: 'water', y: 'bw', kind: 'bo',
      sub: 'McCain (1991) correlation' },
    { key: 'muw', title: 'Water viscosity', slot: 3, src: 'water', y: 'muw', kind: 'mu',
      sub: 'Brine viscosity at the stated salinity' }
  ];

  /* y-axis caption and formatting for a chart kind; 'pct' is a plain percentage */
  /* 'eg' is a volume ratio the unit switch leaves alone */
  function kindLabel(kind) { return kind === 'eg' ? 'scf/ft³' : (kind ? label(kind) : 'z (–)'); }
  function kindConv(kind, v) { return kind && kind !== 'eg' ? conv(kind, v) : v; }
  function kindDigits(kind) { return kind === 'eg' ? 1 : (kind ? uu(kind).d : 4); }

  function satMarker() {
    if (!(model.psat > 0)) return null;
    return { x: conv('p', model.psat), label: model.fluid === 'gas' ? 'Pd' : 'Pb' };
  }

  function chartOpts(def) {
    var rows = model[def.src];
    return {
      title: def.title,
      subtitle: def.sub,
      xLabel: 'Pressure (' + label('p') + ')',
      yLabel: kindLabel(def.kind),
      xUnit: label('p'),
      series: [{
        name: def.title, slot: def.slot,
        points: rows.map(function (r) { return { x: conv('p', r.p), y: kindConv(def.kind, r[def.y]) }; })
      }],
      marker: satMarker(),
      yMinZero: def.yMinZero,
      endLabels: false,
      onCursor: function (x) { setCursor(uu('p').inv(x), 'chart'); },
      fmtX: function (v) { return v.toFixed(uu('p').d); },
      fmtY: function (v) {
        var d = kindDigits(def.kind);
        return d < 0 ? v.toExponential(3) : v.toFixed(d);
      }
    };
  }

  function renderCharts() {
    var sum = $('summaryCharts'), all = $('allCharts');
    sum.textContent = ''; all.textContent = ''; charts = {};
    var gas = model.fluid === 'gas';
    var defs = gas ? GAS_CHART_DEFS.filter(function (d) {
      return !d.only || d.only.indexOf(model.gasKind) >= 0;
    }) : CHART_DEFS;
    /* the two charts that tell the story of this fluid sit under the pictures */
    var onSummary = gas ? ['z', 'bg'] : ['rs', 'bo'];
    defs.forEach(function (def) {
      if (onSummary.indexOf(def.key) >= 0) chartInto(sum, 's_' + def.key, chartOpts(def));
      chartInto(all, def.key, chartOpts(def));
    });
  }

  /* ---------------- cursor-linked fluid visuals ---------------- */
  function pRange() {
    var rows = model.fluid === 'gas' ? model.gas : model.oil;
    return { lo: rows[0].p, hi: rows[rows.length - 1].p };
  }
  function atSaturation(p) {
    return model.psat > 0 && Math.abs(p - model.psat) < 0.004 * model.psat;
  }

  /* One pressure drives the barrel, the phase diagram, the slider and the
     readout, wherever the pointer happens to be. */
  function setCursor(p, source) {
    if (!model) return;
    var r = pRange();
    cursorP = Math.max(r.lo, Math.min(r.hi, p));
    if (barrel) barrel.update(cursorP);
    if (phase) phase.update(cursorP);
    var slider = $('pCursor');
    if (source !== 'slider') slider.value = String(conv('p', cursorP));
    $('cursorReadout').textContent = fmt('p', cursorP) + ' ' + label('p');
    var st = $('cursorState');
    var atSat = atSaturation(cursorP), twoPhase;
    if (model.fluid === 'gas') {
      st.textContent = 'Single-phase gas';
      st.className = 'state-chip';
      return;
    }
    twoPhase = cursorP <= model.pb + 1e-6;
    st.textContent = atSat ? 'At the bubble point'
      : (twoPhase ? 'Two-phase: oil + free gas' : 'Single-phase undersaturated oil');
    st.className = 'state-chip' + (twoPhase && !atSat ? ' two-phase' : '');
  }

  function renderVisuals() {
    envelope = FS.phaseEnvelope(model);
    var r = pRange();
    var host = $('fluidVisuals');
    host.textContent = '';

    var slider = $('pCursor');
    slider.min = String(conv('p', r.lo));
    slider.max = String(conv('p', r.hi));
    slider.step = String((conv('p', r.hi) - conv('p', r.lo)) / 600);

    var state = function (p) { return FS.barrelState(model, p); };
    var kind = model.fluid === 'gas' ? model.gasKind : 'oil';
    var bHost = document.createElement('div');
    host.appendChild(bHost);
    barrel = Vis.createBarrel(bHost, {
      kind: kind, state: state, fmt: fmt, label: label,
      atBubblePoint: atSaturation, atSat: atSaturation, cgr: model.cgr
    });

    var pHost = document.createElement('div');
    host.appendChild(pHost);
    phase = Vis.createPhaseDiagram(pHost, {
      env: envelope, state: state, fmt: fmt, label: label,
      atBubblePoint: atSaturation, atSat: atSaturation,
      convT: function (t) { return conv('T', t); },
      convP: function (p) { return conv('p', p); },
      invP: function (v) { return uu('p').inv(v); },
      /* a temperature difference converts by the scale factor alone */
      convDeltaT: function (d) { return units === 'metric' ? d / 1.8 : d; },
      ticks: Chart.niceTicks, fmtTick: Chart.fmtTick,
      pMinTable: r.lo, pMaxTable: r.hi,
      onPressure: function (p) { setCursor(p, 'phase'); }
    });

    var keep = cursorP !== null && cursorP >= r.lo && cursorP <= r.hi ? cursorP
      : (model.psat > 0 ? model.psat : r.hi);
    setCursor(keep);
  }

  function togglePlay() {
    var btn = $('btnPlay');
    if (playTimer) {
      cancelAnimationFrame(playTimer);
      playTimer = null;
      btn.textContent = 'Play depletion';
      btn.classList.remove('primary');
      return;
    }
    btn.textContent = 'Stop';
    btn.classList.add('primary');
    var r = pRange(), t0 = null, span = 9000;
    var step = function (ts) {
      if (t0 === null) t0 = ts;
      var f = ((ts - t0) % span) / span;           /* 1 -> 0, then repeat */
      setCursor(r.hi - f * (r.hi - r.lo));
      playTimer = requestAnimationFrame(step);
    };
    playTimer = requestAnimationFrame(step);
  }

  /* ---------------- tables ---------------- */
  var TABLE_DEFS = {
    oil: {
      caption: 'Oil properties. The highlighted row is the bubble point.',
      cols: [
        { h: 'Pressure', k: 'p', kind: 'p' }, { h: 'State', k: 'state' },
        { h: 'Rs', k: 'rs', kind: 'rs' }, { h: 'Bo', k: 'bo', kind: 'bo' },
        { h: 'mu_o', k: 'muo', kind: 'mu' }, { h: 'rho_o', k: 'rhoO', kind: 'rho' },
        { h: 'co', k: 'co', kind: 'c' }
      ]
    },
    gas: {
      caption: 'Dry-gas properties at reservoir temperature.',
      cols: [
        { h: 'Pressure', k: 'p', kind: 'p' }, { h: 'z', k: 'z' },
        { h: 'Bg', k: 'bg', kind: 'bg' }, { h: 'mu_g', k: 'mug', kind: 'mu' },
        { h: 'rho_g', k: 'rhoG', kind: 'rho' }, { h: 'cg', k: 'cg', kind: 'c' }
      ]
    },
    water: {
      caption: 'Formation-water properties at the stated salinity.',
      cols: [
        { h: 'Pressure', k: 'p', kind: 'p' }, { h: 'Bw', k: 'bw', kind: 'bo' },
        { h: 'mu_w', k: 'muw', kind: 'mu' }, { h: 'rho_w', k: 'rhoW', kind: 'rho' },
        { h: 'cw', k: 'cw', kind: 'c' }
      ]
    }
  };

  var GAS_TABLE_DEFS = {
    gas: {
      caption: 'Gas properties at reservoir temperature, per standard volume of separator gas.',
      cols: [
        { h: 'Pressure', k: 'p', kind: 'p' }, { h: 'z', k: 'z' },
        { h: 'Bg', k: 'bg', kind: 'bg' }, { h: 'Bg well stream', k: 'bgw', kind: 'bg' },
        { h: 'Eg (scf/ft³)', k: 'eg', fixed: 1 },
        { h: 'mu_g', k: 'mug', kind: 'mu' }, { h: 'rho_g', k: 'rhoG', kind: 'rho' },
        { h: 'cg', k: 'cg', kind: 'c' }, { h: 'Rv', k: 'rv', kind: 'cgr', not: ['dry'] }
      ]
    },
    water: TABLE_DEFS.water
  };

  /* the table choices depend on the fluid being modelled */
  function tableOptions() {
    if (model.fluid !== 'gas') {
      return [['oil', 'Oil properties'], ['gas', 'Gas properties'], ['water', 'Water properties'],
              ['pvto', 'PVTO records (live oil)']];
    }
    return [['gas', 'Gas properties'], ['water', 'Water properties']];
  }
  function refreshTableSelect() {
    var sel = $('tableSel'), cur = sel.value, opts = tableOptions();
    sel.textContent = '';
    opts.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      sel.appendChild(op);
    });
    sel.value = opts.some(function (o) { return o[0] === cur; }) ? cur : opts[0][0];
  }

  function renderTable() {
    refreshTableSelect();
    var which = $('tableSel').value;
    var tbl = $('dataTable');
    tbl.textContent = '';
    var gas = model.fluid === 'gas';
    if (which === 'pvto') return renderPvto(tbl, model);
    var def = gas ? GAS_TABLE_DEFS[which] : TABLE_DEFS[which];
    var rows = model[which], satRows = gas ? model.gas : model.oil;
    var psat = model.psat;
    def = {
      caption: def.caption,
      cols: def.cols.filter(function (c) {
        return !(gas && c.not && c.not.indexOf(model.gasKind) >= 0);
      })
    };
    var cap = document.createElement('caption');
    cap.textContent = def.caption;
    tbl.appendChild(cap);
    var thead = document.createElement('thead'), tr = document.createElement('tr');
    def.cols.forEach(function (c) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c.h + (c.kind ? ' (' + label(c.kind) + ')' : '');
      tr.appendChild(th);
    });
    thead.appendChild(tr); tbl.appendChild(thead);
    var tb = document.createElement('tbody');
    rows.forEach(function (r, i) {
      var row = document.createElement('tr');
      if (psat > 0 && Math.abs(r.p - psat) < 1e-6) row.className = 'is-pb';
      def.cols.forEach(function (c) {
        var td = document.createElement('td');
        if (c.k === 'state') td.textContent = satRows[i].saturated ? 'saturated' : 'undersaturated';
        else if (c.fixed !== undefined) td.textContent = r[c.k].toFixed(c.fixed);
        else td.textContent = c.kind ? fmt(c.kind, r[c.k]) : (r[c.k] === null ? '—' : r[c.k].toFixed(4));
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    tbl.appendChild(tb);
  }

  function renderPvto(tbl, src) {
    src = src || model;
    var cap = document.createElement('caption');
    cap.textContent = 'PVTO records: each saturated node carries its own saturation pressure and undersaturated branch.';
    tbl.appendChild(cap);
    var thead = document.createElement('thead'), tr = document.createElement('tr');
    ['Rs (' + label('rs') + ')', 'Pressure (' + label('p') + ')', 'Bo (' + label('bo') + ')',
     'mu_o (' + label('mu') + ')', 'Branch'].forEach(function (h) {
      var th = document.createElement('th'); th.scope = 'col'; th.textContent = h; tr.appendChild(th);
    });
    thead.appendChild(tr); tbl.appendChild(thead);
    var tb = document.createElement('tbody');
    src.pvto.forEach(function (rec) {
      rec.rows.forEach(function (r, k) {
        var row = document.createElement('tr');
        if (k === 0 && Math.abs(rec.pb - src.pb) < 1e-6) row.className = 'is-pb';
        [k === 0 ? fmt('rs', rec.rs) : '', fmt('p', r.p), fmt('bo', r.bo), fmt('mu', r.muo),
         k === 0 ? 'saturated' : 'undersaturated'].forEach(function (v) {
          var td = document.createElement('td'); td.textContent = v; row.appendChild(td);
        });
        tb.appendChild(row);
      });
    });
    tbl.appendChild(tb);
  }

  /* ---------------- correlation spread ---------------- */
  var PB_LIST = [
    ['standing', 'Standing'], ['vasquezBeggs', 'Vasquez-Beggs'], ['glaso', 'Glaso'],
    ['alMarhoun', 'Al-Marhoun'], ['petroskyFarshad', 'Petrosky-Farshad'], ['lasater', 'Lasater']
  ];
  var BO_LIST = [
    ['standing', 'Standing'], ['vasquezBeggs', 'Vasquez-Beggs'], ['glaso', 'Glaso'],
    ['alMarhoun', 'Al-Marhoun'], ['petroskyFarshad', 'Petrosky-Farshad']
  ];
  var MUOD_LIST = [
    ['beggsRobinson', 'Beggs-Robinson'], ['beal', 'Beal'], ['glaso', 'Glaso'], ['ngEgbogah', 'Ng-Egbogah']
  ];

  var Z_LIST = [['dak', 'Dranchuk-Abou-Kassem'], ['hallYarborough', 'Hall-Yarborough'], ['beggsBrill', 'Beggs-Brill']];

  /* Gas mode: the spread across z-factor, viscosity and pseudo-critical
     correlations, evaluated on the reservoir gas (well-stream gravity). */
  function renderCompareGas() {
    var host = $('compareCharts');
    host.textContent = '';
    var inp = model.input, gW = model.gammaW;
    var grid = [], n = 40, i;
    var hi = model.gas[model.gas.length - 1].p;
    for (i = 0; i <= n; i++) grid.push(inp.pMin + (hi - inp.pMin) * i / n);
    var opt = { _pc: model.pcrit, yCO2: inp.yCO2, yH2S: inp.yH2S, yN2: inp.yN2 };

    chartInto(host, 'cmpZ', {
      title: 'Gas deviation factor — all z correlations',
      subtitle: 'Reservoir gas at gravity ' + gW.toFixed(3) + '; same pseudo-criticals for every fit',
      xLabel: 'Pressure (' + label('p') + ')', yLabel: 'z (–)', xUnit: label('p'),
      series: Z_LIST.map(function (c, k) {
        return { name: c[1], slot: (k % 8) + 1, points: grid.map(function (p) {
          return { x: conv('p', p), y: C.gasZ(c[0], p, inp.tempF, gW, opt) };
        }) };
      }),
      marker: satMarker(),
      onCursor: function (x) { setCursor(uu('p').inv(x), 'chart'); },
      fmtX: function (v) { return v.toFixed(uu('p').d); },
      fmtY: function (v) { return v.toFixed(4); }
    });

    var zSel = inp.corr.z, tpr = (inp.tempF + C.TZERO) / model.pcrit.tpc;
    chartInto(host, 'cmpMug', {
      title: 'Gas viscosity — both correlations',
      subtitle: 'Evaluated with the selected z-factor for the density term',
      xLabel: 'Pressure (' + label('p') + ')', yLabel: label('mu'), xUnit: label('p'),
      series: [['leeGonzalezEakin', 'Lee-Gonzalez-Eakin'], ['carrKobayashiBurrows', 'Carr-Kobayashi-Burrows']].map(function (c, k) {
        return { name: c[1], slot: (k % 8) + 1, points: grid.map(function (p) {
          var z = C.gasZ(zSel, p, inp.tempF, gW, opt);
          var mu = c[0] === 'leeGonzalezEakin'
            ? C.MU_G.leeGonzalezEakin(C.gasDensity(z, p, inp.tempF, gW), inp.tempF, gW)
            : C.MU_G.carrKobayashiBurrows(p / model.pcrit.ppc, tpr, inp.tempF, gW, opt);
          return { x: conv('p', p), y: mu };
        }) };
      }),
      marker: satMarker(),
      onCursor: function (x) { setCursor(uu('p').inv(x), 'chart'); },
      fmtX: function (v) { return v.toFixed(uu('p').d); },
      fmtY: function (v) { return v.toFixed(5); }
    });

    /* table: every correlation at the maximum table pressure and at Pd */
    var tbl = $('compareTable');
    tbl.textContent = '';
    var cap = document.createElement('caption');
    var pRef = model.psat > 0 ? model.psat : hi;
    cap.textContent = 'Every gas correlation evaluated at ' + fmt('p', pRef) + ' ' + label('p') +
      (model.psat > 0 ? ' (the dew point)' : ' (maximum table pressure)') +
      '. "Deviation" is measured against the correlation currently selected.';
    tbl.appendChild(cap);
    var thead = document.createElement('thead'), tr = document.createElement('tr');
    ['Property / correlation', 'Value', 'Unit', 'Deviation'].forEach(function (h) {
      var th = document.createElement('th'); th.scope = 'col'; th.textContent = h; tr.appendChild(th);
    });
    thead.appendChild(tr); tbl.appendChild(thead);
    var tb = document.createElement('tbody');
    function group(title, list, valueFn, digits, unit, selected) {
      var gh = document.createElement('tr'), th = document.createElement('th');
      th.colSpan = 4; th.scope = 'colgroup'; th.style.textAlign = 'left'; th.textContent = title;
      gh.appendChild(th); tb.appendChild(gh);
      var ref = valueFn(selected);
      list.forEach(function (c) {
        var v = valueFn(c[0]);
        var row = document.createElement('tr');
        if (c[0] === selected) row.className = 'is-pb';
        [c[1] + (c[0] === selected ? '  (selected)' : ''), isFinite(v) ? v.toFixed(digits) : '—', unit,
         isFinite(v) && ref ? ((v - ref) / ref * 100).toFixed(1) + ' %' : '—'].forEach(function (t) {
          var td = document.createElement('td'); td.textContent = t; row.appendChild(td);
        });
        tb.appendChild(row);
      });
    }
    group('z-factor', Z_LIST, function (k) { return C.gasZ(k, pRef, inp.tempF, gW, opt); }, 4, '–', zSel);
    var zRef = C.gasZ(zSel, pRef, inp.tempF, gW, opt);
    group('Gas viscosity', [['leeGonzalezEakin', 'Lee-Gonzalez-Eakin'], ['carrKobayashiBurrows', 'Carr-Kobayashi-Burrows']],
      function (k) {
        return k === 'leeGonzalezEakin'
          ? C.MU_G.leeGonzalezEakin(C.gasDensity(zRef, pRef, inp.tempF, gW), inp.tempF, gW)
          : C.MU_G.carrKobayashiBurrows(pRef / model.pcrit.ppc, tpr, inp.tempF, gW, opt);
      }, 5, label('mu'), inp.corr.mug);
    var pcOf = function (k) {
      return C.pseudoCriticals(gW, {
        method: k === 'standing' ? (model.gasKind === 'dry' ? 'standingDry' : 'standingWet') : 'sutton',
        correction: inp.corr.inertCorr === 'carr' ? 'carr' : 'wichertAziz',
        yCO2: inp.yCO2, yH2S: inp.yH2S, yN2: inp.yN2
      });
    };
    var PC_LIST = [['sutton', 'Sutton (1985)'], ['standing', 'Standing (1977)']];
    group('Pseudo-critical temperature', PC_LIST, function (k) { return pcOf(k).tpc; }, 1, '°R', inp.corr.pcrit);
    group('Pseudo-critical pressure', PC_LIST, function (k) { return pcOf(k).ppc; }, 1, 'psia', inp.corr.pcrit);
    group('z-factor with each pseudo-critical set (' + Z_LIST.filter(function (c) { return c[0] === zSel; })[0][1] + ')',
      PC_LIST, function (k) {
        return C.gasZ(zSel, pRef, inp.tempF, gW, { _pc: pcOf(k) });
      }, 4, '–', inp.corr.pcrit);
    tbl.appendChild(tb);
  }

  function renderCompare() {
    if (model.fluid === 'gas') return renderCompareGas();
    var host = $('compareCharts');
    host.textContent = '';
    var inp = model.input;
    var s = { api: inp.api, gammaG: inp.gammaG, tempF: inp.tempF, tSepF: inp.tSepF,
              pSepPsia: inp.pSepPsia, rsb: model.rsb, pb: 0 };
    var grid = [], n = 40, i;
    for (i = 0; i <= n; i++) grid.push(inp.pMin + (Math.max(inp.pMax, model.pb) - inp.pMin) * i / n);

    /* Rs(p) for every Pb correlation on a common pressure grid */
    var rsSeries = [], pbValues = {};
    PB_LIST.forEach(function (c, k) {
      var pbc = C.PB[c[0]](model.rsb, s);
      pbValues[c[0]] = pbc;
      if (!(pbc > 0)) return;
      var sc = { api: s.api, gammaG: s.gammaG, tempF: s.tempF, tSepF: s.tSepF,
                 pSepPsia: s.pSepPsia, rsb: model.rsb, pb: pbc };
      rsSeries.push({
        name: c[1], slot: (k % 8) + 1,
        points: grid.map(function (p) {
          return { x: conv('p', p), y: conv('rs', C.solutionGor(c[0], p, sc)) };
        })
      });
    });
    chartInto(host, 'cmpRs', {
      title: 'Solution GOR — all Pb correlations',
      subtitle: 'Same fluid, same Rsb; each correlation puts the bubble point somewhere different',
      xLabel: 'Pressure (' + label('p') + ')', yLabel: label('rs'), xUnit: label('p'),
      series: rsSeries, marker: { x: conv('p', model.pb), label: 'Pb (selected)' },
      yMinZero: true,
      onCursor: function (x) { setCursor(uu('p').inv(x), 'chart'); },
      fmtX: function (v) { return v.toFixed(uu('p').d); },
      fmtY: function (v) { return v.toFixed(uu('rs').d); }
    });

    /* Bo(p) for every Bo correlation, on the selected Rs curve */
    var boSeries = BO_LIST.map(function (c, k) {
      return {
        name: c[1], slot: (k % 8) + 1,
        points: grid.filter(function (p) { return p <= model.pb; }).map(function (p) {
          var rs = C.solutionGor(inp.corr.pb, p, { api: s.api, gammaG: s.gammaG, tempF: s.tempF,
            tSepF: s.tSepF, pSepPsia: s.pSepPsia, rsb: model.rsb, pb: model.pb });
          return { x: conv('p', p), y: conv('bo', C.BO[c[0]](rs, s)) };
        })
      };
    }).filter(function (ss) { return ss.points.length > 1; });
    if (boSeries.length) {
      chartInto(host, 'cmpBo', {
        title: 'Saturated oil FVF — all Bo correlations',
        subtitle: 'Evaluated on the Rs curve of the selected Pb correlation',
        xLabel: 'Pressure (' + label('p') + ')', yLabel: label('bo'), xUnit: label('p'),
        series: boSeries, marker: { x: conv('p', model.pb), label: 'Pb' },
        fmtX: function (v) { return v.toFixed(uu('p').d); },
        fmtY: function (v) { return v.toFixed(4); }
      });
    }

    /* z-factor for the three z correlations */
    var zSeries = [['dak', 'Dranchuk-Abou-Kassem'], ['hallYarborough', 'Hall-Yarborough'],
                   ['beggsBrill', 'Beggs-Brill']].map(function (c, k) {
      return {
        name: c[1], slot: (k % 8) + 1,
        points: grid.map(function (p) {
          return { x: conv('p', p), y: C.gasZ(c[0], p, inp.tempF, inp.gammaG, { _pc: model.pcrit }) };
        })
      };
    });
    chartInto(host, 'cmpZ', {
      title: 'Gas deviation factor — all z correlations',
      subtitle: 'Same pseudo-criticals; the fits diverge most near the critical region',
      xLabel: 'Pressure (' + label('p') + ')', yLabel: 'z (–)', xUnit: label('p'),
      series: zSeries,
      fmtX: function (v) { return v.toFixed(uu('p').d); },
      fmtY: function (v) { return v.toFixed(4); }
    });

    renderCompareTable(pbValues, s);
  }

  function renderCompareTable(pbValues, s) {
    var tbl = $('compareTable');
    tbl.textContent = '';
    var cap = document.createElement('caption');
    cap.textContent = 'Every correlation evaluated on the current fluid. "Deviation" is measured against the correlation currently selected.';
    tbl.appendChild(cap);
    var thead = document.createElement('thead'), tr = document.createElement('tr');
    ['Property / correlation', 'Value', 'Unit', 'Deviation'].forEach(function (h) {
      var th = document.createElement('th'); th.scope = 'col'; th.textContent = h; tr.appendChild(th);
    });
    thead.appendChild(tr); tbl.appendChild(thead);
    var tb = document.createElement('tbody');

    function group(title, list, valueFn, kind, selected) {
      var gh = document.createElement('tr');
      var th = document.createElement('th');
      th.colSpan = 4; th.scope = 'colgroup';
      th.style.textAlign = 'left';
      th.textContent = title;
      gh.appendChild(th); tb.appendChild(gh);
      var ref = valueFn(selected), vals = [];
      list.forEach(function (c) {
        var v = valueFn(c[0]);
        vals.push(v);
        var row = document.createElement('tr');
        if (c[0] === selected) row.className = 'is-pb';
        var cells = [
          c[1] + (c[0] === selected ? '  (selected)' : ''),
          isFinite(v) && v > 0 ? fmt(kind, v) : '—',
          label(kind),
          isFinite(v) && isFinite(ref) && ref !== 0 && v > 0
            ? ((v - ref) / ref * 100).toFixed(1) + ' %' : '—'
        ];
        cells.forEach(function (t) {
          var td = document.createElement('td'); td.textContent = t; row.appendChild(td);
        });
        tb.appendChild(row);
      });
      var good = vals.filter(function (v) { return isFinite(v) && v > 0; });
      if (good.length > 1) {
        var lo = Math.min.apply(null, good), hi = Math.max.apply(null, good);
        var sr = document.createElement('tr');
        [['Spread (max − min)'], [fmt(kind, hi - lo)], [label(kind)],
         [((hi - lo) / ref * 100).toFixed(1) + ' %']].forEach(function (t) {
          var td = document.createElement('td');
          td.textContent = t[0];
          td.style.color = 'var(--text-secondary)';
          sr.appendChild(td);
        });
        tb.appendChild(sr);
      }
    }

    var inp = model.input;
    group('Bubble-point pressure', PB_LIST, function (k) { return C.PB[k](model.rsb, s); }, 'p', inp.corr.pb);
    group('Oil FVF at Pb', BO_LIST, function (k) { return C.BO[k](model.rsb, s); }, 'bo', inp.corr.bo);
    group('Dead-oil viscosity', MUOD_LIST, function (k) { return C.MU_OD[k](s); }, 'mu', inp.corr.muod);
    group('z-factor at Pb', [['dak', 'Dranchuk-Abou-Kassem'], ['hallYarborough', 'Hall-Yarborough'],
      ['beggsBrill', 'Beggs-Brill']], function (k) {
      return C.gasZ(k, model.pb, inp.tempF, inp.gammaG, { _pc: model.pcrit });
    }, 'none', inp.corr.z);
    tbl.appendChild(tb);
  }

  /* ================================================================ *
   * Laboratory data, correlation ranking and tuning
   * ================================================================ */

  /* Columns of the laboratory table; kind drives the unit conversion. */
  var LAB_COLS = {
    oil: [
      { k: 'p', kind: 'p', head: 'Pressure' },
      { k: 'rs', kind: 'rs', head: 'Rs' },
      { k: 'bo', kind: 'bo', head: 'Bo' },
      { k: 'muo', kind: 'mu', head: 'Oil viscosity' },
      { k: 'z', kind: null, head: 'Gas z' },
      { k: 'mug', kind: 'mu', head: 'Gas viscosity' }
    ],
    gas: [
      { k: 'p', kind: 'p', head: 'Pressure' },
      { k: 'z', kind: null, head: 'z-factor' },
      { k: 'mug', kind: 'mu', head: 'Gas viscosity' }
    ]
  };
  /* correlation family -> sidebar select */
  var CORR_SELECT = { pb: 'cPb', bo: 'cBo', co: 'cCo', muod: 'cMuod', muob: 'cMuob',
                      muou: 'cMuou', z: 'cZ', pcrit: 'cPcrit', mug: 'cMug' };
  var CORR_NAMES = {
    standing: 'Standing', vasquezBeggs: 'Vasquez-Beggs', glaso: 'Glaso', alMarhoun: 'Al-Marhoun',
    petroskyFarshad: 'Petrosky-Farshad', lasater: 'Lasater', mccain: 'McCain',
    beggsRobinson: 'Beggs-Robinson', beal: 'Beal', ngEgbogah: 'Ng-Egbogah',
    chewConnally: 'Chew-Connally', none: 'Constant above Pb', dak: 'Dranchuk-Abou-Kassem',
    hallYarborough: 'Hall-Yarborough', beggsBrill: 'Beggs-Brill', sutton: 'Sutton',
    leeGonzalezEakin: 'Lee-Gonzalez-Eakin', carrKobayashiBurrows: 'Carr-Kobayashi-Burrows'
  };

  function emptySampling() { return { type: 'bhs', pRes: null, pwf: null, gor: null }; }
  function emptyLab() { return { pb: null, muod: null, rows: [], tune: false, sampling: emptySampling() }; }
  var lab = { oil: emptyLab(), gas: emptyLab() };
  var baseModel = null, regression = null, tuneError = null, fieldTuned = null;
  var screenResult = null, screenKey = null, screening = false;

  function finiteOrNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function cleanLab(o) {
    o = o || {};
    return {
      pb: finiteOrNull(o.pb), muod: finiteOrNull(o.muod), tune: !!o.tune,
      sampling: {
        type: o.sampling && o.sampling.type === 'sep' ? 'sep' : 'bhs',
        pRes: finiteOrNull((o.sampling || {}).pRes), pwf: finiteOrNull((o.sampling || {}).pwf),
        gor: finiteOrNull((o.sampling || {}).gor)
      },
      rows: (o.rows || []).map(function (r) {
        var out = {};
        ['p', 'rs', 'bo', 'muo', 'z', 'mug'].forEach(function (k) { out[k] = finiteOrNull(r[k]); });
        return out;
      })
    };
  }

  /* What the model and the regression receive: complete rows only. */
  function labForModel() {
    var L = lab[fluid];
    return { pb: fluid === 'oil' ? L.pb : null, muod: fluid === 'oil' ? L.muod : null,
             rows: L.rows.filter(function (r) { return r.p !== null; }) };
  }

  /* Restore laboratory data from a saved or shared case. Cases saved before
     the lab table existed carry a three-value calibration: carry it over. */
  function restoreLab(o) {
    var f = o.fluid === 'gas' ? 'gas' : 'oil';
    if (o.lab) {
      /* case inputs carry the table but not the sampling conditions */
      var keepSampling = lab[f] && lab[f].sampling;
      lab[f] = cleanLab(o.lab);
      if (!o.lab.sampling && keepSampling) lab[f].sampling = keepSampling;
      lab[f].tune = !!o.tune;
    } else if (o.calib && (o.calib.pbMeas > 0 || o.calib.bobMeas > 0 || o.calib.muodMeas > 0)) {
      var c = o.calib;
      lab.oil = emptyLab();
      lab.oil.pb = c.pbMeas > 0 ? c.pbMeas : null;
      lab.oil.muod = c.muodMeas > 0 ? c.muodMeas : null;
      if (c.bobMeas > 0 && c.pbMeas > 0) lab.oil.rows.push({ p: c.pbMeas, rs: null, bo: c.bobMeas, muo: null, z: null, mug: null });
      lab.oil.tune = true;
    }
    if (f === fluid) { setInput('labPb', lab.oil.pb); setInput('labMuod', lab.oil.muod); }
    renderLabTable();
  }

  /* Tuning handed to the model: the multipliers plus the fit summary the
     deck header prints. */
  function tuningPayload(reg) {
    var out = {}, k;
    for (k in reg.tuning) out[k] = reg.tuning[k];
    out.fit = Tune.PROPS[fluid].filter(function (pr) { return reg.after[pr.key].n; }).map(function (pr) {
      return { label: pr.label, n: reg.after[pr.key].n,
               before: reg.before[pr.key].aare, after: reg.after[pr.key].aare };
    });
    return out;
  }

  /* Show the one-report sampling conditions in the inputs. */
  function writeLabSampling() {
    var sm = lab.oil.sampling || emptySampling();
    lab.oil.sampling = sm;
    $('labType').value = sm.type;
    setInput('labPRes', sm.pRes); setInput('labPwf', sm.pwf); setInput('labGor', sm.gor);
    $('rowLabPwf').hidden = sm.type !== 'bhs';
    if (sm.pRes !== null || sm.pwf !== null || sm.gor !== null) $('labPwf').closest('details').open = true;
  }

  /* The one report as a sample, with the case's fluid description: the
     same checks the several-report screening applies to each sample. */
  function renderLabChecks() {
    var host = $('labChecks');
    host.textContent = '';
    if (fluid !== 'oil' || !baseModel || !Tune.hasData(labForModel(), 'oil')) return;
    var inp = baseModel.input;
    var sm = lab.oil.sampling || emptySampling();
    var q = Smp.qcSample(sampleBase(), {
      id: 'case', name: 'This report', type: sm.type,
      fluid: { api: inp.api, gammaG: inp.gammaG, rsb: baseModel.rsb, tempF: inp.tempF },
      sampling: sm, lab: labForModel()
    });
    var h = document.createElement('h3');
    h.className = 'screen-detail-head';
    var st = q.checks.reduce(function (a, c) {
      return { fail: 3, warn: 2, pass: 1, na: 0 }[c.status] > { fail: 3, warn: 2, pass: 1, na: 0 }[a] ? c.status : a;
    }, 'na');
    h.textContent = 'Data checks: ' + { pass: 'the report passes', warn: 'the report passes with warnings',
      fail: 'the report fails - correct it before tuning', na: 'nothing to check yet' }[st];
    host.appendChild(h);
    renderCheckList(host, q.checks);
  }

  /* ---------- the editable table ---------- */

  function labCellText(col, v) { return v === null || v === undefined ? '' : trim(col.kind ? conv(col.kind, v) : v, col.kind); }
  function labCellValue(col, str) {
    var v = parseFloat(String(str).replace(/,/g, '').trim());
    if (!isFinite(v)) return null;
    return col.kind ? uu(col.kind).inv(v) : v;
  }

  function renderLabTable() {
    var tbl = $('labTable');
    if (!tbl) return;
    var cols = LAB_COLS[fluid], L = lab[fluid];
    while (L.rows.length < 3) L.rows.push({ p: null, rs: null, bo: null, muo: null, z: null, mug: null });
    tbl.textContent = '';
    var th = document.createElement('thead'), hr = document.createElement('tr');
    cols.forEach(function (c) {
      var h = document.createElement('th');
      h.textContent = c.head + (c.kind ? ' (' + label(c.kind) + ')' : '');
      hr.appendChild(h);
    });
    ['Branch', ''].forEach(function (t) { var h = document.createElement('th'); h.textContent = t; hr.appendChild(h); });
    th.appendChild(hr); tbl.appendChild(th);
    var tb = document.createElement('tbody');
    L.rows.forEach(function (r, i) {
      var tr = document.createElement('tr');
      cols.forEach(function (c, j) {
        var td = document.createElement('td');
        var inp = document.createElement('input');
        inp.type = 'text'; inp.inputMode = 'decimal';
        inp.value = labCellText(c, r[c.k]);
        inp.setAttribute('aria-label', c.head + ', row ' + (i + 1));
        inp.dataset.row = i; inp.dataset.col = j;
        td.appendChild(inp); tr.appendChild(td);
      });
      var br = document.createElement('td');
      br.className = 'lab-branch';
      tr.appendChild(br);
      var del = document.createElement('td');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ghost lab-del'; b.textContent = '✕';
      b.dataset.row = i;
      b.setAttribute('aria-label', 'Delete row ' + (i + 1));
      del.appendChild(b); tr.appendChild(del);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    updateBranches();
  }

  /* Which rows the regression treats as saturated and undersaturated. */
  function updateBranches() {
    var tbl = $('labTable');
    if (!tbl || !model) return;
    var split = fluid === 'oil' ? (regression && regression.pbSplit) || lab.oil.pb || model.pb : null;
    tbl.querySelectorAll('tbody tr').forEach(function (tr, i) {
      var r = lab[fluid].rows[i], cell = tr.querySelector('.lab-branch');
      if (!cell) return;
      cell.textContent = !r || r.p === null || split === null ? ''
        : r.p <= split + 1e-6 ? 'saturated' : 'undersaturated';
    });
  }

  /* Paste a block copied from a spreadsheet, starting at the focused cell. */
  function pasteBlock(r0, c0, text) {
    var cols = LAB_COLS[fluid], L = lab[fluid];
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; });
    lines.forEach(function (line, i) {
      var cells = line.split('\t');
      if (cells.length === 1) cells = line.split(/[;,]\s*/);
      var r = r0 + i;
      /* a header or unit row has no number in its first cell - skip it */
      if (labCellValue(cols[c0] || cols[0], cells[0]) === null && i === 0 && lines.length > 1) { r0--; return; }
      while (L.rows.length <= r) L.rows.push({ p: null, rs: null, bo: null, muo: null, z: null, mug: null });
      cells.forEach(function (cell, j) {
        var col = cols[c0 + j];
        if (col) L.rows[r][col.k] = labCellValue(col, cell);
      });
    });
    labChanged(true);
  }

  function labChanged(rebuildTable) {
    if (rebuildTable) renderLabTable();
    /* an earlier ranking stays on screen, marked stale by rankKey() */
    schedule();
  }

  /* ---------- results: fit table, notes, match charts ---------- */

  function fmtPct(v) { return v === null || v === undefined || !isFinite(v) ? '–' : v.toFixed(2) + ' %'; }

  function renderLabResults() {
    if (!$('labTable')) return;
    updateBranches();
    $('tuneOn').checked = !!lab[fluid].tune;
    var has = Tune.hasData(labForModel(), fluid);
    $('labStatus').textContent = has ? '' : 'Enter at least one laboratory value to rank or tune the correlations.';
    $('btnRank').disabled = !has || screening;

    /* fit table */
    var tbl = $('tuneTable'), notes = $('tuneNotes');
    tbl.textContent = ''; notes.textContent = '';
    var cmp = has ? Tune.compare(Model.build(Object.assign({}, baseModel.input, { pointsOnly: true, tuning: null })),
      Tune.normalize(labForModel(), fluid), fluid === 'oil' ? lab.oil.pb || baseModel.pb : undefined) : null;
    if (tuneError) notes.appendChild(notice('error', '✕', 'The regression failed: ' + tuneError));
    if (has) {
      var th = document.createElement('thead'), hr = document.createElement('tr');
      ['Property', 'Points', 'Untuned AARE', 'Tuned AARE', 'Max error, tuned'].forEach(function (h) {
        var e = document.createElement('th'); e.textContent = h; hr.appendChild(e);
      });
      th.appendChild(hr); tbl.appendChild(th);
      var tb = document.createElement('tbody');
      Tune.PROPS[fluid].forEach(function (pr) {
        var b = cmp[pr.key], a = regression ? regression.after[pr.key] : null;
        if (!b.n && !(a && a.n)) return;
        var tr = document.createElement('tr');
        [pr.label, String(a ? a.n : b.n), fmtPct(b.aare), a ? fmtPct(a.aare) : '–',
         a ? fmtPct(a.maxAre) : '–'].forEach(function (t) {
          var td = document.createElement('td'); td.textContent = t; tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      if (regression && regression.params.length) {
        var gr = document.createElement('tr');
        gr.className = 'group-row';
        var gtd = document.createElement('td'); gtd.colSpan = 5; gtd.textContent = 'Regressed multipliers';
        gr.appendChild(gtd); tb.appendChild(gr);
        regression.params.forEach(function (q) {
          var tr = document.createElement('tr');
          if (q.atBound) tr.className = 'at-bound';
          [q.label, String(q.points), '', '× ' + q.value.toFixed(4), q.atBound ? 'at search limit' : ''].forEach(function (t) {
            var td = document.createElement('td'); td.textContent = t; tr.appendChild(td);
          });
          tb.appendChild(tr);
        });
      }
      tbl.appendChild(tb);
    }
    if (regression) regression.notes.forEach(function (n) { notes.appendChild(notice('warn', '!', n)); });
    if (has && !lab[fluid].tune) {
      notes.appendChild(notice('info', 'i', 'Tuning is off: the tables and exports use the published correlations. Switch it on to apply the regressed multipliers.'));
    }

    renderLabChecks();
    renderScreen();
    renderMatchCharts(has);
  }

  function renderMatchCharts(has) {
    var host = $('labCharts');
    host.textContent = '';
    if (!has) return;
    var data = Tune.normalize(labForModel(), fluid);
    var defs = fluid === 'oil' ? [
      { col: 'rs', src: 'oil', title: 'Solution GOR', kind: 'rs', slot: 1 },
      { col: 'bo', src: 'oil', title: 'Oil formation volume factor', kind: 'bo', slot: 1 },
      { col: 'muo', src: 'oil', title: 'Oil viscosity', kind: 'mu', slot: 1 },
      { col: 'z', src: 'gas', title: 'Gas z-factor', kind: null, slot: 2 },
      { col: 'mug', src: 'gas', title: 'Gas viscosity', kind: 'mu', slot: 2 }
    ] : [
      { col: 'z', src: 'gas', title: 'Gas z-factor', kind: null, slot: 2 },
      { col: 'mug', src: 'gas', title: 'Gas viscosity', kind: 'mu', slot: 2 }
    ];
    var tuned = model !== baseModel;
    defs.forEach(function (d) {
      var pts = data.rows.filter(function (r) { return r[d.col] !== null; });
      if (!pts.length) return;
      var curve = function (m) {
        return m[d.src].map(function (r) { return { x: conv('p', r.p), y: kindConv(d.kind, r[d.col]) }; });
      };
      var series = [];
      if (tuned) series.push({ name: 'Tuned', slot: d.slot, points: curve(model) });
      series.push({ name: tuned ? 'Untuned' : 'Correlation', slot: tuned ? 7 : d.slot, dashed: tuned, points: curve(baseModel) });
      series.push({ name: 'Laboratory', slot: 8, scatter: true, points: pts.map(function (r) {
        return { x: conv('p', r.p), y: kindConv(d.kind, r[d.col]) };
      }) });
      chartInto(host, 'lab_' + d.col, {
        title: d.title, subtitle: 'Laboratory points against the ' + (tuned ? 'tuned and untuned correlations' : 'selected correlation'),
        xLabel: 'Pressure (' + label('p') + ')', yLabel: kindLabel(d.kind), xUnit: label('p'),
        series: series, marker: satMarker(), endLabels: false,
        onCursor: function (x) { setCursor(uu('p').inv(x), 'chart'); },
        fmtX: function (v) { return v.toFixed(uu('p').d); },
        fmtY: function (v) { var k = kindDigits(d.kind); return k < 0 ? v.toExponential(3) : v.toFixed(k); }
      });
    });
  }

  /* ---------- correlation ranking ---------- */

  /* The ranking depends on the fluid description and the data, not on which
     correlations are selected at the moment - it varies those itself. */
  function rankKey() {
    var i = readInputs();
    return JSON.stringify([i.fluid, i.api, i.gammaG, i.tempF, i.spec, i.rsb, i.pbMeas, i.tSepF, i.pSepPsia,
      i.gasType, i.gasKind, i.cgr, i.apiC, i.yCO2, i.yH2S, i.yN2, i.lab]);
  }

  function runRanking() {
    if (screening || !baseModel) return;
    var inp = readInputs(), fams = Tune.FAMILIES[inp.fluid], out = [], k = 0;
    var key = rankKey();
    screening = true;
    $('btnRank').disabled = true;
    var step = function () {
      if (k >= fams.length) {
        screening = false;
        screenResult = out; screenKey = key;
        $('rankStatus').textContent = '';
        renderLabResults();
        return;
      }
      $('rankStatus').textContent = 'Ranking ' + fams[k].label.toLowerCase() + '…';
      try {
        var r = Tune.screenFamily(inp, inp.lab, fams[k]);
        if (r) out.push(r);
      } catch (e) { /* a family that cannot be evaluated is left out */ }
      k++;
      setTimeout(step, 0);   /* let the page repaint between families */
    };
    setTimeout(step, 0);
  }

  /* Which curves the ranking charts draw: the published correlations or
     each one after its own tuning. */
  var rankCurveMode = 'raw';

  /* Chart of one family: every candidate on a common pressure grid (so the
     tooltip compares them at the same pressure) and the laboratory points.
     Curves are cached on the family, per mode, in field units. */
  var RANK_PLOT = {
    pb: { col: 'rs', kind: 'rs', title: 'Solution GOR' },
    bo: { col: 'bo', kind: 'bo', title: 'Oil formation volume factor' },
    co: { col: 'bo', kind: 'bo', title: 'Oil formation volume factor' },
    muod: { col: 'muo', kind: 'mu', title: 'Oil viscosity' },
    muob: { col: 'muo', kind: 'mu', title: 'Oil viscosity' },
    muou: { col: 'muo', kind: 'mu', title: 'Oil viscosity' },
    z: { col: 'z', kind: null, title: 'Gas z-factor' },
    pcrit: { col: 'z', kind: null, title: 'Gas z-factor' },
    mug: { col: 'mug', kind: 'mu', title: 'Gas viscosity' }
  };

  function familyCurves(fam, inp, data) {
    fam.curves = fam.curves || {};
    if (fam.curves[rankCurveMode]) return fam.curves[rankCurveMode];
    var plot = RANK_PLOT[fam.corr], part = plot.col === 'z' || plot.col === 'mug' ? 'gas' : 'oil';
    var lo = inp.pMin, hi = inp.pMax;
    data.rows.forEach(function (r) { lo = Math.min(lo, r.p); hi = Math.max(hi, r.p); });
    if (data.pb) hi = Math.max(hi, data.pb);
    var grid = [], n = 60, i;
    for (i = 0; i <= n; i++) grid.push(lo + (hi - lo) * i / n);
    var out = {};
    fam.rows.forEach(function (r) {
      var ci = JSON.parse(JSON.stringify(inp));
      ci.corr[fam.corr] = r.corr;
      ci.tuning = rankCurveMode === 'tuned' ? r.tuning : null;
      ci.pointsOnly = true;
      try {
        var m = Model.build(ci);
        out[r.corr] = grid.map(function (p) { return { p: p, v: m.at(p, part)[plot.col] }; })
          .filter(function (q) { return isFinite(q.v); });
      } catch (e) { out[r.corr] = []; }
    });
    fam.curves[rankCurveMode] = out;
    return out;
  }

  function familyChart(host, fam, sel, inp) {
    var plot = RANK_PLOT[fam.corr];
    var data = Tune.normalize(inp.lab, inp.fluid);
    var curves = familyCurves(fam, inp, data);
    var labPts = data.rows.filter(function (r) { return r[plot.col] !== null; })
      .map(function (r) { return { p: r.p, v: r[plot.col] }; });
    /* the scalar measurements belong on the chart of the family they tune */
    if (fam.corr === 'pb' && data.pb && inp.spec !== 'pb' && inp.rsb > 0) labPts.push({ p: data.pb, v: inp.rsb });
    if (fam.corr === 'muod' && data.muod) labPts.push({ p: 14.696, v: data.muod });
    labPts.sort(function (a, b) { return a.p - b.p; });

    /* the selected correlation first (it drives the tooltip), drawn bold */
    var order = fam.rows.map(function (r) { return r.corr; }).sort(function (a, b) {
      return (b === sel) - (a === sel);
    });
    var series = order.map(function (c) {
      var k = fam.rows.map(function (r) { return r.corr; }).indexOf(c);
      var tags = [];
      if (c === fam.best) tags.push('best');
      if (c === sel) tags.push('selected');
      return {
        name: (CORR_NAMES[c] || c) + (tags.length ? ' (' + tags.join(', ') + ')' : ''),
        slot: (k % 7) + 1, bold: c === sel, muted: c !== sel,
        points: curves[c].map(function (q) { return { x: conv('p', q.p), y: kindConv(plot.kind, q.v) }; })
      };
    }).filter(function (s) { return s.points.length; });
    series.push({ name: 'Laboratory', slot: 8, scatter: true, points: labPts.map(function (q) {
      return { x: conv('p', q.p), y: kindConv(plot.kind, q.v) };
    }) });
    chartInto(host, 'rank_' + fam.corr, {
      title: plot.title,
      subtitle: (rankCurveMode === 'tuned' ? 'Each correlation after its own tuning' : 'Published correlations, untuned') +
        ', against the laboratory points',
      xLabel: 'Pressure (' + label('p') + ')', yLabel: kindLabel(plot.kind), xUnit: label('p'),
      series: series, endLabels: false,
      onCursor: function (x) { setCursor(uu('p').inv(x), 'chart'); },
      fmtX: function (v) { return v.toFixed(uu('p').d); },
      fmtY: function (v) { var d = kindDigits(plot.kind); return d < 0 ? v.toExponential(3) : v.toFixed(d); }
    });
  }

  function renderScreen() {
    var host = $('rankResults'), useBtn = $('btnUseBest');
    host.textContent = '';
    var fresh = screenResult && screenKey === rankKey();
    useBtn.hidden = !fresh;
    $('rankCurves').hidden = !screenResult;
    $('rankCurvesRaw').setAttribute('aria-pressed', String(rankCurveMode === 'raw'));
    $('rankCurvesTuned').setAttribute('aria-pressed', String(rankCurveMode === 'tuned'));
    if (!screenResult) { $('rankHint').textContent = ''; return; }
    $('rankHint').textContent = fresh ? ''
      : 'The fluid inputs or the laboratory data have changed since this ranking - rank again before using it.';
    var inp = readInputs(), changes = 0;
    screenResult.forEach(function (fam) {
      var sel = inp.corr[fam.corr];
      if (fam.best && fam.best !== sel) changes++;
      var nPts = fam.rows.reduce(function (a, r) { return r.corr === (fam.best || sel) ? r.n : a; },
        fam.rows[0] ? fam.rows[0].n : 0);

      var block = document.createElement('div');
      block.className = 'rank-family';
      var head = document.createElement('h3');
      head.textContent = fam.label + ' (' + nPts + ' point' + (nPts === 1 ? '' : 's') + ')';
      block.appendChild(head);

      /* with one or two points every candidate can be tuned to fit exactly;
         say so, since the ranking then rests on the size of the adjustment */
      var tuned = fam.rows.filter(function (r) { return r.aareTuned !== null; });
      if (tuned.length > 1 && tuned.every(function (r) { return r.aareTuned < 0.1; })) {
        var why = document.createElement('p');
        why.className = 'hint';
        why.textContent = 'Every correlation can be tuned to fit ' + (nPts === 1 ? 'this point' : 'these points') +
          ' exactly, so the ranking goes to the one needing the smallest adjustment (multiplier closest to 1). ' +
          'More laboratory points would separate them.';
        block.appendChild(why);
      }

      var body = document.createElement('div');
      body.className = 'rank-body';
      var wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      var tbl = document.createElement('table');
      var th = document.createElement('thead'), hr = document.createElement('tr');
      ['Use', 'Correlation', 'Untuned AARE', 'Tuned AARE', 'Multiplier'].forEach(function (h) {
        var e = document.createElement('th'); e.textContent = h; hr.appendChild(e);
      });
      th.appendChild(hr); tbl.appendChild(th);
      var tb = document.createElement('tbody');
      fam.rows.forEach(function (r) {
        var tr = document.createElement('tr');
        if (r.corr === sel) tr.className = 'is-selected';
        var tdR = document.createElement('td');
        var rb = document.createElement('input');
        rb.type = 'radio'; rb.name = 'rank-' + fam.corr; rb.value = r.corr;
        rb.checked = r.corr === sel;
        rb.dataset.family = fam.corr;
        rb.id = 'rank-' + fam.corr + '-' + r.corr;
        rb.setAttribute('aria-label', 'Use ' + (CORR_NAMES[r.corr] || r.corr) + ' for ' + fam.label.toLowerCase());
        tdR.appendChild(rb); tr.appendChild(tdR);
        var tdN = document.createElement('td');
        var lb = document.createElement('label');
        lb.htmlFor = rb.id;
        lb.textContent = CORR_NAMES[r.corr] || r.corr;
        tdN.appendChild(lb);
        if (r.corr === fam.best) {
          var badge = document.createElement('span');
          badge.className = 'best-badge'; badge.textContent = 'best fit';
          tdN.appendChild(badge);
        }
        tr.appendChild(tdN);
        [fmtPct(r.aareRaw), fmtPct(r.aareTuned), r.mult ? '× ' + r.mult.toFixed(3) : '–'].forEach(function (t) {
          var td = document.createElement('td'); td.textContent = t; tr.appendChild(td);
        });
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      wrap.appendChild(tbl);
      body.appendChild(wrap);
      var chartHost = document.createElement('div');
      body.appendChild(chartHost);
      block.appendChild(body);
      host.appendChild(block);
      familyChart(chartHost, fam, sel, inp);
    });
    useBtn.disabled = !changes;
    useBtn.textContent = changes ? 'Use the best-fitting correlations (' + changes + ' change' + (changes === 1 ? '' : 's') + ')'
      : 'The best-fitting correlations are selected';
  }

  /* A choice in the ranking goes straight to the sidebar select, so the
     tuning step - and the tables and exports - use it. */
  function chooseCorrelation(family, name) {
    if (!CORR_SELECT[family]) return;
    $(CORR_SELECT[family]).value = name;
    $('preset').value = '';
    recompute();
  }

  function setRankCurves(mode) {
    if (mode === rankCurveMode) return;
    rankCurveMode = mode;
    renderScreen();
  }

  function useBest() {
    if (!screenResult) return;
    screenResult.forEach(function (fam) {
      if (fam.best && CORR_SELECT[fam.corr]) $(CORR_SELECT[fam.corr]).value = fam.best;
    });
    $('preset').value = '';
    recompute();
  }

  function initLab() {
    renderLabTable();
    setInput('labPb', lab.oil.pb);
    setInput('labMuod', lab.oil.muod);
    var tbl = $('labTable');
    tbl.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.dataset.row === undefined) return;
      var col = LAB_COLS[fluid][+t.dataset.col];
      lab[fluid].rows[+t.dataset.row][col.k] = labCellValue(col, t.value);
      labChanged(false);
    });
    tbl.addEventListener('paste', function (ev) {
      var t = ev.target, text = (ev.clipboardData || window.clipboardData).getData('text');
      if (t.dataset.row === undefined || !/[\t\n]/.test(text.trim())) return;
      ev.preventDefault();
      pasteBlock(+t.dataset.row, +t.dataset.col, text);
    });
    tbl.addEventListener('click', function (ev) {
      var b = ev.target.closest('.lab-del');
      if (!b) return;
      lab[fluid].rows.splice(+b.dataset.row, 1);
      labChanged(true);
    });
    ['labPb', 'labMuod'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        lab.oil[id === 'labPb' ? 'pb' : 'muod'] = toField(id);
        labChanged(false);
      });
    });
    writeLabSampling();
    [['labPRes', 'pRes'], ['labPwf', 'pwf'], ['labGor', 'gor']].forEach(function (pr) {
      $(pr[0]).addEventListener('input', function () {
        lab.oil.sampling[pr[1]] = toField(pr[0]);
        labChanged(false);
      });
    });
    $('labType').addEventListener('change', function () {
      lab.oil.sampling.type = $('labType').value;
      $('rowLabPwf').hidden = lab.oil.sampling.type !== 'bhs';
      labChanged(false);
    });
    $('btnAddRow').addEventListener('click', function () {
      lab[fluid].rows.push({ p: null, rs: null, bo: null, muo: null, z: null, mug: null });
      renderLabTable();
      var cells = $('labTable').querySelectorAll('tbody tr:last-child input');
      if (cells.length) cells[0].focus();
    });
    $('btnClearLab').addEventListener('click', function () {
      var keep = lab[fluid].tune;
      lab[fluid] = emptyLab(); lab[fluid].tune = keep;
      if (fluid === 'oil') { setInput('labPb', null); setInput('labMuod', null); writeLabSampling(); }
      labChanged(true);
    });
    $('tuneOn').addEventListener('change', function (ev) {
      lab[fluid].tune = ev.target.checked;
      recompute();
    });
    $('btnRank').addEventListener('click', runRanking);
    $('btnUseBest').addEventListener('click', useBest);
    $('rankResults').addEventListener('change', function (ev) {
      if (ev.target.type === 'radio' && ev.target.dataset.family) chooseCorrelation(ev.target.dataset.family, ev.target.value);
    });
    $('rankCurvesRaw').addEventListener('click', function () { setRankCurves('raw'); });
    $('rankCurvesTuned').addEventListener('click', function () { setRankCurves('tuned'); });
  }

  /* ---------------- export ---------------- */
  function renderExport() {
    var text = Exp.generate(model, $('fmtSel').value, $('fmtUnits').value);
    var lines = text.split('\n');
    $('exportPreview').textContent = lines.length > 900
      ? lines.slice(0, 900).join('\n') + '\n... (' + (lines.length - 900) + ' more lines in the downloaded file)'
      : text;
  }

  /* Inside a claude.ai artifact page the sandbox blocks plain download
     links, so the file goes through the viewer's `downloads` capability
     (which only accepts common extensions: .INC / .dat get a .txt suffix).
     Opened as a local file or on GitHub Pages, a normal link is used. */
  var downloadsApi = null;
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('downloads').then(function (d) { downloadsApi = d; }, function () { downloadsApi = null; });
  }

  function download() {
    var fmtName = $('fmtSel').value, u = $('fmtUnits').value;
    var name = Exp.filename(fmtName, u);
    saveFile(name, Exp.generate(model, fmtName, u), function (saved, msg) {
      $('copyStatus').textContent = saved ? 'Saved ' + saved + (/\.txt$/.test(saved) && fmtName !== 'csv' && fmtName !== 'json'
        ? ' - remove the .txt suffix before loading it into the simulator.' : '.')
        : msg + (msg === 'Download cancelled.' ? '' : ' Use Copy to clipboard instead.');
    });
  }

  /* Hand a text file to the viewer. done(savedName) on success, or
     done(null, message) when it was cancelled or cannot be saved here. */
  function saveFile(name, text, done) {
    if (downloadsApi) {
      if (!/\.(csv|json|txt)$/i.test(name)) name += '.txt';
      downloadsApi.save({ filename: name, data: text }).then(function () { done(name); }, function (e) {
        var code = e && e.code;
        done(null, code === 'declined' ? 'Download cancelled.' : 'Download is not available here.');
      });
      return;
    }
    var blob = new Blob([text], { type: /\.json$/i.test(name) ? 'application/json' : 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    done(name);
  }

  /* ---------------- project files: save and reopen a session ---------------- */
  var Proj = window.PVTProject;

  function projectState() {
    var other = fluid === 'oil' ? 'gas' : 'oil', inputs = {};
    inputs[fluid] = { inputs: readInputs(), preset: $('preset').value };
    var back = savedByFluid[other];
    if (!back) { try { back = JSON.parse(localStorage.getItem('pvt.inputs.' + other)); } catch (e) { back = null; } }
    inputs[other] = back && back.inputs ? back : null;
    return { name: $('projectName').value, fluid: fluid, units: units, labMode: labMode,
             inputs: inputs, lab: lab, samples: samples };
  }

  function projectSay(text) { $('projectStatus').textContent = text; }

  function saveProject() {
    var p = Proj.pack(projectState());
    var name = Proj.filename(p.name, new Date(p.savedAt));
    saveFile(name, JSON.stringify(p, null, 1), function (saved, msg) {
      projectSay(saved ? 'Saved ' + saved + '. Open it later with Open project to carry on.' : msg);
    });
  }

  /* Opening a project puts it where the page keeps its own state and
     reloads, so it starts exactly as a returning visit would. */
  function openProjectFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var p;
      try { p = Proj.unpack(String(reader.result)); }
      catch (e) { projectSay(e.message); return; }
      try {
        var cur = p.inputs[p.fluid];
        localStorage.setItem('pvt.inputs', JSON.stringify(cur.inputs));
        localStorage.setItem('pvt.preset', cur.preset || '');
        ['oil', 'gas'].forEach(function (f) {
          if (p.inputs[f]) localStorage.setItem('pvt.inputs.' + f, JSON.stringify(p.inputs[f]));
          else localStorage.removeItem('pvt.inputs.' + f);
        });
        localStorage.setItem('pvt.units', p.units);
        localStorage.setItem('pvt.labMode', p.labMode);
        localStorage.setItem('pvt.lab', JSON.stringify(p.lab && p.lab.oil && p.lab.gas ? p.lab : { oil: emptyLab(), gas: emptyLab() }));
        localStorage.setItem('pvt.samples', JSON.stringify(p.samples));
        localStorage.setItem('pvt.projectName', p.name);
      } catch (e) {
        projectSay('This browser blocks the storage the page needs to open a project.');
        return;
      }
      location.hash = '';
      location.reload();
    };
    reader.onerror = function () { projectSay('The file could not be read.'); };
    reader.readAsText(file);
  }

  function initProject() {
    try { $('projectName').value = localStorage.getItem('pvt.projectName') || ''; } catch (e) { /* ignore */ }
    $('projectName').addEventListener('input', function () {
      try { localStorage.setItem('pvt.projectName', $('projectName').value); } catch (e) { /* ignore */ }
    });
    $('btnSaveProject').addEventListener('click', saveProject);
    $('btnOpenProject').addEventListener('click', function () { $('projectFile').value = ''; $('projectFile').click(); });
    $('projectFile').addEventListener('change', function (ev) { openProjectFile(ev.target.files[0]); });
  }

  /* ---------------- compute + render ---------------- */
  function say(kind, text) {
    var box = $('errorBox');
    box.textContent = '';
    if (!text) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(notice(kind, kind === 'error' ? '✕' : 'i', text));
  }

  function recompute() {
    var inp;
    try {
      inp = readInputs();
      if (inp.fluid === 'gas') {
        if (inp.gasKind !== 'dry') {
          if (!(inp.apiC > 30 && inp.apiC < 90)) throw new Error('Condensate gravity must lie between 30 and 90 API.');
          if (!(inp.cgr >= 0 && inp.cgr < 1000)) throw new Error('The condensate-gas ratio must lie between 0 and 1000 STB/MMscf.');
        }
      } else if (!(inp.api > 5 && inp.api < 70)) throw new Error('Oil gravity must lie between 5 and 70 API.');
      if (!(inp.salinityPpm >= 0 && inp.salinityPpm <= 350000)) {
        throw new Error('Brine salinity must lie between 0 and 350,000 ppm (0 - 35 wt% NaCl).');
      }
      if (!(inp.gammaG > 0.5 && inp.gammaG < 2.0)) throw new Error('Gas gravity must lie between 0.5 and 2.0 (air = 1).');
      if (!(inp.tempF > 32 && inp.tempF < 400)) throw new Error('Reservoir temperature must lie between 32 and 400 degF (0 - 204 degC).');
      if (!(inp.pMax > inp.pMin && inp.pMin > 0)) throw new Error('The maximum table pressure must exceed the minimum, and both must be positive.');
      if (inp.yCO2 + inp.yH2S + inp.yN2 >= 1) throw new Error('Non-hydrocarbon mole fractions must sum to less than 100%.');
      baseModel = Model.build(inp);
      model = baseModel;
      say(null, null);
    } catch (e) {
      say('error', e.message);
      return;
    }
    /* regress the selected correlations against the laboratory data */
    regression = null; tuneError = null; fieldTuned = null;
    var mode = effectiveMode();
    var pooled = mode === 'several' && samples.fieldTune ? ensurePooledFit() : null;
    if (pooled) {
      /* field-wide tuning from the PVT samples tab */
      inp.tuning = pooledPayload(pooled);
      fieldTuned = pooled;
      try { model = Model.build(inp); } catch (e) { tuneError = e.message; model = baseModel; }
      delete inp.tuning;
    } else if (mode === 'one' && inp.tune && Tune.hasData(inp.lab, inp.fluid)) {
      try {
        regression = Tune.regress(inp, inp.lab);
        inp.tuning = tuningPayload(regression);
        model = Model.build(inp);
      } catch (e) {
        regression = null; tuneError = e.message; model = baseModel;
        delete inp.tuning;
      }
    }
    renderSummary();
    renderCharts();
    renderVisuals();
    renderTable();
    renderCompare();
    renderLabResults();
    renderSamples();
    renderExport();
    persist(inp);
  }

  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(recompute, 120);
  }

  /* ================================================================ *
   * PVT samples: screening several PVT reports and a field-wide fit
   * ================================================================ */

  var Smp = window.PVTSamples;

  /* Scalar fields of a sample: where they live in the sample, and their unit kind. */
  var SAMPLE_FIELDS = [
    { k: 'api', grp: 'fluid', kind: null, head: 'Oil gravity', unit: 'API' },
    { k: 'gammaG', grp: 'fluid', kind: null, head: 'Gas gravity', unit: 'air = 1' },
    { k: 'rsb', grp: 'fluid', kind: 'rs', head: 'R<sub>sb</sub>' },
    { k: 'tempF', grp: 'fluid', kind: 'T', head: 'Temperature' },
    { k: 'pb', grp: 'lab', kind: 'p', head: 'Measured P<sub>b</sub>' },
    { k: 'muod', grp: 'lab', kind: 'mu', head: 'Dead-oil viscosity' },
    { k: 'pRes', grp: 'sampling', kind: 'p', head: 'Reservoir pressure at sampling' },
    { k: 'pwf', grp: 'sampling', kind: 'p', head: 'Flowing pressure at sampling', bhsOnly: true },
    { k: 'gor', grp: 'sampling', kind: 'rs', head: 'Producing GOR at sampling' },
    { k: 'depth', grp: 'sampling', kind: 'len', head: 'Sampling depth, TVD', bhsOnly: true }
  ];
  var SAMPLE_COLS = ['p', 'rs', 'bo', 'muo', 'z', 'mug'];
  var STATUS_GLYPH = { pass: '✓', warn: '!', fail: '✕', na: '–' };
  var STATUS_WORD = { pass: 'passes', warn: 'passes with warnings', fail: 'fails', na: 'not checked' };

  /* The example field: three sound samples and three with textbook faults
     (a typo in Bo, a bottomhole sample that lost gas, a recombination at the
     wrong GOR). Bottomhole samples carry a sampling depth (ft TVD) on a
     1.6 degF/100 ft geothermal gradient. Rows are [p, Rs, Bo, muo, z, mug]
     in field units. */
  var DEMO_SAMPLES = [{"id":"s1","name":"A-1 DST 2","type":"bhs","fluid":{"api":34.2,"gammaG":0.76,"rsb":640,"tempF":186},"sampling":{"pRes":4650,"pwf":3900,"gor":655,"depth":8550},"lab":{"pb":2853,"muod":2.957,"rows":[[4850,640,1.3019,0.781,null,null],[4050,640,1.3144,0.729,null,null],[3450,640,1.3264,0.696,null,null],[2850,640,1.3402,0.663,0.8519,0.0204],[2280,489,1.2683,0.78,0.8389,0.0183],[1710,348,1.2033,0.955,0.8521,0.0161],[1140,217,1.1438,1.234,0.8893,0.0146],[570,97,1.0927,1.754,0.942,0.0133],[200,30,1.0662,2.406,0.9764,0.0129]]}},{"id":"s2","name":"A-2 MDT","type":"bhs","fluid":{"api":35,"gammaG":0.78,"rsb":705,"tempF":182},"sampling":{"pRes":4600,"pwf":3950,"gor":690,"depth":8300},"lab":{"pb":2939,"muod":2.906,"rows":[[4930,705,1.3311,0.726,null,null],[4130,705,1.347,0.677,null,null],[3530,705,1.3612,0.637,null,null],[2930,703,1.3737,0.618,0.8439,0.0213],[2350,539,1.2931,0.719,0.8286,0.0187],[1760,383,1.2185,0.887,0.8391,0.0165],[1170,237,1.1529,1.158,0.8787,0.0145],[590,107,1.0966,1.682,0.9322,0.0133],[200,32,1.0661,2.33,0.9752,0.0126]]}},{"id":"s3","name":"B-1 DST 1","type":"sep","fluid":{"api":33.6,"gammaG":0.75,"rsb":585,"tempF":190},"sampling":{"pRes":4700,"gor":600},"lab":{"pb":2754,"muod":2.967,"rows":[[4740,585,1.2763,0.825,null,null],[3940,585,1.2865,0.765,null,null],[3340,585,1.2982,0.735,null,null],[2750,585,1.3128,0.702,null,null],[2200,447,1.2507,0.828,0.853,0.0179],[1650,321,1.1909,0.994,0.8611,0.0158],[1100,197,1.1354,1.293,0.8952,0.0145],[550,88,1.0924,1.814,0.947,0.0133],[200,29,1.0696,2.419,0.9789,0.0128]]}},{"id":"s4","name":"A-3 repeat study","type":"bhs","fluid":{"api":34.6,"gammaG":0.77,"rsb":668,"tempF":184},"sampling":{"pRes":4620,"pwf":4000,"gor":660,"depth":8420},"lab":{"pb":2874,"muod":2.92,"rows":[[4880,668,1.3123,0.767,null,null],[4080,668,1.3297,0.707,null,null],[3480,668,1.3391,0.665,null,null],[2880,668,1.3549,0.633,null,null],[2300,513,1.2789,0.756,0.8357,0.0182],[1730,363,1.2808,0.91,0.8494,0.0163],[1150,224,1.1481,1.205,0.8873,0.0146],[580,102,1.0942,1.702,0.938,0.0134],[200,31,1.0655,2.369,0.9803,0.0128]]}},{"id":"s5","name":"B-2 production test","type":"bhs","fluid":{"api":33.9,"gammaG":0.76,"rsb":560,"tempF":189},"sampling":{"pRes":4680,"pwf":2650,"gor":760,"depth":8740},"lab":{"pb":2075,"muod":2.939,"rows":[[4070,543,1.2716,0.815,null,null],[3270,543,1.2856,0.749,null,null],[2670,543,1.3023,0.72,null,null],[2070,418,1.2421,0.83,0.848,0.0173],[1660,320,1.1955,0.979,0.8626,0.016],[1240,226,1.1525,1.163,0.8847,0.0148],[830,142,1.1153,1.483,0.9152,0.0139],[410,63,1.0815,1.999,0.9542,0.0132],[170,24,1.0656,2.477,0.981,0.0127]]}},{"id":"s6","name":"C-1 recombined","type":"sep","fluid":{"api":34.8,"gammaG":0.77,"rsb":910,"tempF":185},"sampling":{"pRes":4640,"gor":700},"lab":{"pb":3704,"muod":2.814,"rows":[[5710,910,1.4353,0.612,null,null],[4910,910,1.4473,0.574,null,null],[4310,910,1.4642,0.549,null,null],[3710,904,1.4769,0.516,0.8841,0.0243],[2970,693,1.3703,0.621,0.847,0.0211],[2230,493,1.2718,0.75,0.8368,0.0183],[1490,306,1.1843,1,0.8604,0.0154],[740,134,1.1081,1.503,0.9242,0.0135],[200,31,1.0669,2.293,0.9751,0.0128]]}}];

  var samples = { list: [], fieldTune: false };
  var openSample = {}, pickedSample = null;
  var sampleScreen = null, sampleScreenKey = null;
  var pooledFit = null, pooledKey = null, pooledError = null;
  var poolRank = null, poolRankKey = null, poolRanking = false;

  function newSampleId() { return 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function emptySampleRow() { return { p: null, rs: null, bo: null, muo: null, z: null, mug: null }; }

  function cleanSample(o) {
    o = o || {};
    var f = o.fluid || {}, sm = o.sampling || {}, l = o.lab || {};
    return {
      id: o.id || newSampleId(), name: String(o.name || 'Sample'),
      type: o.type === 'sep' ? 'sep' : 'bhs',
      fluid: { api: finiteOrNull(f.api), gammaG: finiteOrNull(f.gammaG), rsb: finiteOrNull(f.rsb), tempF: finiteOrNull(f.tempF) },
      sampling: { pRes: finiteOrNull(sm.pRes), pwf: finiteOrNull(sm.pwf), gor: finiteOrNull(sm.gor),
                  depth: finiteOrNull(sm.depth) },
      lab: { pb: finiteOrNull(l.pb), muod: finiteOrNull(l.muod),
             rows: (l.rows || []).map(function (r) {
               if (Array.isArray(r)) r = { p: r[0], rs: r[1], bo: r[2], muo: r[3], z: r[4], mug: r[5] };
               var out = {};
               SAMPLE_COLS.forEach(function (k) { out[k] = finiteOrNull(r[k]); });
               return out;
             }) },
      include: o.include === true || o.include === false ? o.include : null
    };
  }

  /* What the screening sees: complete rows only. */
  function samplesForModel() {
    return samples.list.map(function (s) {
      var c = JSON.parse(JSON.stringify(s));
      c.lab.rows = c.lab.rows.filter(function (r) { return r.p !== null; });
      return c;
    });
  }

  /* The case settings the samples share: the selected correlations. */
  function sampleBase() {
    var inp = readInputs();
    return { corr: inp.corr, salinity: inp.salinity, pMax: inp.pMax };
  }

  function sampleField(s, f) { return s[f.grp][f.k]; }

  /* ---------- editor ---------- */

  function renderSampleList() {
    var host = $('sampleList');
    if (!host) return;
    host.textContent = '';
    if (!samples.list.length) {
      var p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'No samples yet. Add one per PVT report, add the Lab data table, or load the example field to see the screening at work.';
      host.appendChild(p);
      return;
    }
    samples.list.forEach(function (s, i) { host.appendChild(sampleCard(s, i)); });
    paintSampleStatus();
  }

  function sampleCard(s, i) {
    var d = document.createElement('details');
    d.className = 'sample-card';
    d.dataset.id = s.id;
    d.open = !!openSample[s.id];
    d.addEventListener('toggle', function () { openSample[s.id] = d.open; });

    var sum = document.createElement('summary');
    var dot = document.createElement('span');
    dot.className = 'qc-dot na'; dot.dataset.statusFor = s.id; dot.textContent = STATUS_GLYPH.na;
    var nm = document.createElement('span');
    nm.className = 'sample-name'; nm.textContent = s.name;
    var meta = document.createElement('span');
    meta.className = 'sample-meta';
    meta.dataset.metaFor = s.id;
    sum.appendChild(dot); sum.appendChild(nm); sum.appendChild(meta);
    d.appendChild(sum);

    var body = document.createElement('div');
    body.className = 'sample-body';

    var top = document.createElement('div');
    top.className = 'sample-top';
    var fName = document.createElement('div');
    fName.className = 'field';
    fName.innerHTML = '<label>Name</label>';
    var inName = document.createElement('input');
    inName.type = 'text'; inName.value = s.name;
    inName.setAttribute('aria-label', 'Sample name');
    inName.addEventListener('input', function () {
      s.name = inName.value || 'Sample'; nm.textContent = s.name; samplesChanged();
    });
    fName.appendChild(inName);
    var fType = document.createElement('div');
    fType.className = 'field';
    fType.innerHTML = '<label>Sample type</label>';
    var selType = document.createElement('select');
    [['bhs', 'Bottomhole'], ['sep', 'Separator recombination']].forEach(function (o) {
      var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; selType.appendChild(op);
    });
    selType.value = s.type;
    selType.setAttribute('aria-label', 'Sample type');
    selType.addEventListener('change', function () {
      s.type = selType.value;
      body.querySelectorAll('.bhs-only').forEach(function (e) { e.hidden = s.type !== 'bhs'; });
      samplesChanged();
    });
    fType.appendChild(selType);
    top.appendChild(fName); top.appendChild(fType);
    body.appendChild(top);

    var grid = document.createElement('div');
    grid.className = 'sample-scalars';
    SAMPLE_FIELDS.forEach(function (f) {
      var w = document.createElement('div');
      w.className = 'field' + (f.bhsOnly ? ' bhs-only' : '');
      if (f.bhsOnly) w.hidden = s.type !== 'bhs';
      var lb = document.createElement('label');
      lb.innerHTML = f.head + ' <span class="unit">' + (f.kind ? label(f.kind) : f.unit) + '</span>';
      var inp = document.createElement('input');
      inp.type = 'text'; inp.inputMode = 'decimal';
      inp.value = labCellText(f, sampleField(s, f));
      inp.placeholder = '—';
      inp.addEventListener('input', function () {
        s[f.grp][f.k] = labCellValue(f, inp.value);
        samplesChanged();
      });
      lb.htmlFor = inp.id = 'smp-' + s.id + '-' + f.k;
      w.appendChild(lb); w.appendChild(inp);
      grid.appendChild(w);
    });
    body.appendChild(grid);

    var wrap = document.createElement('div');
    wrap.className = 'table-wrap lab-wrap';
    var tbl = document.createElement('table');
    tbl.className = 'lab-table';
    wrap.appendChild(tbl);
    body.appendChild(wrap);
    renderSampleTable(tbl, s);

    var bar = document.createElement('div');
    bar.className = 'export-bar lab-actions';
    var add = document.createElement('button');
    add.type = 'button'; add.textContent = 'Add row';
    add.addEventListener('click', function () { s.lab.rows.push(emptySampleRow()); renderSampleTable(tbl, s); });
    var dup = document.createElement('button');
    dup.type = 'button'; dup.className = 'ghost'; dup.textContent = 'Duplicate sample';
    dup.addEventListener('click', function () {
      var c = cleanSample(JSON.parse(JSON.stringify(s)));
      c.id = newSampleId(); c.name = s.name + ' (copy)';
      samples.list.splice(i + 1, 0, c);
      openSample[c.id] = true;
      renderSampleList(); samplesChanged();
    });
    var del = document.createElement('button');
    del.type = 'button'; del.className = 'ghost danger'; del.textContent = 'Delete sample';
    del.addEventListener('click', function () {
      samples.list = samples.list.filter(function (x) { return x.id !== s.id; });
      if (pickedSample === s.id) pickedSample = null;
      renderSampleList(); samplesChanged();
    });
    bar.appendChild(add); bar.appendChild(dup); bar.appendChild(del);
    body.appendChild(bar);
    d.appendChild(body);
    return d;
  }

  function renderSampleTable(tbl, s) {
    var cols = LAB_COLS.oil;
    while (s.lab.rows.length < 3) s.lab.rows.push(emptySampleRow());
    tbl.textContent = '';
    var th = document.createElement('thead'), hr = document.createElement('tr');
    cols.forEach(function (c) {
      var h = document.createElement('th');
      h.textContent = c.head + (c.kind ? ' (' + label(c.kind) + ')' : '');
      hr.appendChild(h);
    });
    hr.appendChild(document.createElement('th'));
    th.appendChild(hr); tbl.appendChild(th);
    var tb = document.createElement('tbody');
    s.lab.rows.forEach(function (r, i) {
      var tr = document.createElement('tr');
      cols.forEach(function (c, j) {
        var td = document.createElement('td');
        var inp = document.createElement('input');
        inp.type = 'text'; inp.inputMode = 'decimal';
        inp.value = labCellText(c, r[c.k]);
        inp.setAttribute('aria-label', s.name + ', ' + c.head + ', row ' + (i + 1));
        inp.addEventListener('input', function () { r[c.k] = labCellValue(c, inp.value); samplesChanged(); });
        inp.addEventListener('paste', function (ev) {
          var text = (ev.clipboardData || window.clipboardData).getData('text');
          if (!/[\t\n;]/.test(text)) return;
          ev.preventDefault();
          pasteSampleBlock(s, i, j, text);
          renderSampleTable(tbl, s);
          samplesChanged();
        });
        td.appendChild(inp); tr.appendChild(td);
      });
      var tdD = document.createElement('td');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ghost lab-del'; b.textContent = '✕';
      b.setAttribute('aria-label', 'Delete row ' + (i + 1));
      b.addEventListener('click', function () { s.lab.rows.splice(i, 1); renderSampleTable(tbl, s); samplesChanged(); });
      tdD.appendChild(b); tr.appendChild(tdD);
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
  }

  /* Same rules as the Lab data table: header and unit rows are skipped. */
  function pasteSampleBlock(s, r0, c0, text) {
    var cols = LAB_COLS.oil;
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; });
    var r = r0;
    lines.forEach(function (line) {
      var cells = line.split('\t');
      if (cells.length === 1) cells = line.split(/[;,]\s*/);
      if (labCellValue(cols[c0] || cols[0], cells[0]) === null) return;
      while (s.lab.rows.length <= r) s.lab.rows.push(emptySampleRow());
      cells.forEach(function (cell, j) {
        var col = cols[c0 + j];
        if (col) s.lab.rows[r][col.k] = labCellValue(col, cell);
      });
      r++;
    });
  }

  var sampleTimer = null;
  function samplesChanged() {
    persistSamples();
    clearTimeout(sampleTimer);
    sampleTimer = setTimeout(function () {
      if (samples.fieldTune) recompute(); else renderSamples();
    }, 250);
  }

  function persistSamples() {
    try { localStorage.setItem('pvt.samples', JSON.stringify(samples)); } catch (e) { /* ignore */ }
  }
  function restoreSamples() {
    try {
      var o = JSON.parse(localStorage.getItem('pvt.samples'));
      if (o && Array.isArray(o.list)) {
        samples.list = o.list.map(cleanSample);
        samples.fieldTune = !!o.fieldTune;
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- screening and the pooled fit (cached) ---------- */

  function screenKeyNow() { return JSON.stringify([samplesForModel(), sampleBase().corr]); }

  function ensureSampleScreen() {
    var key = screenKeyNow();
    if (key === sampleScreenKey) return sampleScreen;
    sampleScreenKey = key;
    sampleScreen = samples.list.length ? Smp.screenSamples(sampleBase(), samplesForModel()) : null;
    return sampleScreen;
  }

  function acceptedSamples() {
    var scr = ensureSampleScreen();
    if (!scr) return [];
    var list = samplesForModel();
    return list.filter(function (s, i) { return scr[i].included; });
  }

  function ensurePooledFit() {
    var acc = acceptedSamples();
    var key = JSON.stringify([acc, sampleBase().corr]);
    if (key === pooledKey) return pooledFit;
    pooledKey = key; pooledFit = null; pooledError = null;
    if (!acc.length) return null;
    try { pooledFit = Smp.regressPooled(sampleBase(), acc); }
    catch (e) { pooledError = e.message; }
    return pooledFit;
  }

  /* The model's tuning block: multipliers, the pooled fit for the deck
     header, and where they came from. */
  function pooledPayload(fit) {
    var out = {}, k;
    for (k in fit.tuning) out[k] = fit.tuning[k];
    out.fit = fit.props.filter(function (p) { return p.n; }).map(function (p) {
      return { label: p.label, n: p.n, before: p.before, after: p.after };
    });
    out.source = 'field-wide fit to ' + fit.perSample.length + ' screened PVT sample' +
      (fit.perSample.length === 1 ? '' : 's') + ' (' + fit.perSample.map(function (s) { return s.name; }).join(', ') + ')';
    return out;
  }

  /* ---------- rendering ---------- */

  function renderSamples() {
    if (!$('screenTable') || effectiveMode() !== 'several') return;
    var scr = ensureSampleScreen();
    paintSampleStatus();
    renderScreenTable(scr);
    renderScreenDetail(scr);
    renderScreenCharts(scr);
    renderPooled();
    renderCaseSampleSelect();
    $('fieldTuneOn').checked = samples.fieldTune;
  }

  function paintSampleStatus() {
    var scr = sampleScreen;
    samples.list.forEach(function (s, i) {
      var dot = document.querySelector('[data-status-for="' + s.id + '"]');
      var meta = document.querySelector('[data-meta-for="' + s.id + '"]');
      var r = scr && scr[i] && scr[i].id === s.id ? scr[i] : null;
      if (dot) { dot.className = 'qc-dot ' + (r ? r.status : 'na'); dot.textContent = STATUS_GLYPH[r ? r.status : 'na']; }
      if (meta) {
        var n = s.lab.rows.filter(function (x) { return x.p !== null; }).length;
        meta.textContent = (s.type === 'sep' ? 'Recombined' : 'Bottomhole') + ', ' + n + ' row' + (n === 1 ? '' : 's') +
          (r ? ' — ' + (r.included ? 'used in the fit' : 'left out') : '');
      }
    });
  }

  function renderScreenTable(scr) {
    var tbl = $('screenTable'), sumHost = $('screenSummary');
    tbl.textContent = ''; sumHost.textContent = '';
    if (!scr) return;
    var nIn = scr.filter(function (r) { return r.included; }).length;
    var nFail = scr.filter(function (r) { return r.status === 'fail'; }).length;
    sumHost.appendChild(notice(nIn ? (nFail ? 'warn' : 'ok') : 'error', nIn ? (nFail ? '!' : '✓') : '✕',
      nIn + ' of ' + scr.length + ' sample' + (scr.length === 1 ? '' : 's') + ' used in the fit' +
      (nFail ? '; ' + nFail + ' fail' + (nFail === 1 ? 's' : '') + ' the screening' : '') + '.' +
      (scr.length < 3 ? ' The checks against the other samples need three or more.' : '')));

    var checks = Smp.CHECKS;
    var th = document.createElement('thead'), hr = document.createElement('tr');
    ['Use', 'Sample', 'Pb meas.', 'Pb corr.'].concat(checks.map(function (c) { return c.short; })).forEach(function (h, k) {
      var e = document.createElement('th');
      e.textContent = h;
      if (k === 2 || k === 3) e.textContent += ' (' + label('p') + ')';
      if (k >= 4) e.title = checks[k - 4].label;
      hr.appendChild(e);
    });
    th.appendChild(hr); tbl.appendChild(th);
    var tb = document.createElement('tbody');
    scr.forEach(function (r, i) {
      var s = samples.list[i];
      var tr = document.createElement('tr');
      if (r.id === pickedSample) tr.className = 'is-selected';
      if (!r.included) tr.classList.add('is-out');
      var tdU = document.createElement('td');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = r.included;
      cb.setAttribute('aria-label', 'Use ' + r.name + ' in the fit');
      cb.addEventListener('change', function () {
        s.include = cb.checked === r.auto ? null : cb.checked;
        samplesChanged();
      });
      tdU.appendChild(cb);
      if (r.overridden) {
        var ov = document.createElement('button');
        ov.type = 'button'; ov.className = 'ghost override';
        ov.textContent = 'your call';
        ov.title = 'Overrides the screening - select to follow the screening again';
        ov.addEventListener('click', function () { s.include = null; samplesChanged(); });
        tdU.appendChild(ov);
      }
      tr.appendChild(tdU);
      var tdN = document.createElement('td');
      var nb = document.createElement('button');
      nb.type = 'button'; nb.className = 'link'; nb.textContent = r.name;
      nb.addEventListener('click', function () { pickedSample = r.id; renderSamples(); });
      tdN.appendChild(nb); tr.appendChild(tdN);
      [r.pbMeas, r.pbCalc].forEach(function (v) {
        var td = document.createElement('td'); td.textContent = v ? fmt('p', v) : '–'; tr.appendChild(td);
      });
      checks.forEach(function (c) {
        var q = r.checks.filter(function (x) { return x.key === c.key; })[0];
        var st = q ? q.status : 'na';
        var td = document.createElement('td');
        var sp = document.createElement('span');
        sp.className = 'qc-dot ' + st; sp.textContent = STATUS_GLYPH[st];
        sp.title = c.label + ': ' + (q ? q.detail : 'not checked');
        td.appendChild(sp); tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
  }

  function renderScreenDetail(scr) {
    var host = $('screenDetail');
    host.textContent = '';
    if (!scr) return;
    var r = scr.filter(function (x) { return x.id === pickedSample; })[0];
    if (!r) {
      /* nothing picked: open on the first sample that needs attention */
      r = scr.filter(function (x) { return x.status === 'fail'; })[0] || scr.filter(function (x) { return x.status === 'warn'; })[0];
      if (!r) return;
    }
    var h = document.createElement('h3');
    h.className = 'screen-detail-head';
    h.textContent = r.name + ' ' + STATUS_WORD[r.status] + (r.included ? ' — used in the fit' : ' — left out of the fit');
    host.appendChild(h);
    renderCheckList(host, r.checks);
  }

  /* Problems in full, passes and unchecked items as a compact list. */
  function renderCheckList(host, checks) {
    checks.filter(function (c) { return c.status === 'fail' || c.status === 'warn'; })
      .sort(function (a, b) { return (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1); })
      .forEach(function (c) {
        var n = notice(c.status === 'fail' ? 'error' : 'warn', STATUS_GLYPH[c.status], '');
        var b = document.createElement('strong'); b.textContent = c.label + '. ';
        n.lastChild.appendChild(b); n.lastChild.appendChild(document.createTextNode(c.detail));
        host.appendChild(n);
      });
    var rest = checks.filter(function (c) { return c.status === 'pass' || c.status === 'na'; });
    if (!rest.length) return;
    var ul = document.createElement('ul');
    ul.className = 'check-list';
    rest.forEach(function (c) {
      var li = document.createElement('li');
      var dot = document.createElement('span');
      dot.className = 'qc-dot ' + c.status; dot.textContent = STATUS_GLYPH[c.status];
      var b = document.createElement('strong'); b.textContent = c.label + '. ';
      li.appendChild(dot); li.appendChild(b); li.appendChild(document.createTextNode(c.detail));
      ul.appendChild(li);
    });
    host.appendChild(ul);
  }

  /* Measured against correlated Pb: the field trend is the accepted
     samples' median bias; a sample off the trend stands out at a glance. */
  function renderScreenCharts(scr) {
    var host = $('screenCharts');
    host.textContent = '';
    if (!scr) return;
    var pts = scr.filter(function (r) { return r.pbMeas && r.pbCalc; });
    if (!pts.length) return;
    var acc = pts.filter(function (r) { return r.included; }), out = pts.filter(function (r) { return !r.included; });
    var lo = Infinity, hi = 0;
    pts.forEach(function (r) { lo = Math.min(lo, r.pbCalc, r.pbMeas); hi = Math.max(hi, r.pbCalc, r.pbMeas); });
    lo *= 0.85; hi *= 1.1;
    var line = function (k) { return [{ x: conv('p', lo), y: conv('p', lo * k) }, { x: conv('p', hi), y: conv('p', hi * k) }]; };
    var series = [{ name: 'Measured = correlation', slot: 7, dashed: true, points: line(1) }];
    if (acc.length) {
      var logs = acc.map(function (r) { return Math.log(r.pbMeas / r.pbCalc); }).sort(function (a, b) { return a - b; });
      var med = logs.length % 2 ? logs[(logs.length - 1) / 2] : 0.5 * (logs[logs.length / 2 - 1] + logs[logs.length / 2]);
      series.push({ name: 'Field trend (' + (med >= 0 ? '+' : '') + (100 * (Math.exp(med) - 1)).toFixed(1) + ' %)', slot: 1, points: line(Math.exp(med)) });
    }
    var dots = function (list) { return list.map(function (r) { return { x: conv('p', r.pbCalc), y: conv('p', r.pbMeas) }; }); };
    if (acc.length) series.push({ name: 'Used in the fit', slot: 1, scatter: true, points: dots(acc) });
    if (out.length) series.push({ name: 'Left out', slot: 5, scatter: true, points: dots(out) });
    chartInto(host, 'smp_pb', {
      title: 'Measured against correlated bubble point',
      subtitle: 'Correlation: ' + (CORR_NAMES[sampleBase().corr.pb] || sampleBase().corr.pb) + ', untuned, at each sample\'s Rsb',
      xLabel: 'Pb from the correlation (' + label('p') + ')', yLabel: 'Measured Pb (' + label('p') + ')', xUnit: label('p'),
      series: series, endLabels: false,
      fmtX: function (v) { return v.toFixed(uu('p').d); }, fmtY: function (v) { return v.toFixed(uu('p').d); }
    });
  }

  function renderPooled() {
    var fit = ensurePooledFit();
    var notes = $('poolNotes'), tbl = $('poolTable'), tbl2 = $('poolSampleTable'), charts2 = $('poolCharts');
    notes.textContent = ''; tbl.textContent = ''; tbl2.textContent = ''; charts2.textContent = '';
    var acc = acceptedSamples();
    $('btnPoolRank').disabled = !acc.length || poolRanking;
    renderPoolRank();
    if (pooledError) notes.appendChild(notice('error', '✕', 'The field-wide regression failed: ' + pooledError));
    if (!fit) {
      if (samples.list.length) notes.appendChild(notice('info', 'i', 'No sample passes the screening yet - correct the failing checks or tick Use to include a sample on your own judgement.'));
      return;
    }
    fit.notes.forEach(function (n) { notes.appendChild(notice('warn', '!', n)); });

    /* pooled fit per property */
    var th = document.createElement('thead'), hr = document.createElement('tr');
    ['Property', 'Samples', 'Points', 'Untuned AARE', 'Tuned AARE', 'Max error, tuned'].forEach(function (h) {
      var e = document.createElement('th'); e.textContent = h; hr.appendChild(e);
    });
    th.appendChild(hr); tbl.appendChild(th);
    var tb = document.createElement('tbody');
    fit.props.filter(function (p) { return p.n; }).forEach(function (p) {
      var tr = document.createElement('tr');
      [p.label, String(p.samples), String(p.n), fmtPct(p.before), fmtPct(p.after), fmtPct(p.maxAfter)].forEach(function (t) {
        var td = document.createElement('td'); td.textContent = t; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    var sep = document.createElement('tr');
    sep.className = 'section-row';
    var st = document.createElement('td'); st.colSpan = 6; st.textContent = 'Field-wide multipliers';
    sep.appendChild(st); tb.appendChild(sep);
    fit.params.forEach(function (q) {
      var tr = document.createElement('tr');
      if (q.atBound) tr.className = 'at-bound';
      [q.label, '', String(q.points), '', '× ' + q.value.toFixed(4), q.atBound ? 'at search limit' : ''].forEach(function (t) {
        var td = document.createElement('td'); td.textContent = t; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);

    /* tuned AARE per sample: one sample far worse than the rest is pulling
       against the others */
    var props = fit.props.filter(function (p) { return p.n; });
    var th2 = document.createElement('thead'), hr2 = document.createElement('tr');
    ['Tuned AARE by sample'].concat(props.map(function (p) { return p.label; })).forEach(function (h) {
      var e = document.createElement('th'); e.textContent = h; hr2.appendChild(e);
    });
    th2.appendChild(hr2); tbl2.appendChild(th2);
    var tb2 = document.createElement('tbody');
    fit.perSample.forEach(function (s) {
      var tr = document.createElement('tr');
      var td0 = document.createElement('td'); td0.textContent = s.name; tr.appendChild(td0);
      props.forEach(function (p) {
        var c = s.props[p.key], td = document.createElement('td');
        td.textContent = c && c.n ? fmtPct(c.after) : '–';
        if (c && c.n && p.after !== null && c.after > Math.max(3 * p.after, 2)) td.className = 'cell-flag';
        tr.appendChild(td);
      });
      tb2.appendChild(tr);
    });
    tbl2.appendChild(tb2);

    renderPoolCharts(fit);
  }

  /* Each accepted sample in its own colour: laboratory points and the
     field-tuned correlation evaluated with that sample's fluid. */
  function renderPoolCharts(fit) {
    var host = $('poolCharts');
    var defs = [
      { col: 'rs', title: 'Solution GOR', kind: 'rs' },
      { col: 'bo', title: 'Oil formation volume factor', kind: 'bo' },
      { col: 'muo', title: 'Oil viscosity', kind: 'mu' }
    ];
    defs.forEach(function (d) {
      var series = [];
      fit.items.forEach(function (it, k) {
        var slot = (k % 7) + 1;
        var pts = it.data.rows.filter(function (r) { return r[d.col] !== null; });
        if (!pts.length) return;
        var hi = pts.reduce(function (a, r) { return Math.max(a, r.p); }, 0) * 1.02;
        var m;
        try { m = Model.build(Object.assign({}, it.input, { tuning: fit.tuning, pointsOnly: true })); } catch (e) { return; }
        var grid = [];
        for (var i = 0; i <= 40; i++) grid.push(14.7 + (hi - 14.7) * i / 40);
        if (m.pb < hi) grid.push(m.pb);
        grid.sort(function (a, b) { return a - b; });
        series.push({ name: it.name, slot: slot, points: grid.map(function (p) {
          return { x: conv('p', p), y: kindConv(d.kind, m.at(p, 'oil')[d.col]) };
        }) });
        series.push({ name: it.name + ' (lab)', slot: slot, scatter: true, legend: false, points: pts.map(function (r) {
          return { x: conv('p', r.p), y: kindConv(d.kind, r[d.col]) };
        }) });
      });
      if (!series.length) return;
      chartInto(host, 'pool_' + d.col, {
        title: d.title, subtitle: 'Accepted samples against the field-tuned correlation, each at its own Rsb and temperature',
        xLabel: 'Pressure (' + label('p') + ')', yLabel: kindLabel(d.kind), xUnit: label('p'),
        series: series, endLabels: false,
        fmtX: function (v) { return v.toFixed(uu('p').d); },
        fmtY: function (v) { var k = kindDigits(d.kind); return k < 0 ? v.toExponential(3) : v.toFixed(k); }
      });
    });
  }

  /* ---------- pooled ranking ---------- */

  function runPoolRank() {
    if (poolRanking) return;
    var base = sampleBase(), acc = acceptedSamples();
    if (!acc.length) return;
    var fams = Tune.FAMILIES.oil, out = [], k = 0;
    var key = JSON.stringify([acc, readInputs().salinity]);
    poolRanking = true;
    $('btnPoolRank').disabled = true;
    var step = function () {
      if (k >= fams.length) {
        poolRank = out; poolRankKey = key; poolRanking = false;
        $('poolStatus').textContent = '';
        renderSamples();
        return;
      }
      $('poolStatus').textContent = 'Ranking ' + fams[k].label.toLowerCase() + ' (' + (k + 1) + ' of ' + fams.length + ')…';
      try {
        var r = Smp.rankFamilyPooled(base, acc, fams[k]);
        if (r) out.push(r);
      } catch (e) { /* a family that cannot be ranked is left out */ }
      k++;
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  function renderPoolRank() {
    var host = $('poolRank'), btn = $('btnPoolBest');
    host.textContent = '';
    btn.hidden = true;
    if (!poolRank) return;
    var fresh = poolRankKey === JSON.stringify([acceptedSamples(), readInputs().salinity]);
    if (!fresh) {
      host.appendChild(notice('info', 'i', 'The accepted samples have changed since this ranking - rank again before using it.'));
    }
    var inp = readInputs(), changes = 0;
    var list = document.createElement('div');
    list.className = 'pool-rank';
    poolRank.forEach(function (fam) {
      var sel = inp.corr[fam.corr];
      if (fam.best && fam.best !== sel) changes++;
      var row = document.createElement('div');
      row.className = 'pool-rank-row';
      var head = document.createElement('div');
      head.className = 'pool-rank-fam';
      head.textContent = fam.label;
      var chips = document.createElement('div');
      chips.className = 'pool-rank-chips';
      fam.rows.filter(function (r) { return r.aareTuned !== null; })
        .sort(function (x, y) { return x.aareTuned - y.aareTuned; }).forEach(function (r) {
          var b = document.createElement('button');
          b.type = 'button'; b.className = 'chip' + (r.corr === sel ? ' on' : '');
          b.setAttribute('aria-pressed', String(r.corr === sel));
          b.textContent = (CORR_NAMES[r.corr] || r.corr) + ' ' + r.aareTuned.toFixed(2) + ' %';
          if (r.corr === fam.best) {
            var bb = document.createElement('span'); bb.className = 'best-badge'; bb.textContent = 'best fit';
            b.appendChild(bb);
          }
          b.title = 'Tuned AARE ' + r.aareTuned.toFixed(2) + ' % (untuned ' + fmtPct(r.aareRaw) + '), multiplier × ' +
            (r.mult ? r.mult.toFixed(3) : '–') + '. Select to use ' + (CORR_NAMES[r.corr] || r.corr) + '.';
          b.addEventListener('click', function () { chooseCorrelation(fam.corr, r.corr); });
          chips.appendChild(b);
        });
      row.appendChild(head); row.appendChild(chips);
      list.appendChild(row);
    });
    host.appendChild(list);
    btn.hidden = !fresh;
    btn.disabled = !changes;
    btn.textContent = changes ? 'Use the best-fitting correlations (' + changes + ' change' + (changes === 1 ? '' : 's') + ')'
      : 'The best-fitting correlations are selected';
  }

  function usePoolBest() {
    if (!poolRank) return;
    poolRank.forEach(function (fam) {
      if (fam.best && CORR_SELECT[fam.corr]) $(CORR_SELECT[fam.corr]).value = fam.best;
    });
    $('preset').value = '';
    recompute();
  }

  /* ---------- apply ---------- */

  function renderCaseSampleSelect() {
    var sel = $('caseSample'), cur = sel.value;
    sel.textContent = '';
    samples.list.forEach(function (s) {
      var op = document.createElement('option'); op.value = s.id; op.textContent = s.name; sel.appendChild(op);
    });
    if (samples.list.some(function (s) { return s.id === cur; })) sel.value = cur;
    $('btnLoadSample').disabled = !samples.list.length;
  }

  function loadSampleIntoCase() {
    var s = samples.list.filter(function (x) { return x.id === $('caseSample').value; })[0];
    if (!s) return;
    var f = s.fluid;
    writeInputs({ api: f.api, gammaG: f.gammaG, rsb: f.rsb, tempF: f.tempF });
    $('spec').value = 'rsb';
    $('preset').value = '';
    /* its data become the one-report table, so switching to One PVT report
       carries on with this sample */
    var keep = lab.oil.tune;
    lab.oil = cleanLab({ pb: s.lab.pb, muod: s.lab.muod, rows: s.lab.rows.filter(function (r) { return r.p !== null; }),
      sampling: { type: s.type, pRes: s.sampling.pRes, pwf: s.sampling.pwf, gor: s.sampling.gor } });
    lab.oil.tune = keep;
    setInput('labPb', lab.oil.pb); setInput('labMuod', lab.oil.muod);
    writeLabSampling();
    renderLabTable();
    applyFluidVisibility();
    recompute();
    say('info', s.name + ' is now the case: its fluid description is in the case inputs and its laboratory data in the one-report table.');
  }

  /* Switching from one report to several: the one report becomes the
     first sample, so nothing entered is lost. */
  function seedSamplesFromLab() {
    if (samples.list.length || !Tune.hasData(lab.oil, 'oil') || !baseModel || baseModel.fluid !== 'oil') return false;
    var inp = baseModel.input, L = lab.oil;
    var s = cleanSample({
      name: 'Case report', type: L.sampling ? L.sampling.type : 'bhs',
      fluid: { api: inp.api, gammaG: inp.gammaG, rsb: baseModel.rsb, tempF: inp.tempF },
      sampling: L.sampling || {},
      lab: { pb: L.pb, muod: L.muod, rows: L.rows.filter(function (r) { return r.p !== null; }) }
    });
    samples.list.push(s);
    samples.fieldTune = !!L.tune;
    openSample[s.id] = true;
    persistSamples();
    renderSampleList();
    return true;
  }

  /* ================================================================ *
   * Laboratory data mode: none, one report, several reports
   * ================================================================ */

  var labMode = 'none';
  var LAB_TAB = { one: 'Lab data & tuning', several: 'PVT samples & tuning' };
  var LAB_HINT = {
    none: 'Tables come from the published correlations.',
    one: 'Enter, check and tune to one PVT study on the Lab data & tuning tab.',
    several: 'Screen several PVT studies and tune field-wide on the PVT samples & tuning tab.'
  };

  /* Several reports is an oil-reservoir workflow; a gas reservoir tunes to one. */
  function effectiveMode() { return labMode === 'several' && fluid === 'gas' ? 'one' : labMode; }

  function applyLabMode() {
    var m = effectiveMode(), tab = $('tab-lab');
    $('labMode').value = labMode;
    $('labModeHint').textContent = LAB_HINT[labMode] +
      (labMode === 'several' && fluid === 'gas' ? ' Gas reservoirs use one report.' : '');
    tab.hidden = m === 'none';
    if (m !== 'none') tab.textContent = LAB_TAB[m];
    if (m === 'none' && tab.getAttribute('aria-selected') === 'true') $('tab-summary').click();
    document.querySelectorAll('#panel-lab .mode-one').forEach(function (e) { e.hidden = m !== 'one'; });
    document.querySelectorAll('#panel-lab .mode-several').forEach(function (e) { e.hidden = m !== 'several'; });
    var note = $('labModeNote');
    note.textContent = '';
    if (labMode === 'several' && fluid === 'gas') {
      note.appendChild(notice('info', 'i', 'Screening several reports covers oil reservoirs. For a gas reservoir, enter one report here; your oil samples are kept for when you switch back.'));
    }
  }

  function setLabMode(next) {
    if (['none', 'one', 'several'].indexOf(next) < 0) return;
    var prev = labMode;
    labMode = next;
    try { localStorage.setItem('pvt.labMode', next); } catch (e) { /* ignore */ }
    var seeded = prev === 'one' && next === 'several' && fluid === 'oil' && seedSamplesFromLab();
    applyLabMode();
    recompute();
    if (seeded) say('info', 'Your one-report data is now the first sample, "Case report". Add the other reports beside it.');
  }

  /* First visit: ask how laboratory data will be used. Closing the question
     without an answer keeps whatever the stored data implies. */
  function initLabMode(fromLink) {
    var stored = null;
    try { stored = localStorage.getItem('pvt.labMode'); } catch (e) { /* ignore */ }
    var inferred = samples.list.length ? 'several' : Tune.hasData(lab.oil, 'oil') || Tune.hasData(lab.gas, 'gas') ? 'one' : 'none';
    if (fromLink) labMode = fromLink;
    else labMode = stored || inferred;
    $('labMode').addEventListener('change', function (ev) { setLabMode(ev.target.value); });
    var dlg = $('labModeDialog');
    dlg.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () { dlg.close(); setLabMode(b.dataset.mode); });
    });
    dlg.addEventListener('cancel', function () {
      try { localStorage.setItem('pvt.labMode', labMode); } catch (e) { /* ignore */ }
    });
    applyLabMode();
    if (!stored && !fromLink && typeof dlg.showModal === 'function') {
      var pre = dlg.querySelector('[data-mode="' + inferred + '"]');
      dlg.showModal();
      if (pre) pre.focus();
    }
  }

  function initSamples() {
    restoreSamples();
    renderSampleList();
    $('btnSampleAdd').addEventListener('click', function () {
      var s = cleanSample({ name: 'Sample ' + (samples.list.length + 1) });
      samples.list.push(s);
      openSample[s.id] = true;
      renderSampleList(); samplesChanged();
    });
    $('btnSampleDemo').addEventListener('click', function () {
      samples.list = DEMO_SAMPLES.map(cleanSample);
      openSample = {}; pickedSample = null; poolRank = null;
      renderSampleList(); samplesChanged();
    });
    $('btnSampleClear').addEventListener('click', function () {
      samples.list = []; samples.fieldTune = false; pickedSample = null; poolRank = null;
      renderSampleList(); samplesChanged();
      recompute();
    });
    $('btnPoolRank').addEventListener('click', runPoolRank);
    $('btnPoolBest').addEventListener('click', usePoolBest);
    $('fieldTuneOn').addEventListener('change', function (ev) {
      samples.fieldTune = ev.target.checked;
      persistSamples();
      recompute();
    });
    $('btnLoadSample').addEventListener('click', loadSampleIntoCase);
  }

  /* ---------------- persistence + sharing ---------------- */
  function persist(inp) {
    try {
      localStorage.setItem('pvt.inputs', JSON.stringify(inp));
      localStorage.setItem('pvt.units', units);
      localStorage.setItem('pvt.preset', $('preset').value);
      localStorage.setItem('pvt.lab', JSON.stringify(lab));
    } catch (e) { /* private mode or blocked storage - the page still works */ }
  }
  var linkLabMode = null;
  function restore() {
    var loaded = null;
    if (location.hash.length > 1) {
      try { loaded = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1))))); }
      catch (e) { loaded = null; }
      /* a shared case says how its laboratory data is used; older links
         with laboratory data mean one report */
      if (loaded) {
        linkLabMode = ['none', 'one', 'several'].indexOf(loaded.labMode) >= 0 ? loaded.labMode
          : loaded.lab && Tune.hasData(loaded.lab, loaded.fluid === 'gas' ? 'gas' : 'oil') ? 'one' : null;
      }
    }
    if (!loaded) {
      try { loaded = JSON.parse(localStorage.getItem('pvt.inputs')); } catch (e) { loaded = null; }
    }
    try {
      var saved = JSON.parse(localStorage.getItem('pvt.lab'));
      if (saved && saved.oil && saved.gas) {
        lab.oil = cleanLab(saved.oil); lab.gas = cleanLab(saved.gas);
      }
    } catch (e) { /* ignore */ }
    try {
      var us = localStorage.getItem('pvt.units');
      if (us === 'metric' || us === 'field') units = us;
      var th = localStorage.getItem('pvt.theme');
      if (th) document.documentElement.setAttribute('data-theme', th);
    } catch (e) { /* ignore */ }
    if (!loaded) return false;
    applyModelInputs(loaded);
    return true;
  }
  /* keepLab: switching fluids keeps the live laboratory tables rather than
     the snapshot taken when that fluid was last shown */
  function applyModelInputs(o, keepLab) {
    if (o.fluid === 'gas' || o.fluid === 'oil') fluid = o.fluid;
    writeInputs({
      cgr: o.cgr, apiC: o.apiC,
      api: o.api, gammaG: o.gammaG, tempF: o.tempF, rsb: o.rsb, pbMeas: o.pbMeas,
      tSepF: o.tSepF, pSepPsia: o.pSepPsia,
      salinity: o.salinityPpm !== undefined && o.salinityPpm !== null ? o.salinityPpm : wtPctToPpm(o.salinity),
      pRefRock: o.pRefRock,
      rockComp: o.rockComp, pMin: o.pMin, pMax: o.pMax, nSat: o.nSat, nUnsat: o.nUnsat,
      yCO2: (o.yCO2 || 0) * 100, yH2S: (o.yH2S || 0) * 100, yN2: (o.yN2 || 0) * 100,
      spec: o.spec, gasType: o.gasType
    });
    if (o.gasKind) $('gasKind').value = o.gasKind;
    if (o.corr) {
      $('cPb').value = o.corr.pb; $('cBo').value = o.corr.bo; $('cCo').value = o.corr.co;
      $('cMuod').value = o.corr.muod; $('cMuob').value = o.corr.muob; $('cMuou').value = o.corr.muou;
      $('cPcrit').value = o.corr.pcrit; $('cInert').value = o.corr.inertCorr;
      $('cZ').value = o.corr.z; $('cMug').value = o.corr.mug;
    }
    if (!keepLab) restoreLab(o);
    applyFluidVisibility();
  }

  /* ---------------- oil / gas reservoir switching ---------------- */
  function showAll(selector, show) {
    document.querySelectorAll(selector).forEach(function (e) { e.hidden = !show; });
  }

  /* Show only the inputs the selected fluid (and gas type) actually uses. */
  function applyFluidVisibility() {
    var gas = fluid === 'gas', kind = $('gasKind').value;
    showAll('.oil-only', !gas);
    showAll('.gas-only', gas);
    if (gas) {
      showAll('.liq-only', kind !== 'dry');
    } else {
      $('rowRsb').hidden = $('spec').value === 'pb';
      $('rowPb').hidden = $('spec').value !== 'pb';
    }
    $('oilCorrSet').hidden = gas;
    $('gammaGText').textContent = gas ? 'Separator gas gravity' : 'Solution gas gravity';
    $('nSatLabel').textContent = gas ? 'Pressure nodes' : 'Saturated nodes';
    $('nUnsat').closest('.field').hidden = gas;
    $('fluidOil').setAttribute('aria-pressed', String(!gas));
    $('fluidGas').setAttribute('aria-pressed', String(gas));
    document.documentElement.setAttribute('data-fluid', fluid);
  }

  function buildPresetOptions(selected) {
    var sel = $('preset');
    sel.textContent = '';
    var custom = document.createElement('option');
    custom.value = ''; custom.textContent = 'Custom';
    sel.appendChild(custom);
    PRESET_LABELS[fluid].forEach(function (pr) {
      var op = document.createElement('option');
      op.value = pr[0]; op.textContent = pr[1];
      sel.appendChild(op);
    });
    var known = PRESET_LABELS[fluid].some(function (pr) { return pr[0] === selected; });
    sel.value = known ? selected : '';
  }

  function applyPreset(key) {
    if (fluid === 'gas') {
      var g = GAS_PRESETS[key];
      if (!g) return;
      writeInputs({
        gammaG: g.gammaG, tempF: g.tempF, cgr: g.cgr, apiC: g.apiC,
        pMin: g.pMin, pMax: g.pMax, yCO2: g.yCO2, yH2S: g.yH2S, yN2: g.yN2,
        salinity: g.salinity, tSepF: g.tSepF, pSepPsia: g.pSepPsia
      });
      $('gasKind').value = g.gasKind;
      if (!(toField('nSat') >= 10)) setInput('nSat', 15);
    } else {
      var p = PRESETS[key];
      if (!p) return;
      writeInputs({
        api: p.api, gammaG: p.gammaG, tempF: p.tempF, rsb: p.rsb, pMin: p.pMin, pMax: p.pMax,
        yCO2: p.yCO2, yH2S: p.yH2S, yN2: p.yN2, salinity: p.salinity,
        tSepF: 80, pSepPsia: 114.7
      });
      $('spec').value = 'rsb';
      $('cPb').value = p.cPb;
    }
    applyFluidVisibility();
  }

  /* Each fluid keeps its own inputs while the user flips between them. */
  var savedByFluid = {};
  function setFluid(next) {
    if (next === fluid) return;
    savedByFluid[fluid] = { inputs: readInputs(), preset: $('preset').value };
    try { localStorage.setItem('pvt.inputs.' + fluid, JSON.stringify(savedByFluid[fluid])); } catch (e) { /* ignore */ }
    var back = savedByFluid[next];
    if (!back) {
      try { back = JSON.parse(localStorage.getItem('pvt.inputs.' + next)); } catch (e) { back = null; }
    }
    if (playTimer) togglePlay();
    fluid = next;
    cursorP = null;
    renderLabTable();
    if (back && back.inputs) {
      applyModelInputs(back.inputs, true);
      buildPresetOptions(back.preset);
    } else {
      buildPresetOptions(DEFAULT_PRESET[next]);
      applyPreset(DEFAULT_PRESET[next]);
    }
    applyFluidVisibility();
    applyLabMode();
    recompute();
  }

  /* ---------------- unit switching ---------------- */
  function setUnits(next) {
    if (next === units) return;
    var fieldValues = {};
    Object.keys(INPUT_KIND).forEach(function (id) { fieldValues[id] = toField(id); });
    units = next;
    Object.keys(INPUT_KIND).forEach(function (id) { setInput(id, fieldValues[id]); });
    document.querySelectorAll('.unit[data-unit]').forEach(function (sp) {
      sp.textContent = label(sp.getAttribute('data-unit'));
    });
    $('unitField').setAttribute('aria-pressed', String(units === 'field'));
    $('unitMetric').setAttribute('aria-pressed', String(units === 'metric'));
    renderLabTable();
    renderSampleList();
    recompute();
  }

  /* ---------------- tabs ---------------- */
  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (o) {
          var sel = o === t;
          o.setAttribute('aria-selected', String(sel));
          $(o.getAttribute('aria-controls')).hidden = !sel;
        });
        /* charts sized while hidden measure zero - redraw on reveal */
        Object.keys(charts).forEach(function (k) { charts[k].draw(); });
        /* the phase-diagram callout is measured with getBBox, which reads zero
           while its tab is hidden - place it again now that it is visible */
        if (model && cursorP !== null) setCursor(cursorP, 'tab');
      });
    });
  }

  /* ---------------- wiring ---------------- */
  function init() {
    var restored = restore(), lastPreset = '';
    try { lastPreset = localStorage.getItem('pvt.preset') || ''; } catch (e) { /* ignore */ }
    /* a shared link carries no preset; a restored session keeps its own */
    buildPresetOptions(!restored ? DEFAULT_PRESET[fluid] : (location.hash.length > 1 ? '' : lastPreset));
    applyFluidVisibility();
    initTabs();

    $('inputs').addEventListener('submit', function (ev) { ev.preventDefault(); });
    $('inputs').addEventListener('input', function (ev) {
      if (ev.target.id === 'projectName' || ev.target.id === 'projectFile') return;
      if (ev.target.id === 'preset') return;
      if (['api', 'gammaG', 'tempF', 'rsb', 'pbMeas', 'yCO2', 'yH2S', 'yN2',
           'cgr', 'apiC'].indexOf(ev.target.id) >= 0) {
        $('preset').value = '';
      }
      schedule();
    });
    $('inputs').addEventListener('change', function (ev) {
      if (ev.target.id === 'projectName' || ev.target.id === 'projectFile') return;
      if (ev.target.id === 'spec') applyFluidVisibility();
      if (ev.target.id === 'gasKind') {
        $('preset').value = '';
        cursorP = null;
        applyFluidVisibility();
      }
      if (ev.target.id === 'preset' && ev.target.value) applyPreset(ev.target.value);
      schedule();
    });

    $('fluidOil').addEventListener('click', function () { setFluid('oil'); });
    $('fluidGas').addEventListener('click', function () { setFluid('gas'); });
    $('pCursor').addEventListener('input', function (ev) {
      setCursor(uu('p').inv(parseFloat(ev.target.value)), 'slider');
    });
    $('btnPlay').addEventListener('click', togglePlay);
    initLab();
    initSamples();
    initLabMode(linkLabMode);
    initProject();
    $('tableSel').addEventListener('change', renderTable);
    $('fmtSel').addEventListener('change', renderExport);
    $('fmtUnits').addEventListener('change', renderExport);
    $('btnDownload').addEventListener('click', download);
    $('btnCopy').addEventListener('click', function () {
      var text = Exp.generate(model, $('fmtSel').value, $('fmtUnits').value);
      var done = function (msg) {
        $('copyStatus').textContent = msg;
        setTimeout(function () { $('copyStatus').textContent = ''; }, 2500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done('Copied.'); },
          function () { done('Copy blocked - select the text and copy manually.'); });
      } else { done('Copy blocked - select the text and copy manually.'); }
    });
    $('btnShare').addEventListener('click', function () {
      var hash = btoa(unescape(encodeURIComponent(JSON.stringify(readInputs()))));
      location.hash = hash;
      var url = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url);
      say('info', 'A link describing this case is now in the address bar' +
        (navigator.clipboard ? ' and on your clipboard.' : '.'));
    });
    $('btnReset').addEventListener('click', function () {
      location.hash = '';
      try {
        localStorage.removeItem('pvt.inputs');
        localStorage.removeItem('pvt.inputs.oil');
        localStorage.removeItem('pvt.inputs.gas');
        localStorage.removeItem('pvt.lab');
        localStorage.removeItem('pvt.samples');
        localStorage.removeItem('pvt.labMode');
        localStorage.removeItem('pvt.projectName');
      } catch (e) { /* ignore */ }
      location.reload();
    });

    $('unitField').addEventListener('click', function () { setUnits('field'); });
    $('unitMetric').addEventListener('click', function () { setUnits('metric'); });
    $('themeToggle').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var isDark = cur ? cur === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('pvt.theme', next); } catch (e) { /* ignore */ }
    });

    /* reflect the restored unit system in the labels */
    if (units === 'metric') { units = 'field'; setUnits('metric'); }
    else recompute();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
