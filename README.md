# Bottleneck3D

Bottleneck3D is a local-first interactive upgrade simulator for 3D printer owners.

The repository now contains an early working React and TypeScript prototype.
Its interface is currently in Russian.

The target product also includes a native OrcaSlicer plugin. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the integration boundaries and
[ROADMAP.md](ROADMAP.md) for the staged validation plan.

The first OrcaSlicer integration spike lives in
[`orca-plugin/`](orca-plugin/). It can be tested locally without OrcaSlicer by
using fake plugin contexts.

Offline report contracts live in [`contracts/`](contracts/). They define the
shape shared by the probe runner and web report viewer.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (`npm start` opens the browser itself) and
either select a `.gcode` file, select a generated `bottleneck3d-report.json`, or
run the built-in demonstration.

Inside OrcaSlicer 2.5 the same app runs as a «Bottleneck3D» main-window tab:
`npm run build:orca`, then build and install the wheel from `orca-plugin/`.

Useful checks:

```bash
npm test
npm run lint
npm run build
```

The user loads a future print file, enters the current printer limits, and gets a
plain-language diagnosis of what currently limits print speed: hotend flow,
part cooling, or motion system.

## Core idea

- Analyze print files locally, without uploading user models to a server.
- Explain the current bottleneck in human language.
- Let the user virtually install upgrades and immediately see the expected print
  time change.
- Recommend targeted hardware upgrades only when they are likely to improve the
  result.

## Example diagnosis

> 70% of the time the printer was waiting for plastic to melt. The motion system
> is idle. A carbon gantry will not help here. A CHT nozzle or higher-flow hotend
> is the useful upgrade.

## Inputs

- Printer acceleration limits.
- Hotend and nozzle type.
- Maximum volumetric flow.
- Cooling capability.
- Sliced print file or toolpath data.

## Output

- Main speed bottleneck.
- Estimated wasted time by subsystem.
- Upgrade impact simulation.
- Practical hardware recommendation.

## Possible monetization

When Bottleneck3D finds a real upgrade path, it can show vetted marketplace
links for nozzles, hotends, fans, ducts, or motion parts. The user gets a focused
solution, and the project can earn referral revenue.

## Prototype limitations

The motion planner reproduces the slicer time estimators (PrusaSlicer and
OrcaSlicer `GCodeProcessor`: jerk junctions, Marlin planner passes, per-move
accelerations and corner velocities emitted in the G-code) and also offers a
Klipper lookahead model. `npm run compare -- <files|folder>` checks it against
the estimate written by the slicer; on the current set of Orca and PrusaSlicer
files it agrees within 0.1%. That is agreement with the slicer's model, not with
the real printer: actual Klipper print time has not been validated yet. G2/G3
arcs are detected but excluded from timing. Cooling impact is estimated from the
configured minimum layer time rather than from thermal simulation.

A ready G-code file is already a print plan optimized for the current slicer
profile. Without Orca profile intent, Bottleneck3D can audit that plan but must
not present the result as a precise hardware-upgrade forecast.

The prototype must not be used as the basis for a purchase recommendation until
its estimates are validated against slicer estimates and real printer runs. See
[ROADMAP.md](ROADMAP.md) for the validation plan.
