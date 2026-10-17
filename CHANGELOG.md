# Changelog

Major updates to the Black-Oil PVT Generator, newest first. Each entry says what
a user can now do and what changed in the results or the files the tool writes.
Version numbers follow [semantic versioning](https://semver.org): a minor
version adds functionality without breaking saved cases, project files or
decks; a major version would change them.

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
