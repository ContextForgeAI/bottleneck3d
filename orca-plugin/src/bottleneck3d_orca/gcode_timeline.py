"""Build an aggregated state timeline from emitted G-code."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

from .line_roles import extract_line_role


SCHEMA_VERSION = 1
EPSILON = 1e-9

COMMAND_PATTERN = re.compile(r"^\s*([A-Za-z]\d+)")
PARAMETER_PATTERN = re.compile(r"([A-Za-z])\s*(-?(?:\d+\.?\d*|\.\d+))")


def _command_part(line: str) -> str:
    return line.split(";", 1)[0].strip()


def _parameters(command_text: str) -> dict[str, float]:
    payload = COMMAND_PATTERN.sub("", command_text, count=1)
    return {
        key.upper(): float(value)
        for key, value in PARAMETER_PATTERN.findall(payload)
    }


def _command(command_text: str) -> str | None:
    match = COMMAND_PATTERN.match(command_text)
    return None if match is None else match.group(1).upper()


def _initial_state() -> dict[str, Any]:
    return {
        "printAcceleration": None,
        "travelAcceleration": None,
        "speedFactorPercent": 100.0,
        "flowFactorPercent": 100.0,
        "fanPwm": None,
        "role": "unknown",
        "roleSource": "unknown",
    }


def _state_key(state: dict[str, Any]) -> str:
    return json.dumps(state, sort_keys=True)


def _group_for(
    groups: dict[str, dict[str, Any]],
    state: dict[str, Any],
    line_number: int,
) -> dict[str, Any]:
    key = _state_key(state)
    if key not in groups:
        groups[key] = {
            "state": dict(state),
            "firstLine": line_number,
            "lastLine": line_number,
            "moveCount": 0,
            "extrusionMoveCount": 0,
            "travelMoveCount": 0,
            "distanceMm": 0.0,
            "extrusionLengthMm": 0.0,
            "flowAdjustedExtrusionMm": 0.0,
            "unscaledSeconds": 0.0,
            "speedFactorDeltaSeconds": 0.0,
            "nominalSeconds": 0.0,
            "extrusionSeconds": 0.0,
            "travelSeconds": 0.0,
        }
    return groups[key]


def _event(
    line_number: int,
    command: str,
    parameters: dict[str, float],
    state: dict[str, Any],
) -> dict[str, Any]:
    return {
        "lineNumber": line_number,
        "command": command,
        "parameters": parameters,
        "state": dict(state),
    }


def build_gcode_timeline(gcode_path: str | Path) -> dict[str, Any]:
    state = _initial_state()
    position = {"x": 0.0, "y": 0.0, "z": 0.0, "e": 0.0}
    feed_rate = 0.0
    absolute_position = True
    absolute_extrusion = True
    groups: dict[str, dict[str, Any]] = {}
    events: list[dict[str, Any]] = []
    role_events: list[dict[str, Any]] = []
    line_count = 0
    move_count = 0
    extrusion_move_count = 0

    with Path(gcode_path).open("r", encoding="utf-8", errors="replace") as handle:
        for line_number, line in enumerate(handle, start=1):
            line_count = line_number
            role = extract_line_role(line)
            if role is not None:
                state["role"] = role["role"]
                state["roleSource"] = role["source"]
                role_events.append(
                    {
                        "lineNumber": line_number,
                        "role": role["role"],
                        "rawRole": role["rawRole"],
                        "source": role["source"],
                    },
                )

            command_text = _command_part(line)
            if not command_text:
                continue

            command = _command(command_text)
            parameters = _parameters(command_text)

            if command in {"G0", "G1"}:
                if "F" in parameters:
                    feed_rate = parameters["F"]

                next_position = dict(position)
                for axis, key in (("X", "x"), ("Y", "y"), ("Z", "z")):
                    if axis in parameters:
                        next_position[key] = (
                            parameters[axis]
                            if absolute_position
                            else position[key] + parameters[axis]
                        )
                if "E" in parameters:
                    next_position["e"] = (
                        parameters["E"]
                        if absolute_extrusion
                        else position["e"] + parameters["E"]
                    )

                distance = math.dist(
                    (position["x"], position["y"], position["z"]),
                    (next_position["x"], next_position["y"], next_position["z"]),
                )
                extrusion_length = max(0.0, next_position["e"] - position["e"])
                position = next_position

                speed_factor = (state["speedFactorPercent"] or 100.0) / 100.0
                unscaled_speed = feed_rate / 60.0
                speed = unscaled_speed * speed_factor
                if distance <= EPSILON or speed <= EPSILON:
                    continue

                unscaled_seconds = distance / unscaled_speed
                nominal_seconds = distance / speed
                move_state = dict(state)
                if extrusion_length <= 0:
                    if move_state["role"] != "travel":
                        move_state["roleSource"] = "inferred_no_extrusion"
                    move_state["role"] = "travel"

                move_count += 1
                group = _group_for(groups, move_state, line_number)
                group["lastLine"] = line_number
                group["moveCount"] += 1
                group["distanceMm"] += distance
                group["unscaledSeconds"] += unscaled_seconds
                group["speedFactorDeltaSeconds"] += nominal_seconds - unscaled_seconds
                group["nominalSeconds"] += nominal_seconds
                if extrusion_length > 0:
                    extrusion_move_count += 1
                    group["extrusionMoveCount"] += 1
                    group["extrusionLengthMm"] += extrusion_length
                    group["flowAdjustedExtrusionMm"] += extrusion_length * (
                        (state["flowFactorPercent"] or 100.0) / 100.0
                    )
                    group["extrusionSeconds"] += nominal_seconds
                else:
                    group["travelMoveCount"] += 1
                    group["travelSeconds"] += nominal_seconds
                continue

            if command == "G90":
                absolute_position = True
            elif command == "G91":
                absolute_position = False
            elif command == "M82":
                absolute_extrusion = True
            elif command == "M83":
                absolute_extrusion = False
            elif command == "G92":
                for axis, key in (("X", "x"), ("Y", "y"), ("Z", "z"), ("E", "e")):
                    if axis in parameters:
                        position[key] = parameters[axis]
            elif command == "M204":
                if "P" in parameters:
                    state["printAcceleration"] = parameters["P"]
                if "T" in parameters:
                    state["travelAcceleration"] = parameters["T"]
                events.append(_event(line_number, command, parameters, state))
            elif command == "M220" and "S" in parameters:
                state["speedFactorPercent"] = parameters["S"]
                events.append(_event(line_number, command, parameters, state))
            elif command == "M221" and "S" in parameters:
                state["flowFactorPercent"] = parameters["S"]
                events.append(_event(line_number, command, parameters, state))
            elif command == "M106":
                state["fanPwm"] = parameters.get("S", 255.0)
                events.append(_event(line_number, command, parameters, state))
            elif command == "M107":
                state["fanPwm"] = 0.0
                events.append(_event(line_number, command, parameters, state))

    sorted_groups = sorted(groups.values(), key=lambda group: group["firstLine"])

    role_summary: dict[str, dict[str, Any]] = {}
    for group in sorted_groups:
        role = group["state"].get("role", "unknown")
        if role not in role_summary:
            role_summary[role] = {
                "moveCount": 0,
                "extrusionMoveCount": 0,
                "travelMoveCount": 0,
                "distanceMm": 0.0,
                "nominalSeconds": 0.0,
                "extrusionSeconds": 0.0,
                "travelSeconds": 0.0,
            }
        role_summary[role]["moveCount"] += group["moveCount"]
        role_summary[role]["extrusionMoveCount"] += group["extrusionMoveCount"]
        role_summary[role]["travelMoveCount"] += group["travelMoveCount"]
        role_summary[role]["distanceMm"] += group["distanceMm"]
        role_summary[role]["nominalSeconds"] += group["nominalSeconds"]
        role_summary[role]["extrusionSeconds"] += group["extrusionSeconds"]
        role_summary[role]["travelSeconds"] += group["travelSeconds"]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": "gcode.timeline",
        "lineCount": line_count,
        "moveCount": move_count,
        "extrusionMoveCount": extrusion_move_count,
        "stateChangeCount": len(events),
        "stateChanges": events,
        "roleChangeCount": len(role_events),
        "roleChanges": role_events,
        "roleSummary": role_summary,
        "totals": {
            "distanceMm": sum(group["distanceMm"] for group in sorted_groups),
            "unscaledSeconds": sum(group["unscaledSeconds"] for group in sorted_groups),
            "speedFactorDeltaSeconds": sum(
                group["speedFactorDeltaSeconds"] for group in sorted_groups
            ),
            "nominalSeconds": sum(group["nominalSeconds"] for group in sorted_groups),
            "extrusionSeconds": sum(group["extrusionSeconds"] for group in sorted_groups),
            "travelSeconds": sum(group["travelSeconds"] for group in sorted_groups),
        },
        "groups": sorted_groups,
    }
