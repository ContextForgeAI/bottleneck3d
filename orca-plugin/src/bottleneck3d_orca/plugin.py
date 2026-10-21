"""OrcaSlicer plugin entrypoint for the Bottleneck3D spike."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .effective_profile import build_effective_profile
from .gcode_command_extractor import extract_gcode_command_snapshot
from .gcode_timeline import build_gcode_timeline
from .profile_extractor import extract_profile_snapshot
from .report_writer import write_report
from .role_impact import build_role_impact
from .time_waterfall import build_time_waterfall

try:
    import orca  # type: ignore[import-not-found]
except ModuleNotFoundError:  # Local tests run without OrcaSlicer.
    orca = None  # type: ignore[assignment]


def run_profile_probe(ctx: Any) -> Path:
    """Extract profile values and write a local report next to the G-code."""
    gcode_path = getattr(ctx, "gcode_path", None)
    if not gcode_path:
        raise ValueError("Orca context does not expose gcode_path.")

    profile_snapshot = extract_profile_snapshot(ctx)
    command_snapshot = extract_gcode_command_snapshot(gcode_path)
    effective_profile = build_effective_profile(profile_snapshot, command_snapshot)
    gcode_timeline = build_gcode_timeline(gcode_path)
    time_waterfall = build_time_waterfall(gcode_timeline)
    role_impact = build_role_impact(gcode_timeline)
    return write_report(
        gcode_path,
        profile_snapshot,
        command_snapshot,
        effective_profile,
        gcode_timeline,
        time_waterfall,
        role_impact,
    )


if orca is not None:

    class Bottleneck3DProfileProbe(orca.slicing.SlicingPipelineCapabilityBase):
        def get_name(self):
            return "Bottleneck3D Profile Probe"

        def execute(self, ctx):
            if ctx.step != orca.slicing.Step.psGCodePostProcess:
                return orca.ExecutionResult.success("Skipped non-G-code step.")

            try:
                report_path = run_profile_probe(ctx)
            except Exception as exc:  # noqa: BLE001 - keep slicing from hard failing.
                return orca.ExecutionResult.success(
                    f"Bottleneck3D profile probe failed: {type(exc).__name__}: {exc}",
                )

            return orca.ExecutionResult.success(
                f"Bottleneck3D report written: {report_path.name}",
            )


    @orca.plugin
    class Bottleneck3DPlugin(orca.base):
        def register_capabilities(self):
            orca.register_capability(Bottleneck3DProfileProbe)
