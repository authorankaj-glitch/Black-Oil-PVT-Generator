# Black-Oil PVT Generator

An interactive, dependency-free black-oil PVT generator for oil, gas and
formation water &mdash; built for field development work, with tables that go
straight into a reservoir simulator.

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
| Water | B<sub>w</sub>(p), &mu;<sub>w</sub>(p), c<sub>w</sub>(p), &rho;<sub>w</sub>(p) at a given salinity |

Nineteen published correlations across the three phases, each carrying the
applicability range of the data it was fitted to; inputs outside that range
raise a QC warning before anything is exported. The **Correlation spread** view
evaluates every correlation on the current fluid, which is the honest
uncertainty band to quote when no laboratory study is available.

Two cursor-linked pictures &mdash; a barrel showing gas coming out of solution,
and a pressure-temperature phase envelope &mdash; follow the same pressure as
every chart on the page.

## Export

| Format | Contents |
|---|---|
| ECLIPSE / OPM Flow / tNavigator (`.INC`) | `DENSITY`, `PVTO`, `PVDG`, `PVTW`, `ROCK` in FIELD or METRIC units |
| CMG IMEX / GEM (`.dat`) | `*PVT *BG`, `*CO`/`*CVO`, densities, water and rock, in FIELD or SI |
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

140 checks: reference values for every correlation, the physical invariants a
simulator depends on, cross-agreement between the z-factor fits, deck structure
and unit conversions for each export format, and a sweep of 849
fluid/correlation combinations.

## Deployment

Published to GitHub Pages by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to
`main`. The workflow runs the test suite first and deploys only if it passes, so
a broken correlation cannot reach the live page.

## License

[MIT](LICENSE). The correlations themselves are published science, cited in
[pvt/README.md](pvt/README.md); this license covers the implementation.
