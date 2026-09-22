# P1-Calculator

Engineering calculation tools.

**Live site: https://authorankaj-glitch.github.io/P1-Calculator/**

- **[Black-Oil PVT Generator](pvt/)** — an interactive web page that builds
  black-oil PVT tables for oil, gas and formation water from industry-standard
  correlations and exports them for ECLIPSE/OPM Flow, CMG IMEX, or as CSV/JSON.
  Use it at
  [authorankaj-glitch.github.io/P1-Calculator/pvt/](https://authorankaj-glitch.github.io/P1-Calculator/pvt/),
  or open `pvt/index.html` from a local clone; see [pvt/README.md](pvt/README.md).
- **Scientific Calculator** — a Python scientific calculator with CLI and GUI
  interfaces (below).

---

## Scientific Calculator

A feature-rich scientific calculator built with Python featuring both CLI and GUI interfaces.

## Features

- **GUI Mode**: Modern, user-friendly graphical interface with light color scheme
- **CLI Mode**: Command-line interface for quick calculations
- **Scientific Functions**: sin, cos, tan, sqrt, log, exp, factorial, and more
- **Constants**: pi, e, tau, phi, inf, nan
- **Memory Operations**: M+, M-, MR, MC
- **Calculation History**: View last 3 calculations in GUI
- **Expression Support**: Full arithmetic with proper operator precedence

## Installation

No external dependencies required. Uses only Python standard library (tkinter for GUI).

## Usage

### GUI Mode (Recommended)
```bash
python3 scientific_calculator.py gui
```

### CLI Mode
```bash
python3 scientific_calculator.py
```

## Examples

### Arithmetic
- `3 + 4 * 2` → 11
- `2 ** 3` → 8
- `sqrt(16)` → 4

### Scientific Functions
- `sin(pi/2)` → 1.0
- `log(100, 10)` → 2.0
- `sqrt(2)` → 1.414...

### Using Answer Variable
- `ans` - recalls the last result

### Memory Operations (GUI)
- `M+` - Add current result to memory
- `M-` - Subtract current result from memory
- `MR` - Recall memory value
- `MC` - Clear memory

## Keyboard Shortcuts (GUI)

- `Enter` - Calculate expression
- `Escape` - Clear expression
- `Backspace` - Delete last character

## Color Scheme

- **Light gray background** - Easy on the eyes
- **Blue button labels** - Clear and readable
- **Orange accent buttons** - C (Clear) and = (Equals)
- **Gray function buttons** - Scientific operations

---

## Deployment

The static site is published to GitHub Pages by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to
`main`. The workflow runs the PVT regression suite first and deploys only if it
passes, so a broken correlation cannot reach the live page.

To run the same checks locally:

```bash
node pvt/tests/run-tests.js
```

## License

[MIT](LICENSE). The PVT correlations themselves are published science, cited in
[pvt/README.md](pvt/README.md); this license covers the implementation.
