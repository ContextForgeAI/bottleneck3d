# Bottleneck3D OrcaSlicer plugin spike

This package is a local integration spike for OrcaSlicer. It can be developed
and tested without OrcaSlicer installed: tests use a fake context object that
implements the `ctx.config_value(key)` API.

Inside OrcaSlicer, the package exposes a slicing-pipeline capability that runs
at `psGCodePostProcess`, reads resolved profile values, and writes a local
`bottleneck3d-report.json` next to the generated G-code.

The spike does not modify G-code.

The report contains two independent evidence sources:

- `profile` — resolved values returned by `ctx.config_value(...)`;
- `gcodeCommands` — actual emitted commands such as `M201`, `M203`, `M204`,
  `M205`, `M220`, `M221`, `M106`, and `M107`.

It also contains `effectiveProfile`, which applies the current priority rule:
emitted G-code commands win over profile values when both are present.

Finally, `gcodeTimeline` aggregates moves by the active emitted state
(`M204`/`M220`/`M221`/fan). This is the first step toward applying settings by
line range instead of treating the whole G-code as one static profile.
When slicer comments are present, it also normalizes `;TYPE:` / `; FEATURE:`
line roles into values such as `outer_wall`, `infill`, `bridge`, `support`, and
`travel`. Without comments, extrusion roles remain `unknown`; non-extrusion
moves are marked as inferred `travel`.

`timeWaterfall` summarizes the first visible time breakdown for emitted G-code:
base motion at `G0/G1 F`, `M220` speed-factor delta, travel/extrusion split, and
the missing model pieces that still require slicer intent or firmware modeling.

`roleImpact` is intentionally not a duplicate of Orca's preview. It ranks roles
by time contribution and attaches upgrade levers such as `flow`, `motion`,
`cooling`, `quality_limited`, or `needs_role_data`.

## Local checks

```bash
python3 -m unittest discover -s tests
```

Generate a local probe report from bundled fixtures:

```bash
PYTHONPATH=src python3 -m bottleneck3d_orca.local_probe \
  --gcode fixtures/sample.gcode \
  --values fixtures/fake_orca_values.json
```

The command writes `fixtures/bottleneck3d-report.json`; delete that generated
file after manual inspection.

That generated report can be opened in the Bottleneck3D web UI for offline
inspection.

Package skeleton check:

```bash
python3 -m pip wheel . --no-deps --wheel-dir /tmp/bottleneck3d-wheel
```

This verifies Python packaging only. Actual plugin discovery still requires a
real OrcaSlicer runtime.

## Current goal

Verify which profile values are available through Orca's plugin context before
building the real interactive panel and reslice simulation.
