# Black-Oil PVT Generator

An interactive, dependency-free PVT generator for **oil reservoirs** and **gas
reservoirs** (dry gas and wet gas), plus formation water &mdash; built for field
development work, with tables that go straight into a reservoir simulator.

**Live: https://authorankaj-glitch.github.io/Black-Oil-PVT-Generator/**

Or open `pvt/index.html` from a local clone. There is no build step, no server
and no network access: everything is computed in the browser, so confidential
fluid data never leaves your machine.

## What it does

Takes routine field inputs &mdash; stock-tank oil gravity, separator gas
gravity, reservoir temperature, and either the solution GOR or a measured
bubble-point pressure &mdash; and builds a complete, self-consistent PVT model.

| Phase | Properties |
|---|---|
| Oil | P<sub>b</sub>, R<sub>s</sub>(p), B<sub>o</sub>(p), &mu;<sub>o</sub>(p), &rho;<sub>o</sub>(p), c<sub>o</sub>(p), saturated and undersaturated |
| Gas | z(p), B<sub>g</sub>(p), &rho;<sub>g</sub>(p), c<sub>g</sub>(p), &mu;<sub>g</sub>(p), with non-hydrocarbon corrections |
| Water | B<sub>w</sub>(p), &mu;<sub>w</sub>(p), c<sub>w</sub>(p), &rho;<sub>w</sub>(p) at a given brine salinity (entered in ppm NaCl) |

Switch the input panel to **Gas reservoir** to model a dry gas or a wet gas from
the separator gas gravity, and &mdash; for a wet gas &mdash; the condensate-gas
ratio and condensate gravity: the reservoir gas is recombined with its
condensate (McCain), and every gas property is reported per standard volume of
separator gas. Both fluids are single-phase in the reservoir; a retrograde gas
condensate is out of scope, as its drop-out below the dew point needs a CCE/CVD
study or a compositional model.

Nineteen published correlations across the three phases, each carrying the
applicability range of the data it was fitted to; inputs outside that range
raise a QC warning before anything is exported. The **Correlation spread** view
evaluates every correlation on the current fluid, which is the honest
uncertainty band to quote when no laboratory study is available.

Two cursor-linked pictures follow the same pressure as every chart on the page,
and both change with the fluid: for oil, a barrel showing gas coming out of
solution and a bubble-point-anchored envelope; for gas, a barrel of expanding
reservoir gas whose molecule density tracks &rho;<sub>g</sub>, and an envelope
that places the reservoir and the separator relative to the cricondentherm
&mdash; which is what separates a dry gas from a wet one.

## Export

| Format | Contents |
|---|---|
| ECLIPSE / OPM Flow / tNavigator (`.INC`) | oil: `DENSITY`, `PVTO`, `PVDG`, `PVTW`, `ROCK`; gas: `DENSITY`, `PVDG`, `PVTW`, `ROCK` &mdash; FIELD or METRIC |
| CMG IMEX (`.dat`) | oil: `*MODEL *BLACKOIL`, `*PVT *BG`, `*CO`/`*CVO`; dry gas: `*MODEL *GASWATER` + `*PVTG`; wet gas: `*MODEL *GASWATER_WITH_CONDENSATE` + `*PVTG *RV` &mdash; FIELD or SI |
| CSV / JSON | the full property table, and the complete model for scripting |

Every export carries a header recording the inputs, the correlations used and
any QC warnings, so a deck can be traced back to the assumptions that produced
it.

The correlation library is also a set of UMD modules, so the same files the
page loads can be used from Node:

```js
const Model = require('./pvt/js/pvt-model.js');
const Exp   = require('./pvt/js/export.js');
const m = Model.build({ api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMax: 6000 });
console.log(Exp.eclipse(m, 'field'));

// wet gas
const g = Model.build({ fluid: 'gas', gasKind: 'wet', gammaG: 0.68, cgr: 12,
                        apiC: 58, tempF: 230, pMax: 6000 });
console.log(Exp.generate(g, 'cmg', 'field'));
```

## Documentation

[`pvt/README.md`](pvt/README.md) covers the full correlation list with
references, the calculation sequence, laboratory calibration, the QC checks, the
construction of the schematic phase envelope, and the limitations worth stating
in a report.

## Tests

```bash
node pvt/tests/run-tests.js
```

187 checks: reference values for every correlation, the physical invariants a
simulator depends on, cross-agreement between the z-factor fits, deck structure
and unit conversions for each export format, a sweep of 849 fluid/correlation
combinations, and the gas-reservoir model (recombination, separator-basis
B<sub>g</sub>/E<sub>g</sub>, envelope classification, ECLIPSE and CMG gas deck
structure, a 192-case gas sweep).

## Deployment

Published to GitHub Pages by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to
`main`. The workflow runs the test suite first and deploys only if it passes, so
a broken correlation cannot reach the live page.

## License

[MIT](LICENSE). The correlations themselves are published science, cited in
[pvt/README.md](pvt/README.md); this license covers the implementation.
