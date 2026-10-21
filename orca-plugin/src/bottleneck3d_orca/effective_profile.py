"""Resolve effective printer values from Orca profile and emitted G-code."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


SCHEMA_VERSION = 1


@dataclass(frozen=True)
class GcodeOverrideMapping:
    effective_key: str
    profile_key: str | None
    command: str
    parameter: str | None
    notes: tuple[str, ...] = ()


GCODE_OVERRIDE_MAPPINGS: tuple[GcodeOverrideMapping, ...] = (
    GcodeOverrideMapping("machine_max_acceleration_x", "machine_max_acceleration_x", "M201", "X"),
    GcodeOverrideMapping("machine_max_acceleration_y", "machine_max_acceleration_y", "M201", "Y"),
    GcodeOverrideMapping("machine_max_acceleration_z", "machine_max_acceleration_z", "M201", "Z"),
    GcodeOverrideMapping("machine_max_acceleration_e", "machine_max_acceleration_e", "M201", "E"),
    GcodeOverrideMapping("machine_max_speed_x", "machine_max_speed_x", "M203", "X"),
    GcodeOverrideMapping("machine_max_speed_y", "machine_max_speed_y", "M203", "Y"),
    GcodeOverrideMapping("machine_max_speed_z", "machine_max_speed_z", "M203", "Z"),
    GcodeOverrideMapping("machine_max_speed_e", "machine_max_speed_e", "M203", "E"),
    GcodeOverrideMapping(
        "effective_print_acceleration",
        "default_acceleration",
        "M204",
        "P",
        ("M204 P is the active print acceleration in emitted G-code.",),
    ),
    GcodeOverrideMapping(
        "effective_travel_acceleration",
        "travel_acceleration",
        "M204",
        "T",
        ("M204 T is the active travel acceleration in emitted G-code.",),
    ),
    GcodeOverrideMapping("machine_max_jerk_x", "machine_max_jerk_x", "M205", "X"),
    GcodeOverrideMapping("machine_max_jerk_y", "machine_max_jerk_y", "M205", "Y"),
    GcodeOverrideMapping("machine_max_jerk_z", "machine_max_jerk_z", "M205", "Z"),
    GcodeOverrideMapping("machine_max_jerk_e", "machine_max_jerk_e", "M205", "E"),
    GcodeOverrideMapping(
        "machine_max_junction_deviation",
        "machine_max_junction_deviation",
        "M205",
        "J",
    ),
    GcodeOverrideMapping("speed_factor_percent", None, "M220", "S"),
    GcodeOverrideMapping("flow_factor_percent", None, "M221", "S"),
    GcodeOverrideMapping("last_fan_pwm", None, "M106", "S"),
    GcodeOverrideMapping(
        "last_fan_pwm",
        None,
        "M107",
        None,
        ("M107 disables part cooling fan; represented as PWM 0.",),
    ),
)


def _field(profile_snapshot: dict[str, Any], key: str | None) -> dict[str, Any] | None:
    if key is None:
        return None
    return profile_snapshot.get("fields", {}).get(key)


def _first_number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, list) and value:
        return _first_number(value[0])
    return None


def _same_number(left: Any, right: Any) -> bool:
    left_number = _first_number(left)
    right_number = _first_number(right)
    if left_number is None or right_number is None:
        return left == right
    return abs(left_number - right_number) < 1e-6


def _last_command(
    gcode_command_snapshot: dict[str, Any] | None,
    command: str,
) -> dict[str, Any] | None:
    if not gcode_command_snapshot:
        return None
    return gcode_command_snapshot.get("lastByCommand", {}).get(command)


def _command_value(observation: dict[str, Any], parameter: str | None) -> float | None:
    if parameter is None and observation.get("command") == "M107":
        return 0.0
    if parameter is None:
        return None
    return observation.get("parameters", {}).get(parameter)


def _profile_effective_field(key: str, field: dict[str, Any]) -> dict[str, Any]:
    return {
        "value": field.get("value"),
        "source": field.get("source", "unknown"),
        "confidence": field.get("confidence", "unknown"),
        "profileKey": key,
        "profileValue": field.get("value"),
        "resolution": "profile_value",
        "notes": list(field.get("notes", [])),
    }


def _gcode_effective_field(
    mapping: GcodeOverrideMapping,
    observation: dict[str, Any],
    value: float,
    profile_field: dict[str, Any] | None,
) -> dict[str, Any]:
    notes = list(mapping.notes)
    if profile_field and profile_field.get("value") is not None:
        notes.append("G-code command wins because it is part of the emitted print plan.")

    return {
        "value": value,
        "source": "gcode_command",
        "confidence": "high",
        "profileKey": mapping.profile_key,
        "profileValue": None if profile_field is None else profile_field.get("value"),
        "gcodeCommand": {
            "command": observation.get("command"),
            "lineNumber": observation.get("lineNumber"),
            "parameter": mapping.parameter,
            "raw": observation.get("raw"),
        },
        "resolution": "gcode_overrides_profile",
        "notes": notes,
    }


def build_effective_profile(
    profile_snapshot: dict[str, Any],
    gcode_command_snapshot: dict[str, Any] | None,
) -> dict[str, Any]:
    fields = {
        key: _profile_effective_field(key, field)
        for key, field in profile_snapshot.get("fields", {}).items()
    }
    conflicts: list[dict[str, Any]] = []

    for mapping in GCODE_OVERRIDE_MAPPINGS:
        observation = _last_command(gcode_command_snapshot, mapping.command)
        if observation is None:
            continue

        command_value = _command_value(observation, mapping.parameter)
        if command_value is None:
            continue

        profile_field = _field(profile_snapshot, mapping.profile_key)
        if (
            profile_field
            and profile_field.get("value") is not None
            and profile_field.get("confidence") != "unknown"
        ):
            profile_value = profile_field.get("value")
            if not _same_number(profile_value, command_value):
                conflicts.append(
                    {
                        "effectiveKey": mapping.effective_key,
                        "profileKey": mapping.profile_key,
                        "profileValue": profile_value,
                        "gcodeValue": command_value,
                        "gcodeCommand": observation.get("command"),
                        "lineNumber": observation.get("lineNumber"),
                        "resolution": "gcode_command_wins",
                    },
                )

        fields[mapping.effective_key] = _gcode_effective_field(
            mapping,
            observation,
            command_value,
            profile_field,
        )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": "effective_profile_resolver",
        "fields": fields,
        "conflicts": conflicts,
    }
