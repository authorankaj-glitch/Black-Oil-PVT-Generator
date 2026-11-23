# Changelog

Major updates to PhaseWiz (the Black-Oil PVT Generator), newest first. Each entry says what
a user can now do and what changed in the results or the files the tool writes.
Version numbers follow [semantic versioning](https://semver.org): a minor
version adds functionality without breaking saved cases, project files or
decks; a major version would change them.

## 1.8.0 &mdash; 2026-11-22 &middot; Recovery screening and mud contamination

### Recovery screening

A new **Recovery** tab estimates recovery factors from the PVT model, with a
few rock properties that start at typical defaults and can each be
overridden. It is a screening tool: not a reserves or resources estimate
(SPE-PRMS) and not a simulation forecast &mdash; there is no geology, well, rate
or time, and the tab, the PDF section and the CSV all say so.

**New**
- **Oil reservoirs**: expansion from the initial pressure to the bubble point
  (material balance with water and rock compressibility); **solution-gas
  drive** to abandonment by the Muskat (1945) tank method, with recovery,
  producing GOR and gas saturation against pressure; **water drive** as a
  Buckley&ndash;Leverett displacement efficiency with the Welge tangent,
  fractional-flow and water-cut curves (complete sweep: field recovery is this
  times the sweep efficiency); the **API (Arps et al., 1967)** solution-gas and
  water-drive correlations as an indicative cross-check.
- **Gas reservoirs**: volumetric depletion from p/z and water drive with
  trapped gas.
- **Default rock inputs, overridable**: Swi, rock compressibility,
  abandonment and water-drive pressures, critical and residual saturations,
  Corey exponents and end points, economic water cut, and porosity and
  permeability for the API check. Every result marks each input it uses as
  *default* or *entered*.
- **Visualisation**: a recovery-by-mechanism summary with bars and shaded
  sensitivity ranges (each input still at its default moved across a typical
  range); recovery against pressure with its sensitivity band and the Pi, Pb
  and abandonment markers; producing GOR and saturations against pressure;
  fractional flow with the Welge tangent; water cut against displacement
  efficiency; gas-oil and water-oil relative permeability; p/z against gas
  recovered.
- **Basis of every estimate**: method and reference, the PVT values used, the
  rock inputs with their source, and the assumptions; a "How recovery is
  estimated" section on the Method tab.
- A **Recovery screening** section in the PDF report (on by default, a box in
  Export), a CSV download of the curves with the basis in its header, and the
  inputs saved with the project.
- Charts can draw shaded bands and several pressure markers.

### Samples tab: comparing PVT reports

A new **Samples** tab (shown with laboratory data, beside PVT reports & QC)
puts the accepted reports of the fluid system side by side for reference.
Reports not yet accepted, or failing QC, can be added with a tick; each
sample can be hidden with a click and keeps its colour across every view.

- **Compositions**: grouped bars of the reservoir-fluid composition by
  component (linear or logarithmic), the stock-tank oil by carbon number where
  a report carries one, and C1 against C7+.
- **Key properties**: depth, reservoir pressure and temperature, Pb, Rsb, API,
  Bob, μob, μod, gas gravity, C1, C7+ and its MW and SG, mud filtrate (oil);
  gas gravity, CGR, condensate API, z and μg at reservoir pressure (gas).
- **Finalised data against pressure**: Rs, Bo, μo and z (oil), z and μg
  (gas), one curve per sample, linked to the pressure cursor.
- **Phase envelopes** from each composition (Peng-Robinson, matched to each
  report's bubble point for oil), with reservoir conditions marked; computed
  one at a time so the tab stays responsive.
- **Trends**: Pb, Rsb and API against depth and Pb against Rsb (oil); CGR,
  methane and gas gravity against depth (gas), with a least-squares line and
  the samples more than two standard deviations off it named.
- **In the PDF report**: a *Sample comparison* section (on by default, a box
  in Export) with the same samples, ticks and colours: key-properties table,
  composition table and grouped bars, the curves against pressure, phase
  envelopes with reservoir conditions, and the trend charts with outliers
  named. Chart legends in the PDF wrap onto a second line when needed.
- New module `js/compare.js`.

### Linked chart tracking

- Every chart against pressure tracks together: hovering one puts the
  crosshair and the readout at the same pressure on all the others, on the
  Summary and Charts tabs (and the correlation-spread and lab-match charts),
  and moves the pressure cursor, the barrel and the phase diagram with it.
  At rest every crosshair sits at the pressure cursor, including after a tab
  switch or a resize.

### Oil and water colour scheme

The web page and the PDF report share a new colour scheme: a navy brand bar
with orange kept for actions and focus (primary button, active tab, focus
ring, bubble-point row), a readable darker orange for orange text and links,
and blue for information notices so orange never looks like a warning. Chart
colours are unchanged. Secondary and muted text is darker (and lighter in
dark mode) so hints, units and descriptions stay legible at full screen
brightness, meeting WCAG AA contrast.

### Oil-based mud contamination

An oil sample drilled with oil-based mud can now be taken back to the clean
reservoir oil before it is checked, finalised and used for tuning.

**New**
- A **Mud contamination** test on every oil report: the stock-tank oil
  composition by carbon number (wt %) and, when analysed, the mud filtrate
  (base oil); filtrate specific gravity, viscosity and volume factor at
  reservoir temperature; the carbon numbers to fit from and, optionally, the
  filtrate range. Paste it from a spreadsheet or import it as a `[mud]`
  section (the report template has one).
- Two ways to **estimate the contamination**, both computed when the data
  allow:
  - **skimming** &mdash; the clean C8+ trend is a straight line of
    ln(mol fraction) against carbon number; the excess above it in the
    filtrate range is the filtrate (range from the filtrate composition, set by
    hand, or found automatically);
  - **subtraction** &mdash; the filtrate composition is removed in the
    proportion that makes the cleaned profile straightest.
  Automatic choice: subtraction when the filtrate is entered, else skimming.
- **Corrections** to the finalised data: R<sub>s</sub> &divide; (1 &minus; v<sub>F</sub>),
  B<sub>o</sub> = (B<sub>o</sub> &minus; v<sub>F</sub>B<sub>F</sub>)/(1 &minus; v<sub>F</sub>),
  stock-tank gravity by volume mixing, dead-oil viscosity by Arrhenius blending
  (live viscosities scaled with it), and the **clean bubble point** from a
  Peng&ndash;Robinson flash of the cleaned composition (C1&ndash;C7+
  interaction regressed to the measured P<sub>b</sub>) or the Standing ratio.
  Saturated rows are stretched to the clean bubble point, undersaturated rows
  shifted; gas z and viscosity stay at their measured pressures.
- **Three new checks**: contamination level (under 5 wt % pass, 5&ndash;10 wt %
  warning, above 10 wt % fail), straightness of the clean trend, and skimming
  against subtraction.
- **Two QC charts**: the stock-tank oil on the semi-log carbon-number plot with
  the clean trend, the cleaned points and the filtrate share; and the
  subtraction misfit against the contamination tried.
- A before/after table (contaminated sample against clean oil) and a
  mud-filtrate tile in the finalised data.
- A fourth example report, an MDT sample with 7 wt % filtrate.
- New dependency-free module `js/contamination.js`.

**Changed**
- The Bo / Rs consistency check interpolates gas z where a row has none of its
  own.
- Reports saved before this version reopen unchanged (no mud data, nothing
  corrected).

**Limitations**
- One homologous filtrate cut and ideal mixing are assumed; ester or olefin
  muds and naturally curved carbon-number profiles weaken the estimate. Gas
  reports are not corrected.

**Tests**: 336 checks (56 new), including the gas material balance of the
Muskat tank, piston-like Buckley&ndash;Leverett displacement, exact p/z recovery
and recovery of a known filtrate share by both contamination methods.

## 1.7.2 &mdash; 2026-11-05 &middot; PDF footer

**Fixed**
- The PDF report footer ran into the page number. The footer now reads
  "PhaseWiz · © 2026 Ankaj Kumar Sinha · PolyForm Noncommercial 1.0.0 ·
  github.com/…" and drops the link, then the licence, if it would come
  within 14 pt of the page number. A test checks the clearance up to
  "Page 100 of 100".

Tests: 280 checks.

## 1.7.1 &mdash; 2026-11-05 &middot; Fresh files after an update

**Fixed**
- After an update a browser could keep last release's scripts from its cache,
  so the page or the PDF report still showed the old name and licence. Every
  script and stylesheet now carries the release number (`?v=1.7.1`), so a new
  release is always fetched afresh. A test checks the tags match the footer
  version.

Tests: 279 checks.

## 1.7.0 &mdash; 2026-11-05 &middot; PhaseWiz

**Changed**
- **Licence**: the code is now under the **PolyForm Noncommercial License
  1.0.0** (previously MIT): free for noncommercial use, a separate licence for
  commercial use. The licence line in the page footer, the Method tab, every
  source header, the report templates and the headers of decks, CSV/JSON
  exports, project files and the PDF report follow it. Copies obtained under
  earlier MIT releases keep the MIT terms.
- The tool is renamed **PhaseWiz**, with "Black-Oil PVT Generator" kept as
  its subtitle. The page title, header, Method tab, report templates and the
  headers of the ECLIPSE, CMG, CSV and JSON exports, project files and the PDF
  report carry the new name.
- **New logo**: a phase envelope (bubble line, dew line and the two-phase
  region) with a spark at the critical point. It is also the browser-tab icon
  (`pvt/favicon.svg`) and is drawn on the PDF report cover.
- Saved projects, imported reports and earlier decks are unaffected: nothing
  reads the name back.

Tests: 277 checks.

## 1.6.1 &mdash; 2026-10-17 &middot; PDF report button

**Changed**
- The PDF report has its **own panel and Download PDF report button** at the
  top of the Export tab, instead of an entry in the Format list, so it is
  visible straight away. The report keeps its own units choice, and a
  collapsible **Report contents** preview shows what it will hold.
- The Format list now holds only the simulator decks, CSV and JSON; their
  preview no longer switches to the report outline.

Tests: 277 checks.

## 1.6.0 &mdash; 2026-10-17 &middot; PDF report

The Export tab writes a **PDF report** of the current case, for readers who
will not open the tool.

**New**
- **PDF report** format in the Export tab, in field or metric units:
  - an **executive summary** written from the case &mdash; fluid and its class,
    saturation pressure and the properties there, undersaturated and saturated
    behaviour, correlations, tuning fit and QC outcome &mdash; with key-result tiles;
  - the **inputs**, the **correlations** and every **quality-check** warning;
  - the **tuning** multipliers and the fit before and after, when tuning is on;
  - eight **key plots** as vector charts, the bubble point marked and laboratory
    points overlaid;
  - **key calculations** with the numbers substituted, and the full
    **property table** with the bubble point highlighted;
  - **method and limitations**, page numbers and the copyright on every page.
- Report title, author and sections are chosen on the tab and remembered; the
  project name goes on the cover and into the file name.
- The PDF is written by a new dependency-free module, `js/report-pdf.js`, so the
  page still works offline.

**Changed**
- The export preview shows the report's contents when PDF is selected.

Tests: 277 checks (13 new).

## 1.5.0 &mdash; 2026-10-16 &middot; PVT reports & QC

A new **PVT reports & QC** tab takes laboratory reports as the laboratory
issued them, checks them, and hands the accepted, finalised data to the tuning.

**New**
- **Oil reports**: composition, constant composition expansion (CCE),
  differential liberation (DL), separator tests and oil viscosity.
- **Gas reports** (dry and wet gas): well-stream composition, separator
  recombination, CCE (z-factor, relative volume, liquid dropout) and gas
  viscosity.
- **Quality checks** on every test, each flagged pass / warning / fail with the
  reason:
  - oil: bubble points that agree between tests, the CCE trend and Y-function,
    undersaturated compressibility and density, DL trends, a stage-by-stage DL
    density mass balance and B<sub>t</sub>, the separator test against the DL
    and the bubble-point density, composition total, C<sub>7+</sub> Watson K,
    separator gas gravity, Hoffman plot, viscosity trends and
    dB<sub>o</sub>/dp &lt; B<sub>g</sub>&middot;dR<sub>s</sub>/dp;
  - gas: composition, recombination, z-factor and dropout trends, viscosity.
- **Separator correction of DL data**: the DL is converted to the separator
  basis by Amyx et al. or the ratio form, and CCE volumes above
  P<sub>b</sub> are scaled by B<sub>ofb</sub>.
- **Peng&ndash;Robinson equation of state** from the report composition, with
  C<sub>7+</sub> characterisation: a computed bubble point to check against the
  laboratory, and a computed phase envelope that replaces the schematic one.
- **Leave readings out** by unticking them or clicking them on a QC chart; the
  checks and the finalised data update at once.
- **Send to the tuning**: accepted reports go to the one-report Lab data &
  tuning tab or, for oil, to the PVT samples screening.
- **CSV import**, one file per report, from a template downloadable on the tab.
  Files saved from Excel read correctly: padded rows, quoted cells, semicolon
  files with decimal commas, and tab-separated files.
- Built-in **example reports** (synthetic data) for oil and gas, including some
  with planted faults, to show what each check catches.

**Changed**
- Project files (Save / Open project) now carry the reports. Older project
  files still open.
- The Method tab and both READMEs describe the reports, checks and corrections.
- The CCE bubble point is taken as the reading nearest V/V<sub>sat</sub> = 1.

**Limitations**
- The equation of state is not tuned to the laboratory data; its envelope shows
  the shape, not a matched model.
- The checks flag inconsistent data; the engineer decides what to accept.
- Several-report screening remains an oil-reservoir workflow; a gas reservoir
  tunes to one report.

Tests: 264 checks (15 new).

## 1.4.0 &mdash; 2026-09-27 &middot; Several PVT reports and project files

**New**
- **Laboratory data mode**, asked on the first visit and changeable in the case
  inputs: none, one PVT report, or several PVT reports.
- **PVT samples & tuning** tab (oil): each sample checked on its own (inputs,
  sampling representativity, P<sub>b</sub> against the correlation, trends,
  B<sub>o</sub>&ndash;R<sub>s</sub> consistency, physical ranges), then against
  the others (robust z-score of the bias, oil gravity, depth trends of
  bottomhole samples). Failed samples are left out unless overridden, and one
  set of multipliers is fitted to all accepted samples together.
- **Save project / Open project**: the whole session in one JSON file.
- One-report mode gains optional sampling conditions and the same data checks.
- Copyright notice in the page, Method tab, footer, every deck and file header,
  and LICENSE.

Tests: 249 checks.

## 1.3.0 &mdash; 2026-09-27 &middot; Professional interface

**Changed**
- Brand bar with unit switch and theme toggle; slate theme in light and dark.
- Titled *Case inputs* panel with section dividers and right-aligned numbers.
- Underline tabs, KPI strip, card headers on charts, status-tinted notices,
  numbered lab-data steps, and a status-strip footer.

No change to any result.

## 1.2.0 &mdash; 2026-09-24 &middot; Laboratory data and tuning

**New**
- **Lab data & tuning** tab: a laboratory table (pressure, R<sub>s</sub>,
  B<sub>o</sub>, oil viscosity, gas z and viscosity) that pastes straight from a
  spreadsheet.
- **Correlation ranking**: every correlation in each family is scored against
  the data before and after tuning, with a match chart per family and a free
  choice of correlation.
- **Tuning**: one multiplier per property, regressed in dependency order; the
  tuned model drives the tables, charts and every export, and deck headers
  record the multipliers and the fit.

**Changed**
- The sidebar laboratory calibration is replaced by the lab table; saved cases
  that used it move into the table and give the same tables.

## 1.1.0 &mdash; 2026-09-23 &middot; Gas reservoirs

**New**
- **Gas reservoir** mode for dry and wet gas: McCain recombination of the
  condensate, gas properties on the separator-gas basis, and a gas barrel and
  envelope that place the reservoir and separator against the cricondentherm.
- ECLIPSE and CMG IMEX gas decks (`*GASWATER`, `*GASWATER_WITH_CONDENSATE`).
- Gas presets: dry, deep dry, wet, rich wet, sour wet, nitrogen-rich.
- The test suite runs on every pull request, so a change is checked before it
  is merged.

**Changed**
- Brine salinity is entered in ppm NaCl.

## 1.0.0 &mdash; 2026-09-22 &middot; First release

- Black-oil PVT from stock-tank oil gravity, separator gas gravity, reservoir
  temperature and R<sub>sb</sub> or a measured P<sub>b</sub>: oil, gas and
  water properties from nineteen published correlations, each with its
  applicability range and QC warnings.
- Correlation spread view, cursor-linked barrel and phase-envelope pictures.
- Exports: ECLIPSE / OPM Flow / tNavigator, CMG IMEX, CSV and JSON, in field
  or metric units, each with a header recording the inputs and warnings.
- Published to GitHub Pages; the tests must pass before the page deploys.
