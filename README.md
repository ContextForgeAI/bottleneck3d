# Bottleneck3D

Bottleneck3D shows where a 3D print spends its time and what an upgrade would
really change. It reads a sliced G-code file locally (nothing is uploaded),
reproduces the slicer's own time estimate, splits the time into printing,
acceleration, travel and layer-cooling slowdown, and simulates upgrades:
acceleration, print speed, hotend flow and minimum layer time.

It runs as a web page and as a tab inside OrcaSlicer 2.5. The interface is in
Russian and English.

## What it does

- **Overview** — total time, the main bottleneck and the file it came from.
- **Time** — time by line role, volumetric flow and per-layer chart.
- **Upgrades** — ready-made upgrade scenarios ranked by savings for this file,
  plus manual levers. Inside Orca, «Check in Orca» reslices the model with the
  chosen change and shows Orca's exact estimate next to the instant forecast.
- **Details** — the motion model, limits and settings read from the file.

## Accuracy

`npm run compare -- <files|folder>` checks the estimate against the one the
slicer wrote into the file. On the current test set (PrusaSlicer 2.5,
OrcaSlicer 2.4 and 2.5.0-alpha with Klipper, including files with G2/G3 arc
fitting) the mean difference is 0.1% and the worst is 0.6%.

The instant upgrade forecast does not reslice the model, so speed and
acceleration changes can differ from a real reslice: the slicer also rebuilds
per-layer slowdowns. «Check in Orca» removes that error; on the test models it
matched Orca's own reslice to the second. The accuracy bench and its results
are in [`demo/accuracy-sweep/`](demo/accuracy-sweep/) and
[`docs/ACCURACY-TEST-PLAN.md`](docs/ACCURACY-TEST-PLAN.md).

All of this is agreement with the slicer's estimator, not with a real printer:
real print times have not been validated yet. Cura, Bambu Studio, SuperSlicer
and newer Orca builds are untested.

## Run the web app

```bash
npm install
npm start        # dev server, opens the browser
```

Open a `.gcode` file, a `bottleneck3d-report.json`, or the built-in demo.

## Install into OrcaSlicer 2.5

Users only need the plugin `.whl` file: see
[`docs/INSTALL-ORCA.md`](docs/INSTALL-ORCA.md). `npm run package:orca` builds it
into `dist-orca/`.

To build and install from source on Windows (Node 24 and
[uv](https://docs.astral.sh/uv/)):

```bash
npm install
npm run install:orca
```

The script builds the page and the plugin wheel and copies it into
`%APPDATA%\OrcaSlicer\orca_plugins\bottleneck3d\`. Restart Orca, slice and
export a model, then open the «Bottleneck3D» tab. Plugin details are in
[`orca-plugin/README.md`](orca-plugin/README.md).

## Checks

```bash
npm test
npm run lint
npm run build
cd orca-plugin && uv run --with pytest pytest tests
```

## Limitations

- The time card shows how far the number can be trusted: «checked against the
  slicer ±X%» or «approximate» with the reason (untested slicer, no estimate or
  config in the file, difference above 1%).
- Cooling impact comes from the configured minimum layer time, not from a
  thermal simulation.
- «Check in Orca» slices the plate as STL: modifiers, painting and per-object
  settings are lost. A baseline reslice without changes is subtracted to cancel
  most of that error.
- Do not base purchase decisions on the forecast alone until it is validated
  against real prints. See [ROADMAP.md](ROADMAP.md) and
  [`docs/IMPROVEMENT-PLAN.md`](docs/IMPROVEMENT-PLAN.md).
