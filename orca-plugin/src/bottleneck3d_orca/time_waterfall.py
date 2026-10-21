"""Build a first-pass time waterfall from emitted G-code timeline aggregates."""

from __future__ import annotations

from typing import Any


SCHEMA_VERSION = 1


def _seconds(value: Any) -> float:
    return float(value or 0.0)


def build_time_waterfall(gcode_timeline: dict[str, Any]) -> dict[str, Any]:
    totals = gcode_timeline.get("totals", {})
    unscaled_seconds = _seconds(totals.get("unscaledSeconds"))
    speed_factor_delta = _seconds(totals.get("speedFactorDeltaSeconds"))
    total_motion = _seconds(totals.get("nominalSeconds"))

    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": "gcode.timeline",
        "mode": "emitted_gcode_audit",
        "confidence": "low",
        "items": [
            {
                "key": "emitted_feed_motion",
                "label": "Motion at emitted G-code feedrates",
                "seconds": unscaled_seconds,
                "operation": "base",
                "source": "G0/G1 F",
            },
            {
                "key": "speed_factor_delta",
                "label": "M220 speed factor adjustment",
                "seconds": speed_factor_delta,
                "operation": "add",
                "source": "M220",
            },
        ],
        "totals": {
            "motionSeconds": total_motion,
            "extrusionSeconds": _seconds(totals.get("extrusionSeconds")),
            "travelSeconds": _seconds(totals.get("travelSeconds")),
        },
        "unavailable": [
            {
                "key": "acceleration_planner_delta",
                "reason": "Needs firmware planner model: lookahead, jerk/JD or square_corner_velocity.",
            },
            {
                "key": "volumetric_flow_delta",
                "reason": "Needs slicer intent or calibrated hotend flow limit, not only emitted G-code.",
            },
            {
                "key": "cooling_delta",
                "reason": "Needs slicer cooling policy and layer-role context.",
            },
        ],
        "notes": [
            "This waterfall explains emitted G-code motion only.",
            "It is not a reslice simulation or hardware capability estimate.",
        ],
    }
