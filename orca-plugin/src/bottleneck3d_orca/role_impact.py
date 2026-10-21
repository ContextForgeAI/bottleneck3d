"""Interpret role timing as upgrade relevance, not as another slicer preview."""

from __future__ import annotations

from typing import Any


SCHEMA_VERSION = 1

ROLE_LEVERS: dict[str, dict[str, Any]] = {
    "outer_wall": {
        "levers": ["quality_limited", "flow", "cooling"],
        "note": "Outer walls are usually quality-limited; speed gains need quality validation.",
    },
    "inner_wall": {
        "levers": ["flow", "motion"],
        "note": "Inner walls can often use more flow or acceleration than outer walls.",
    },
    "infill": {
        "levers": ["flow", "motion"],
        "note": "Infill is a strong candidate for high-flow and motion upgrades.",
    },
    "solid_infill": {
        "levers": ["flow", "motion", "cooling"],
        "note": "Solid infill may be flow-limited but top quality can constrain speed.",
    },
    "top_surface": {
        "levers": ["quality_limited", "cooling"],
        "note": "Top surfaces are often quality-limited before hardware-limited.",
    },
    "bridge": {
        "levers": ["cooling", "flow"],
        "note": "Bridge speed is strongly tied to cooling and material behavior.",
    },
    "support": {
        "levers": ["flow", "motion"],
        "note": "Support can often be sped up if quality requirements are lower.",
    },
    "travel": {
        "levers": ["motion"],
        "note": "Travel time points to motion limits, acceleration, and path planning.",
    },
    "unknown": {
        "levers": ["needs_role_data"],
        "note": "No reliable role comments were available for these extrusion moves.",
    },
}


def _seconds(value: Any) -> float:
    return float(value or 0.0)


def _move_type(summary: dict[str, Any]) -> str:
    extrusion = int(summary.get("extrusionMoveCount", 0))
    travel = int(summary.get("travelMoveCount", 0))
    if extrusion and travel:
        return "mixed"
    if extrusion:
        return "extrusion"
    if travel:
        return "travel"
    return "unknown"


def build_role_impact(gcode_timeline: dict[str, Any]) -> dict[str, Any]:
    role_summary = gcode_timeline.get("roleSummary", {})
    total_seconds = _seconds(gcode_timeline.get("totals", {}).get("nominalSeconds"))
    roles = []

    for role, summary in role_summary.items():
        seconds = _seconds(summary.get("nominalSeconds"))
        metadata = ROLE_LEVERS.get(role, ROLE_LEVERS["unknown"])
        roles.append(
            {
                "role": role,
                "seconds": seconds,
                "percent": (seconds / total_seconds) * 100 if total_seconds else 0.0,
                "moveType": _move_type(summary),
                "distanceMm": _seconds(summary.get("distanceMm")),
                "extrusionSeconds": _seconds(summary.get("extrusionSeconds")),
                "travelSeconds": _seconds(summary.get("travelSeconds")),
                "upgradeLevers": metadata["levers"],
                "note": metadata["note"],
            },
        )

    roles.sort(key=lambda item: item["seconds"], reverse=True)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": "gcode.timeline.roleSummary",
        "mode": "upgrade_relevance",
        "totalSeconds": total_seconds,
        "topRole": None if not roles else roles[0]["role"],
        "roles": roles,
        "notes": [
            "This does not duplicate Orca's preview; it ranks roles by upgrade relevance.",
            "Role quality depends on slicer comments until native Orca role data is available.",
        ],
    }
