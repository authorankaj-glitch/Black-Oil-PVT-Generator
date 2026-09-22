/*
 * app.js -- UI wiring for the black-oil PVT generator.
 *
 * Inputs are held in FIELD units internally; the unit toggle converts what is
 * shown (inputs, charts, tables) and the export panel writes decks in either
 * unit system independently.
 */
(function () {
  'use strict';

  var C = window.PVTCorr, Model = window.PVTModel, Exp = window.PVTExport, Chart = window.PVTChart;
  var FS = window.PVTFluidState, Vis = window.PVTVisuals;
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
    calPb: 'p', calBob: 'bo', calMuod: 'mu'
  };

  /* ---------------- presets (field units) ---------------- */
  var PRESETS = {
    light:    { api: 38, gammaG: 0.72, tempF: 200, rsb: 900, pMin: 100, pMax: 6500, yCO2: 0, yH2S: 0, yN2: 0, salinity: 3, cPb: 'standing' },
    medium:   { api: 35, gammaG: 0.75, tempF: 180, rsb: 600, pMin: 100, pMax: 6000, yCO2: 0, yH2S: 0, yN2: 0, salinity: 3, cPb: 'standing' },
    heavy:    { api: 18, gammaG: 0.65, tempF: 130, rsb: 120, pMin: 50, pMax: 3000, yCO2: 0, yH2S: 0, yN2: 0, salinity: 5, cPb: 'standing' },
    volatile: { api: 45, gammaG: 0.85, tempF: 250, rsb: 1800, pMin: 200, pMax: 8000, yCO2: 1, yH2S: 0, yN2: 0.5, salinity: 2, cPb: 'glaso' },
    sour:     { api: 30, gammaG: 0.88, tempF: 210, rsb: 500, pMin: 100, pMax: 5500, yCO2: 4, yH2S: 8, yN2: 1, salinity: 8, cPb: 'vasquezBeggs' },
    northsea: { api: 36, gammaG: 0.78, tempF: 220, rsb: 700, pMin: 100, pMax: 7000, yCO2: 0.5, yH2S: 0, yN2: 0.5, salinity: 3.5, cPb: 'glaso' }
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
      api: toField('api'), gammaG: toField('gammaG'), tempF: toField('tempF'),
      spec: $('spec').value,
      rsb: toField('rsb'), pbMeas: toField('pbMeas'),
      tSepF: toField('tSepF'), pSepPsia: toField('pSepPsia'),
      gasType: $('gasType').value,
      yCO2: (toField('yCO2') || 0) / 100, yH2S: (toField('yH2S') || 0) / 100, yN2: (toField('yN2') || 0) / 100,
      salinity: toField('salinity'), pRefRock: toField('pRefRock'), rockComp: toField('rockComp'),
      pMin: toField('pMin'), pMax: toField('pMax'),
      nSat: Math.round(toField('nSat')), nUnsat: Math.round(toField('nUnsat')),
      corr: {
        pb: $('cPb').value, bo: $('cBo').value, co: $('cCo').value,
        muod: $('cMuod').value, muob: $('cMuob').value, muou: $('cMuou').value,
        pcrit: $('cPcrit').value, inertCorr: $('cInert').value,
        z: $('cZ').value, mug: $('cMug').value
      },
      calib: { pbMeas: toField('calPb'), bobMeas: toField('calBob'), muodMeas: toField('calMuod') }
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
    tile(t, 'Bubble-point pressure', fmt('p', model.pb), label('p'), true);
    tile(t, 'Solution GOR at Pb', fmt('rs', model.rsb), label('rs'));
    tile(t, 'Oil FVF at Pb', fmt('bo', model.bob), label('bo'));
    tile(t, 'Oil viscosity at Pb', fmt('mu', model.muob), label('mu'));
    tile(t, 'Dead-oil viscosity', fmt('mu', model.muod), label('mu'));
    tile(t, 'Oil density at Pb', fmt('rho', model.oil.filter(function (r) { return r.saturated; }).pop().rhoO), label('rho'));
    tile(t, 'co at Pb', fmt('c', model.cob), label('c'));
    tile(t, 'Stock-tank oil density', fmt('rho', model.rhoOsc), label('rho'));
    tile(t, 'Gas Tpc / Ppc', model.pcrit.tpc.toFixed(0) + ' / ' + model.pcrit.ppc.toFixed(0), '°R, psia');

    var qc = $('qc');
    qc.textContent = '';
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

  function chartOpts(def) {
    var rows = model[def.src];
    return {
      title: def.title,
      subtitle: def.sub,
      xLabel: 'Pressure (' + label('p') + ')',
      yLabel: def.kind ? label(def.kind) : 'z (–)',
      xUnit: label('p'),
      series: [series(def.title, def.slot, rows, 'p', def.y, def.kind)],
      marker: { x: conv('p', model.pb), label: 'Pb' },
      yMinZero: def.yMinZero,
      endLabels: false,
      onCursor: function (x) { setCursor(uu('p').inv(x), 'chart'); },
      fmtX: function (v) { return v.toFixed(uu('p').d); },
      fmtY: function (v) {
        var d = def.kind ? uu(def.kind).d : 4;
        return d < 0 ? v.toExponential(3) : v.toFixed(d);
      }
    };
  }

  function renderCharts() {
    var sum = $('summaryCharts'), all = $('allCharts');
    sum.textContent = ''; all.textContent = ''; charts = {};
    CHART_DEFS.forEach(function (def) {
      if (def.key === 'rs' || def.key === 'bo') chartInto(sum, 's_' + def.key, chartOpts(def));
      chartInto(all, def.key, chartOpts(def));
    });
  }

  /* ---------------- cursor-linked fluid visuals ---------------- */
  function pRange() {
    return { lo: model.oil[0].p, hi: model.oil[model.oil.length - 1].p };
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
    var twoPhase = cursorP <= model.pb + 1e-6;
    var atPb = Math.abs(cursorP - model.pb) < 0.004 * model.pb;
    st.textContent = atPb ? 'At the bubble point'
      : (twoPhase ? 'Two-phase: oil + free gas' : 'Single-phase undersaturated oil');
    st.className = 'state-chip' + (twoPhase && !atPb ? ' two-phase' : '');
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
    var atPb = function (p) { return Math.abs(p - model.pb) < 0.004 * model.pb; };
    var bHost = document.createElement('div');
    host.appendChild(bHost);
    barrel = Vis.createBarrel(bHost, { state: state, fmt: fmt, label: label, atBubblePoint: atPb });

    var pHost = document.createElement('div');
    host.appendChild(pHost);
    phase = Vis.createPhaseDiagram(pHost, {
      env: envelope, state: state, fmt: fmt, label: label, atBubblePoint: atPb,
      convT: function (t) { return conv('T', t); },
      convP: function (p) { return conv('p', p); },
      invP: function (v) { return uu('p').inv(v); },
      /* a temperature difference converts by the scale factor alone */
      convDeltaT: function (d) { return units === 'metric' ? d / 1.8 : d; },
      ticks: Chart.niceTicks, fmtTick: Chart.fmtTick,
      pMinTable: r.lo, pMaxTable: r.hi,
      onPressure: function (p) { setCursor(p, 'phase'); }
    });

    var keep = cursorP !== null && cursorP >= r.lo && cursorP <= r.hi ? cursorP : model.pb;
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

  function renderTable() {
    var which = $('tableSel').value;
    var tbl = $('dataTable');
    tbl.textContent = '';
    if (which === 'pvto') return renderPvto(tbl);
    var def = TABLE_DEFS[which], rows = model[which];
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
      if (Math.abs(r.p - model.pb) < 1e-6) row.className = 'is-pb';
      def.cols.forEach(function (c) {
        var td = document.createElement('td');
        if (c.k === 'state') td.textContent = model.oil[i].saturated ? 'saturated' : 'undersaturated';
        else td.textContent = c.kind ? fmt(c.kind, r[c.k]) : (r[c.k] === null ? '—' : r[c.k].toFixed(4));
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    tbl.appendChild(tb);
  }

  function renderPvto(tbl) {
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
    model.pvto.forEach(function (rec) {
      rec.rows.forEach(function (r, k) {
        var row = document.createElement('tr');
        if (k === 0 && Math.abs(rec.pb - model.pb) < 1e-6) row.className = 'is-pb';
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

  function renderCompare() {
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

  /* ---------------- export ---------------- */
  function renderExport() {
    var text = Exp.generate(model, $('fmtSel').value, $('fmtUnits').value);
    var lines = text.split('\n');
    $('exportPreview').textContent = lines.length > 900
      ? lines.slice(0, 900).join('\n') + '\n... (' + (lines.length - 900) + ' more lines in the downloaded file)'
      : text;
  }

  function download() {
    var fmtName = $('fmtSel').value, u = $('fmtUnits').value;
    var text = Exp.generate(model, fmtName, u);
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = Exp.filename(fmtName, u);
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
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
      if (!(inp.api > 5 && inp.api < 70)) throw new Error('Oil gravity must lie between 5 and 70 API.');
      if (!(inp.gammaG > 0.5 && inp.gammaG < 2.0)) throw new Error('Gas gravity must lie between 0.5 and 2.0 (air = 1).');
      if (!(inp.tempF > 32 && inp.tempF < 400)) throw new Error('Reservoir temperature must lie between 32 and 400 degF (0 - 204 degC).');
      if (!(inp.pMax > inp.pMin && inp.pMin > 0)) throw new Error('The maximum table pressure must exceed the minimum, and both must be positive.');
      if (inp.yCO2 + inp.yH2S + inp.yN2 >= 1) throw new Error('Non-hydrocarbon mole fractions must sum to less than 100%.');
      model = Model.build(inp);
      say(null, null);
    } catch (e) {
      say('error', e.message);
      return;
    }
    renderSummary();
    renderCharts();
    renderVisuals();
    renderTable();
    renderCompare();
    renderExport();
    persist(inp);
  }

  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(recompute, 120);
  }

  /* ---------------- persistence + sharing ---------------- */
  function persist(inp) {
    try {
      localStorage.setItem('pvt.inputs', JSON.stringify(inp));
      localStorage.setItem('pvt.units', units);
    } catch (e) { /* private mode or blocked storage - the page still works */ }
  }
  function restore() {
    var loaded = null;
    if (location.hash.length > 1) {
      try { loaded = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1))))); }
      catch (e) { loaded = null; }
    }
    if (!loaded) {
      try { loaded = JSON.parse(localStorage.getItem('pvt.inputs')); } catch (e) { loaded = null; }
    }
    try {
      var us = localStorage.getItem('pvt.units');
      if (us === 'metric' || us === 'field') units = us;
      var th = localStorage.getItem('pvt.theme');
      if (th) document.documentElement.setAttribute('data-theme', th);
    } catch (e) { /* ignore */ }
    if (!loaded) return;
    applyModelInputs(loaded);
  }
  function applyModelInputs(o) {
    writeInputs({
      api: o.api, gammaG: o.gammaG, tempF: o.tempF, rsb: o.rsb, pbMeas: o.pbMeas,
      tSepF: o.tSepF, pSepPsia: o.pSepPsia, salinity: o.salinity, pRefRock: o.pRefRock,
      rockComp: o.rockComp, pMin: o.pMin, pMax: o.pMax, nSat: o.nSat, nUnsat: o.nUnsat,
      yCO2: (o.yCO2 || 0) * 100, yH2S: (o.yH2S || 0) * 100, yN2: (o.yN2 || 0) * 100,
      spec: o.spec, gasType: o.gasType
    });
    if (o.corr) {
      $('cPb').value = o.corr.pb; $('cBo').value = o.corr.bo; $('cCo').value = o.corr.co;
      $('cMuod').value = o.corr.muod; $('cMuob').value = o.corr.muob; $('cMuou').value = o.corr.muou;
      $('cPcrit').value = o.corr.pcrit; $('cInert').value = o.corr.inertCorr;
      $('cZ').value = o.corr.z; $('cMug').value = o.corr.mug;
    }
    if (o.calib) {
      writeInputs({ calPb: o.calib.pbMeas, calBob: o.calib.bobMeas, calMuod: o.calib.muodMeas });
    }
    $('rowRsb').hidden = o.spec === 'pb';
    $('rowPb').hidden = o.spec !== 'pb';
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
      });
    });
  }

  /* ---------------- wiring ---------------- */
  function init() {
    restore();
    initTabs();

    $('inputs').addEventListener('input', function (ev) {
      if (ev.target.id === 'preset') return;
      if (['api', 'gammaG', 'tempF', 'rsb', 'pbMeas', 'yCO2', 'yH2S', 'yN2'].indexOf(ev.target.id) >= 0) {
        $('preset').value = '';
      }
      schedule();
    });
    $('inputs').addEventListener('change', function (ev) {
      if (ev.target.id === 'spec') {
        $('rowRsb').hidden = ev.target.value === 'pb';
        $('rowPb').hidden = ev.target.value !== 'pb';
      }
      if (ev.target.id === 'preset' && PRESETS[ev.target.value]) {
        var p = PRESETS[ev.target.value];
        writeInputs({
          api: p.api, gammaG: p.gammaG, tempF: p.tempF, rsb: p.rsb, pMin: p.pMin, pMax: p.pMax,
          yCO2: p.yCO2, yH2S: p.yH2S, yN2: p.yN2, salinity: p.salinity
        });
        $('spec').value = 'rsb';
        $('rowRsb').hidden = false; $('rowPb').hidden = true;
        $('cPb').value = p.cPb;
      }
      schedule();
    });

    $('pCursor').addEventListener('input', function (ev) {
      setCursor(uu('p').inv(parseFloat(ev.target.value)), 'slider');
    });
    $('btnPlay').addEventListener('click', togglePlay);
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
      try { localStorage.removeItem('pvt.inputs'); } catch (e) { /* ignore */ }
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
