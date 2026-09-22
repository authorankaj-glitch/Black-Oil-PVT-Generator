# Black-Oil PVT Generator

An interactive, dependency-free web page that builds a complete black-oil PVT
model from routine field inputs and exports it in the formats reservoir
simulators read.

Use it at
**[authorankaj-glitch.github.io/PVT-Correlation-Generator/pvt/](https://authorankaj-glitch.github.io/PVT-Correlation-Generator/pvt/)**,
or open `pvt/index.html` from a local clone — no build step, no server, no
network access. Everything runs in the browser, including on the hosted copy:
nothing you type is uploaded anywhere, which matters when the fluid data is
confidential.

---

## What it produces

| Phase | Properties |
|---|---|
| Oil | P<sub>b</sub>, R<sub>s</sub>(p), B<sub>o</sub>(p), &mu;<sub>o</sub>(p), &rho;<sub>o</sub>(p), c<sub>o</sub>(p) — saturated and undersaturated branches |
| Gas | z(p), B<sub>g</sub>(p), &rho;<sub>g</sub>(p), c<sub>g</sub>(p), &mu;<sub>g</sub>(p), pseudo-criticals with non-hydrocarbon corrections |
| Water | B<sub>w</sub>(p), &mu;<sub>w</sub>(p), c<sub>w</sub>(p), &rho;<sub>w</sub>(p) at a given salinity |

## Inputs

**Required:** stock-tank oil gravity (&deg;API), separator gas gravity (air = 1),
reservoir temperature, and either the solution GOR at the bubble point
(R<sub>sb</sub>) or a measured bubble-point pressure.

**Optional:** separator pressure and temperature (used by the Vasquez–Beggs gas
gravity correction), CO<sub>2</sub>/H<sub>2</sub>S/N<sub>2</sub> mole fractions,
brine salinity, rock compressibility and reference pressure, the pressure range
and node count of the table, and measured P<sub>b</sub>, B<sub>ob</sub> and dead-oil
viscosity for calibration.

Six fluid presets (light, medium, heavy, volatile, sour, North Sea) load a
representative input set in one click. Inputs and the chosen unit system persist
in browser storage, and **Copy link to this case** puts the whole case in the URL
so it can be shared with a colleague.

## Correlation library

Every correlation carries the applicability range of the data it was fitted to.
Inputs outside that range raise a QC warning on the Summary tab rather than
failing silently.

### Oil

| Property | Correlations |
|---|---|
| P<sub>b</sub> / R<sub>s</sub> | Standing (1947), Vasquez & Beggs (1980), Glaso (1980), Al-Marhoun (1988), Petrosky & Farshad (1993), Lasater (1958) |
| B<sub>o</sub> (saturated) | Standing, Vasquez & Beggs, Glaso, Al-Marhoun, Petrosky & Farshad |
| c<sub>o</sub> (undersaturated) | Vasquez & Beggs (1980), Petrosky & Farshad (1993), McCain et al. (1988) |
| Dead-oil viscosity | Beggs & Robinson (1975), Beal (1946), Glaso (1980), Ng & Egbogah (1983) |
| Saturated viscosity | Beggs & Robinson (1975), Chew & Connally (1959) |
| Undersaturated viscosity | Vasquez & Beggs (1980), Petrosky & Farshad (1993), or constant |

### Gas

| Property | Correlations |
|---|---|
| Pseudo-criticals | Sutton (1985), Standing (1977) — dry or wet-gas form |
| Non-hydrocarbon correction | Wichert & Aziz (1972) with Kay mixing for N<sub>2</sub>, or Carr, Kobayashi & Burrows (1954) |
| z-factor | Dranchuk & Abou-Kassem (1975), Hall & Yarborough (1973), Beggs & Brill (1973) |
| Viscosity | Lee, Gonzalez & Eakin (1966), Carr–Kobayashi–Burrows with the Dempsey (1965) polynomial |

### Water

McCain (1991) for B<sub>w</sub> and &mu;<sub>w</sub>, Osif (1988) for c<sub>w</sub>,
with salinity entered as weight-percent NaCl equivalent.

## Cursor-linked fluid visuals

Two pictures on the Summary tab share one pressure cursor with every chart on
the page. Hover any curve, drag the slider, drag the phase diagram itself, or
press **Play depletion** to sweep from the maximum table pressure down to the
minimum &mdash; all four inputs drive the same state.

### The barrel

One stock-tank barrel of oil plus its solution gas, held at the cursor pressure
&mdash; a constant-composition expansion:

* **liquid volume** = B<sub>o</sub>(p) bbl per STB;
* **free gas volume** = [R<sub>sb</sub> &minus; R<sub>s</sub>(p)] &middot;
  B<sub>g</sub>(p) / 5.614583 bbl per STB;
* the split drawn in the barrel is the volume fraction of each phase, and the
  readout gives both volumes, the total cell volume and V/V<sub>b</sub>.

Dissolved gas is drawn as specks inside the liquid whose density tracks
R<sub>s</sub>/R<sub>sb</sub>; evolved gas is the growing cap, with bubbles
rising through the liquid in proportion to how much gas has come out of
solution. Above P<sub>b</sub> the cap is empty and the specks are at full
density &mdash; every scf is still dissolved. The animation is suppressed under
`prefers-reduced-motion`.

### The phase envelope

A pressure-temperature envelope with the bubble-point line, the dew-point line,
the critical point, iso-liquid-volume (quality) lines, and the reservoir
isotherm the fluid actually depletes along. The cursor rides that isotherm, and
its callout reports the phase state and the liquid volume percent taken from the
black-oil calculation itself.

**This envelope is schematic, and the page says so.** A true envelope requires a
compositional EOS. What the tool has is one hard point &mdash; the computed
(T<sub>res</sub>, P<sub>b</sub>) &mdash; plus the fluid's volatility. The
construction is:

1. A volatility index from R<sub>sb</sub> and API gravity sets how far the
   critical temperature sits above the reservoir temperature: from about 340 &deg;F
   for a heavy, low-GOR crude down to 20 &deg;F for a near-critical fluid. That
   distance is what visually distinguishes a black oil from a volatile one.
2. The bubble branch is
   P(T) = P<sub>c</sub> &minus; (P<sub>c</sub> &minus; P<sub>0</sub>)
   &middot;[(T<sub>c</sub> &minus; T)/(T<sub>c</sub> &minus; T<sub>0</sub>)]<sup>1.8</sup>,
   which starts at standard conditions and flattens into the critical point.
3. P<sub>c</sub> then follows in closed form from the requirement
   P(T<sub>res</sub>) = P<sub>b</sub>, so the envelope passes through the
   calculated bubble point exactly.
4. The dew branch runs from the critical point out past the cricondentherm and
   back down; quality lines are blends of the two branches, fanned from the
   critical point.

Read it as a teaching diagram and a fluid-type classifier, not as a measured
envelope: the bubble point it passes through is real, the shape around it is
not.

## Calculation sequence

1. **P<sub>b</sub>** from R<sub>sb</sub>, or R<sub>sb</sub> back-solved from a
   measured P<sub>b</sub>.
2. **R<sub>s</sub>(p)** below P<sub>b</sub> by numerical inversion of the same
   P<sub>b</sub> equation. This guarantees R<sub>s</sub>(P<sub>b</sub>) =
   R<sub>sb</sub> exactly — including for Glaso, Al-Marhoun and Lasater, whose
   published forms have no closed-form inverse.
3. **B<sub>o</sub>, &mu;<sub>o</sub>** on the saturated branch from
   R<sub>s</sub>(p).
4. **Above P<sub>b</sub>**: B<sub>o</sub> = B<sub>ob</sub>·exp(−∫c<sub>o</sub>dp),
   integrated with the trapezoid rule so the pressure dependence of
   c<sub>o</sub> is honoured, and &mu;<sub>o</sub> from the undersaturated
   correlation.
5. **Gas**: pseudo-criticals → non-hydrocarbon correction → z → B<sub>g</sub>,
   &rho;<sub>g</sub>, c<sub>g</sub> (numerical ∂z/∂p), &mu;<sub>g</sub>.
6. **PVTO records**: each saturated node gets its own saturation pressure and
   its own undersaturated branch, which is what ECLIPSE expects for live oil.

### Calibration to laboratory data

* **Measured P<sub>b</sub>** — the saturated R<sub>s</sub> curve is stretched in
  pressure by P<sub>b,meas</sub>/P<sub>b,calc</sub>, so it still reaches
  R<sub>sb</sub> exactly at the measured bubble point.
* **Measured B<sub>ob</sub>** — the correlation's B<sub>o</sub> − 1 is scaled so
  the bubble-point value matches, preserving the shape of the curve.
* **Measured dead-oil viscosity** — replaces the correlated &mu;<sub>od</sub>,
  which then propagates through the saturated and undersaturated branches.

## Quality control

The Summary tab reports, before anything is exported:

* inputs outside the published range of each selected correlation;
* non-hydrocarbon content above 20 mol%, or an API gravity suggesting a volatile
  oil that a black-oil model will not represent well;
* the monotonicity conditions a simulator checks — R<sub>s</sub> and
  B<sub>o</sub> increasing with pressure on the saturated branch, B<sub>o</sub>
  decreasing and &mu;<sub>o</sub> increasing above P<sub>b</sub>, B<sub>g</sub>
  decreasing, and PVTO branches that never cross;
* z-factors outside a physical range;
* undersaturated viscosity branches that a ratio-form correlation has
  over-extrapolated from a near-atmospheric saturation pressure.

The **Correlation spread** tab evaluates every correlation in the library on the
current fluid, which is the honest uncertainty band to quote when no laboratory
study is available.

## Export formats

| Format | Contents | Units |
|---|---|---|
| ECLIPSE / OPM Flow / tNavigator (`.INC`) | `DENSITY`, `PVTO`, `PVDG`, `PVTW`, `ROCK` | `FIELD` (R<sub>s</sub> in Mscf/STB, B<sub>g</sub> in rb/Mscf) or `METRIC` (sm³/sm³, rm³/sm³, barsa) |
| CMG IMEX / GEM (`.dat`) | `*MODEL *BLACKOIL`, `*PVT *BG`, `*CO`, `*CVO`, `*DENSITY`, `*REFPW`/`*BWI`/`*CW`/`*VWI`/`*CVW`, `*CPOR`/`*PRPOR` | `*INUNIT *FIELD` (E<sub>g</sub> in ft³/bbl) or `*INUNIT *SI` |
| CSV | every property at every pressure node | field units |
| JSON | the complete model, for scripting and QC | field units |

Every export carries a header recording the inputs, the correlations used, the
generation timestamp and any QC warnings, so a deck can be traced back to the
assumptions that produced it.

## Files

```
pvt/
  index.html            page structure
  css/app.css           tokens, layout, chart chrome (light + dark)
  js/correlations.js    the correlation library (pure functions)
  js/pvt-model.js       model assembly: grids, branches, calibration, QC
  js/export.js          ECLIPSE / CMG / CSV / JSON writers
  js/charts.js          SVG charts with crosshair, tooltip and keyboard access
  js/fluid-state.js     cursor-pressure fluid state and the schematic P-T envelope
  js/visuals.js         the barrel and the phase diagram
  js/app.js             UI wiring, unit system, presets, persistence, cursor bus
  tests/run-tests.js    regression tests
```

`correlations.js`, `pvt-model.js` and `export.js` are UMD modules: the same
files that the page loads can be `require()`d from Node, so the library is
usable in a scripted workflow.

```js
const Model = require('./pvt/js/pvt-model.js');
const Exp   = require('./pvt/js/export.js');
const m = Model.build({ api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMax: 6000 });
console.log(Exp.eclipse(m, 'field'));
```

## Tests

```bash
node pvt/tests/run-tests.js
```

140 checks covering reference values for each correlation, the physical
invariants (R<sub>s</sub>(P<sub>b</sub>) = R<sub>sb</sub>, B<sub>o</sub> peaking
at P<sub>b</sub>, viscosity minimum at P<sub>b</sub>, monotonic B<sub>g</sub>),
cross-agreement between the z-factor fits, deck structure and unit conversions
for every export format, a sweep of 849 fluid/correlation combinations, the
barrel volume balance (no free gas at P<sub>b</sub>, fractions summing to one,
monotonic gas evolution below P<sub>b</sub>) and the phase-envelope anchoring for
every preset fluid.

## Limitations

* Correlations carry roughly 5–20% uncertainty on B<sub>o</sub> and
  R<sub>s</sub>, and considerably more on viscosity. They are a starting point,
  not a substitute for a CCE/DL/separator study.
* The gas table is a dry-gas `PVDG`: no vaporised oil (R<sub>v</sub>). Gas
  condensates and volatile oils need a compositional or modified black-oil model.
* Water is treated as undersaturated (no dissolved gas), matching `PVTW`.
* The phase envelope is schematic (see above). Only the bubble point it passes
  through is calculated; the rest of the shape is constructed.
* Surface conditions are 14.696 psia and 60 °F. Metric output uses the
  conventional volume-ratio conversions and does not re-reference to 15 °C.

## References

Standing (1947); Beal (1946); Carr, Kobayashi & Burrows (1954); Lasater (1958);
Chew & Connally (1959); Dempsey (1965); Lee, Gonzalez & Eakin (1966); Wichert &
Aziz (1972); Hall & Yarborough (1973); Beggs & Brill (1973); Dranchuk &
Abou-Kassem (1975); Beggs & Robinson (1975); Glaso (1980); Vasquez & Beggs
(1980); Ng & Egbogah (1983); Sutton (1985); Al-Marhoun (1988); McCain, Rollins &
Villena-Lanzi (1988); Osif (1988); McCain (1991); Petrosky & Farshad (1993).
