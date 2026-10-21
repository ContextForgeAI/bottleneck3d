"""Write Bottleneck3D local diagnostic reports."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


REPORT_NAME = "bottleneck3d-report.json"


def build_report(
    gcode_path: str | Path,
    profile_snapshot: dict[str, Any],
    gcode_command_snapshot: dict[str, Any] | None = None,
    effective_profile: dict[str, Any] | None = None,
    gcode_timeline: dict[str, Any] | None = None,
    time_waterfall: dict[str, Any] | None = None,
    role_impact: dict[str, Any] | None = None,
) -> dict[str, Any]:
    path = Path(gcode_path)
    size_bytes = path.stat().st_size if path.exists() else None

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "mode": "orca_profile_probe",
        "gcode": {
            "fileName": path.name,
            "sizeBytes": size_bytes,
        },
        "profile": profile_snapshot,
        "gcodeCommands": gcode_command_snapshot,
        "effectiveProfile": effective_profile,
        "gcodeTimeline": gcode_timeline,
        "timeWaterfall": time_waterfall,
        "roleImpact": role_impact,
        "notes": [
            "This spike report is local-only and does not modify G-code.",
            "Resolved profile values are observations, not proven hardware capability.",
        ],
    }


def write_report(
    gcode_path: str | Path,
    profile_snapshot: dict[str, Any],
    gcode_command_snapshot: dict[str, Any] | None = None,
    effective_profile: dict[str, Any] | None = None,
    gcode_timeline: dict[str, Any] | None = None,
    time_waterfall: dict[str, Any] | None = None,
    role_impact: dict[str, Any] | None = None,
    report_name: str = REPORT_NAME,
) -> Path:
    path = Path(gcode_path)
    report_path = path.with_name(report_name)
    report = build_report(
        path,
        profile_snapshot,
        gcode_command_snapshot,
        effective_profile,
        gcode_timeline,
        time_waterfall,
        role_impact,
    )
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return report_path
