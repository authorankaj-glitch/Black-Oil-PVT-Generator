# Black-Oil PVT Generator

An interactive, dependency-free web page that builds a complete black-oil PVT
model from routine field inputs and exports it in the formats reservoir
simulators read.

Use it at
**[authorankaj-glitch.github.io/Black-Oil-PVT-Generator/pvt/](https://authorankaj-glitch.github.io/Black-Oil-PVT-Generator/pvt/)**,
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
| Water | B<sub>w</sub>(p), &mu;<sub>w</sub>(p), c<sub>w</sub>(p), &rho;<sub>w</sub>(p) at a given brine salinity |

The page has two fluid systems, chosen with the **Oil reservoir / Gas
reservoir** switch at the top of the input panel. Each keeps its own inputs, so
flipping between them loses nothing.

| Fluid system | Gas type | What is modelled |
|---|---|---|
| Oil reservoir | &mdash; | black oil with its solution gas (tables above) |
| Gas reservoir | Dry gas | z, B<sub>g</sub>, E<sub>g</sub>, &rho;<sub>g</sub>, c<sub>g</sub>, &mu;<sub>g</sub> of the separator gas; no liquid anywhere |
| Gas reservoir | Wet gas | the same, for the reservoir gas recombined with its condensate; liquid forms only at the separator |

Retrograde **gas condensates are out of scope**: below a dew point, the liquid
drop-out and R<sub>v</sub>(p) cannot be had from black-oil correlations &mdash;
they need a CCE/CVD study or a compositional model. A CGR above about
50 STB/MMscf raises a QC warning for exactly that reason.

## Inputs

**Required:** stock-tank oil gravity (&deg;API), separator gas gravity (air = 1),
reservoir temperature, and either the solution GOR at the bubble point
(R<sub>sb</sub>) or a measured bubble-point pressure.

**Optional:** separator pressure and temperature (used by the Vasquez–Beggs gas
gravity correction), CO<sub>2</sub>/H<sub>2</sub>S/N<sub>2</sub> mole fractions,
brine salinity (ppm NaCl, as a water analysis reports it), rock compressibility
and reference pressure, the pressure range
and node count of the table. Laboratory data for tuning is entered on its own
tab (see *Tuning to laboratory data*).

**Gas reservoir:** separator gas gravity, reservoir temperature, separator
conditions, CO<sub>2</sub>/H<sub>2</sub>S/N<sub>2</sub>, and the gas type. A wet
gas adds the condensate-gas ratio (CGR, STB/MMscf) and the stock-tank condensate
gravity.

Six oil presets (light, medium, heavy, volatile, sour, North Sea) and six gas
presets (dry, deep dry, wet, rich wet, sour wet, nitrogen-rich) load a
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
with salinity entered in **ppm NaCl equivalent** (mg NaCl per kg of brine), the
way a water analysis reports it; the correlations take weight percent, so the
page converts with wt % = ppm / 10 000 and every deck header states both. The
`Model.build()` API still takes `salinity` as weight percent.

## Gas reservoirs

All gas properties are reported per standard volume of **separator** gas, the
basis ECLIPSE `PVDG` and CMG `*PVTG` use. Both gas types are single-phase in the
reservoir at every table pressure.

1. **Recombination** (McCain, 1990; Gold, McCain & Jennings, 1989). With
   R = 10<sup>6</sup>/CGR scf/STB, &gamma;<sub>o</sub> the condensate specific
   gravity and M<sub>o</sub> = 5954/(API &minus; 8.811):
   &gamma;<sub>w</sub> = (R&gamma;<sub>g</sub> + 4584&gamma;<sub>o</sub>) /
   (R + 132800&gamma;<sub>o</sub>/M<sub>o</sub>). A dry gas is its own reservoir
   gas.
2. **Gas properties** of the reservoir gas: pseudo-criticals of
   &gamma;<sub>w</sub> (Sutton, or Standing's dry/wet curve), the selected
   non-hydrocarbon correction, then z, &rho;<sub>g</sub>, c<sub>g</sub> and
   &mu;<sub>g</sub> exactly as in oil mode.
3. **B<sub>g</sub> on the separator basis** = B<sub>g</sub>(well stream)
   &times; (1 + V<sub>eq</sub>&middot;CGR/10<sup>6</sup>), where
   V<sub>eq</sub> = 132800&gamma;<sub>o</sub>/M<sub>o</sub> scf/STB is the
   gas-equivalent volume of the condensate. The well-stream B<sub>g</sub> is in
   the table too, and E<sub>g</sub> = 1/B<sub>g</sub> is what the CMG deck
   carries.
4. **Surface condensate** from a wet gas is the gas rate &times; CGR;
   R<sub>v</sub> stays at the CGR at every reservoir pressure, because nothing
   condenses before the separator.

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

### The gas barrel (Gas reservoir mode)

The reservoir gas that 1 Mscf of separator gas occupies, held at the cursor
pressure &mdash; again a constant-composition expansion. Gas molecules are drawn
at a density that follows &rho;<sub>g</sub>(p), so the gas visibly thins as it
expands, and the readout gives z, B<sub>g</sub>, E<sub>g</sub>,
&rho;<sub>g</sub>, &mu;<sub>g</sub>, R<sub>v</sub> and V/V<sub>i</sub>. Nothing
condenses inside the barrel: a dry gas drops no liquid at all, and a wet gas
yields its condensate at the separator, which the labels say.

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

In **Gas reservoir** mode there is no saturation pressure to anchor to, so the
envelope is sized from the gas pseudo-critical properties (T<sub>c</sub> =
T<sub>pc</sub>, P<sub>c</sub> a little above P<sub>pc</sub> &mdash; a mixture's
true critical pressure always exceeds its pseudo-critical pressure), and the
separator conditions are plotted as a second point:

* **Wet gas** &mdash; the cricondentherm sits between separator and reservoir
  temperature: the reservoir path stays single-phase while the separator point
  falls inside the envelope, which is where the condensate comes from.
* **Dry gas** &mdash; the same construction with the cricondentherm below the
  separator temperature: neither point touches the envelope.

It places the fluid; it does not measure it.

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

### Tuning to laboratory data

The **Lab data & tuning** tab takes a measured bubble point, a dead-oil
viscosity at reservoir temperature, and a table of pressure against
R<sub>s</sub>, B<sub>o</sub>, oil viscosity, gas z and gas viscosity (gas
reservoirs: z and viscosity of the reservoir gas). Any cell may be blank; a
block copied from a spreadsheet pastes into the table from any cell. Enter
separator-adjusted R<sub>s</sub> and B<sub>o</sub>, the basis simulators use.

1. **Rank** &mdash; each correlation family is evaluated with every member
   swapped in, tuned, and scored by average absolute relative error (AARE)
   before and after tuning. *Use the best-fitting correlations* applies the
   winners to the sidebar.
2. **Tune** &mdash; one multiplier per property, regressed in dependency order,
   each against its own points (`js/tuning.js`):

   | Multiplier | Acts on | Fitted to |
   |---|---|---|
   | `pbMult` | R<sub>s</sub>(p) stretched in pressure, P<sub>b</sub> = P<sub>b,corr</sub> &times; m | measured P<sub>b</sub> exactly, else the R<sub>s</sub> points |
   | `boMult` | B<sub>o</sub> = 1 + m(B<sub>o,corr</sub> &minus; 1) | saturated B<sub>o</sub> |
   | `coMult` | c<sub>o</sub> &times; m | undersaturated B<sub>o</sub> |
   | `muodMult` | &mu;<sub>od</sub> &times; m | measured &mu;<sub>od</sub> exactly, else saturated &mu;<sub>o</sub> |
   | `muobMult` | &mu;<sub>ob</sub> &times; m | saturated &mu;<sub>o</sub> (only when &mu;<sub>od</sub> is measured) |
   | `muouMult` | the rise &mu;<sub>o</sub> &minus; &mu;<sub>ob</sub> above P<sub>b</sub> &times; m | undersaturated &mu;<sub>o</sub> |
   | `tpcMult`, `ppcMult` | T<sub>pc</sub>, P<sub>pc</sub> &times; m (so z, B<sub>g</sub>, &rho;<sub>g</sub>, c<sub>g</sub>) | gas z |
   | `mugMult` | &mu;<sub>g</sub> &times; m | gas viscosity |

   Each fit minimises the AARE of its property (log-spaced scan plus
   golden-section refinement). The published correlation, m = 1, is always a
   candidate, so tuning never worsens the fit; a multiplier that stops at its
   search limit is flagged, since it means the correlation does not suit the
   fluid.
3. **Apply** &mdash; with tuning switched on, every table, chart and export uses
   the tuned correlations, and the deck header lists the multipliers and the
   AARE before and after. Match charts plot the laboratory points against the
   tuned and untuned curves.

With P<sub>b</sub> specified as an input the R<sub>s</sub> curve is already
anchored, so `pbMult` is not regressed. Cases saved with the earlier
three-value calibration (P<sub>b</sub>, B<sub>ob</sub>, &mu;<sub>od</sub>) load
into the laboratory table and reproduce the same tables. `Model.build()` still
accepts `calib` for scripts.

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
| ECLIPSE &mdash; dry / wet gas | `DENSITY`, `PVDG` (separator-gas basis), `PVTW`, `ROCK`; phases `GAS WATER` | as above |
| CMG IMEX &mdash; dry gas | `*MODEL *GASWATER`, `*RESERVOIR *GAS`, `*DENSITY *GAS`/`*WATER`, `*PVTG` (p, E<sub>g</sub>, &mu;<sub>g</sub>), water and rock sections | `*INUNIT *FIELD` (psi) or `*SI` (kPa); E<sub>g</sub> is a volume ratio in both |
| CMG IMEX &mdash; wet gas | `*MODEL *GASWATER_WITH_CONDENSATE`, `*DENSITY *OIL` as well, `*PVTG *RV` (p, E<sub>g</sub>, R<sub>v</sub>, &mu;<sub>g</sub>) | R<sub>v</sub> in STB/MMscf (`FIELD`) or m³/m³ (`SI`) |
| CMG IMEX / GEM (`.dat`) | `*MODEL *BLACKOIL`, `*PVT *BG`, `*CO`, `*CVO`, `*DENSITY`, `*REFPW`/`*BWI`/`*CW`/`*VWI`/`*CVW`, `*CPOR`/`*PRPOR` | `*INUNIT *FIELD` (E<sub>g</sub> in ft³/bbl) or `*INUNIT *SI` |
| CSV | every property at every pressure node (gas mode adds R<sub>v</sub>, E<sub>g</sub> and the well-stream B<sub>g</sub>) | field units |
| JSON | the complete model, for scripting and QC | field units |

The gas-mode CMG deck follows the `*GASWATER` / `*GASWATER_WITH_CONDENSATE`
keyword set. CMG keyword sets vary between IMEX versions, so check the deck on
import into Builder the first time.

Every export carries a header recording the inputs, the correlations used, the
generation timestamp and any QC warnings, so a deck can be traced back to the
assumptions that produced it.

## Files

```
pvt/
  index.html            page structure
  css/app.css           tokens, layout, chart chrome (light + dark)
  js/correlations.js    the correlation library (pure functions)
  js/pvt-model.js       model assembly: grids, branches, tuning multipliers, QC
  js/tuning.js          regression against laboratory data, correlation ranking
  js/export.js          ECLIPSE / CMG / CSV / JSON writers
  js/charts.js          SVG charts with crosshair, tooltip and keyboard access
  js/fluid-state.js     cursor-pressure fluid state and the schematic P-T envelope
  js/visuals.js         the barrel and the phase diagram
  js/app.js             UI wiring, unit system, presets, persistence, cursor bus
  tests/run-tests.js    regression tests
```

`correlations.js`, `pvt-model.js`, `tuning.js` and `export.js` are UMD modules: the same
files that the page loads can be `require()`d from Node, so the library is
usable in a scripted workflow.

```js
const Model = require('./pvt/js/pvt-model.js');
const Exp   = require('./pvt/js/export.js');
const m = Model.build({ api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMax: 6000 });
console.log(Exp.eclipse(m, 'field'));

// tune to laboratory data, then build the final tables from the tuned model
const Tune = require('./pvt/js/tuning.js');
const input = { api: 35, gammaG: 0.75, rsb: 600, tempF: 180, pMax: 6000 };
const lab = { pb: 2710, muod: 3.2, rows: [
  { p: 4000, bo: 1.291, muo: 0.83 }, { p: 2710, rs: 600, bo: 1.305 },
  { p: 1500, rs: 318, bo: 1.187, z: 0.861 }, { p: 500, rs: 118, bo: 1.098, z: 0.938 } ] };
const fit = Tune.regress(input, lab);            // fit.params, fit.before, fit.after
const tuned = Model.build({ ...input, tuning: fit.tuning });
console.log(Exp.cmg(tuned, 'field'));
```

## Tests

```bash
node pvt/tests/run-tests.js
```

222 checks covering reference values for each correlation, the physical
invariants (R<sub>s</sub>(P<sub>b</sub>) = R<sub>sb</sub>, B<sub>o</sub> peaking
at P<sub>b</sub>, viscosity minimum at P<sub>b</sub>, monotonic B<sub>g</sub>),
cross-agreement between the z-factor fits, deck structure and unit conversions
for every export format, a sweep of 849 fluid/correlation combinations, the
barrel volume balance (no free gas at P<sub>b</sub>, fractions summing to one,
monotonic gas evolution below P<sub>b</sub>) and the phase-envelope anchoring for
every preset fluid. The gas-reservoir checks cover the McCain recombination,
the separator-basis B<sub>g</sub> and E<sub>g</sub> = 1/B<sub>g</sub>, the
single-phase barrel, the fluid-type classification and separator placement of
each envelope, the ECLIPSE `PVDG` and CMG `*PVTG` / `*PVTG *RV` deck structure
and units, and a sweep of 192 gas cases. The tuning checks regress synthetic
laboratory data generated from known multipliers and require every multiplier
back to 0.2 %, plus exact honouring of a measured P<sub>b</sub> and
&mu;<sub>od</sub>, no-worse-than-untuned fits, correlation ranking, and the
tuning block in the ECLIPSE and CMG headers.

## Limitations

* Correlations carry roughly 5–20% uncertainty on B<sub>o</sub> and
  R<sub>s</sub>, and considerably more on viscosity. They are a starting point,
  not a substitute for a CCE/DL/separator study.
* In oil mode the gas table is a dry-gas `PVDG`: no vaporised oil
  (R<sub>v</sub>), so volatile oils need a compositional or modified black-oil
  model.
* Gas mode covers dry and wet gas only. A retrograde gas condensate is not
  modelled: below a dew point the liquid drop-out and R<sub>v</sub>(p) need a
  CCE/CVD study or a compositional model.
* CMG keyword sets vary between IMEX versions; check a generated gas deck on
  first import into Builder.
* Water is treated as undersaturated (no dissolved gas), matching `PVTW`.
* The phase envelope is schematic (see above). In oil mode only the bubble point
  it passes through is calculated; in gas mode nothing on it is &mdash; it is
  placed from the pseudo-critical properties.
* Surface conditions are 14.696 psia and 60 °F. Metric output uses the
  conventional volume-ratio conversions and does not re-reference to 15 °C.

## References

Standing (1947); Beal (1946); Carr, Kobayashi & Burrows (1954); Lasater (1958);
Chew & Connally (1959); Dempsey (1965); Lee, Gonzalez & Eakin (1966); Wichert &
Aziz (1972); Gold, McCain & Jennings (1989); McCain (1990); Hall & Yarborough (1973); Beggs & Brill (1973); Dranchuk &
Abou-Kassem (1975); Beggs & Robinson (1975); Glaso (1980); Vasquez & Beggs
(1980); Ng & Egbogah (1983); Sutton (1985); Al-Marhoun (1988); McCain, Rollins &
Villena-Lanzi (1988); Osif (1988); McCain (1991); Petrosky & Farshad (1993).
