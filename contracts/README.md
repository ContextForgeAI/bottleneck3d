# Bottleneck3D contracts

This directory stores JSON contracts shared by the web UI, local probe runner,
and the future native OrcaSlicer panel.

Current contract:

- `bottleneck3d-report.schema.json` — local probe report generated next to an
  emitted G-code file.

These schemas are intentionally runtime-agnostic: they can be validated without
OrcaSlicer installed.
