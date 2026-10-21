"""Extract resolved OrcaSlicer profile values from a plugin context."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


SCHEMA_VERSION = 1


@dataclass(frozen=True)
class ConfigKey:
    key: str
    category: str
    confidence: str = "high"
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class ConfigReadError:
    error: str
    message: str


CONFIG_KEYS: tuple[ConfigKey, ...] = (
    ConfigKey("gcode_flavor", "firmware"),
    ConfigKey("emit_machine_limits_to_gcode", "firmware"),
    ConfigKey("machine_max_acceleration_x", "machine"),
    ConfigKey("machine_max_acceleration_y", "machine"),
    ConfigKey("machine_max_acceleration_z", "machine"),
    ConfigKey("machine_max_acceleration_e", "machine"),
    ConfigKey("machine_max_speed_x", "machine"),
    ConfigKey("machine_max_speed_y", "machine"),
    ConfigKey("machine_max_speed_z", "machine"),
    ConfigKey("machine_max_speed_e", "machine"),
    ConfigKey("machine_max_acceleration_extruding", "machine"),
    ConfigKey("machine_max_acceleration_retracting", "machine"),
    ConfigKey("machine_max_acceleration_travel", "machine"),
    ConfigKey("machine_max_jerk_x", "machine"),
    ConfigKey("machine_max_jerk_y", "machine"),
    ConfigKey("machine_max_jerk_z", "machine"),
    ConfigKey("machine_max_jerk_e", "machine"),
    ConfigKey("machine_max_junction_deviation", "machine"),
    ConfigKey("default_acceleration", "process"),
    ConfigKey("outer_wall_acceleration", "process"),
    ConfigKey("inner_wall_acceleration", "process"),
    ConfigKey("sparse_infill_acceleration", "process"),
    ConfigKey("internal_solid_infill_acceleration", "process"),
    ConfigKey("top_surface_acceleration", "process"),
    ConfigKey("bridge_acceleration", "process"),
    ConfigKey("initial_layer_acceleration", "process"),
    ConfigKey("initial_layer_travel_acceleration", "process"),
    ConfigKey("travel_acceleration", "process"),
    ConfigKey("accel_to_decel_enable", "process"),
    ConfigKey("accel_to_decel_factor", "process"),
    ConfigKey("filament_diameter", "filament"),
    ConfigKey(
        "filament_max_volumetric_speed",
        "filament",
        "medium",
        ("Slicer filament limit; not proven hotend capability.",),
    ),
    ConfigKey("filament_adaptive_volumetric_speed", "filament"),
    ConfigKey("volumetric_speed_coefficients", "filament"),
    ConfigKey("nozzle_diameter", "toolhead"),
    ConfigKey("nozzle_volume", "toolhead"),
    ConfigKey("nozzle_hrc", "toolhead"),
    ConfigKey("required_nozzle_HRC", "toolhead"),
    ConfigKey("slow_down_layer_time", "cooling"),
    ConfigKey("slow_down_min_speed", "cooling"),
    ConfigKey("fan_min_speed", "cooling"),
    ConfigKey("fan_max_speed", "cooling"),
    ConfigKey("full_fan_speed_layer", "cooling"),
    ConfigKey("disable_fan_first_layers", "cooling"),
)


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return str(value)


def _is_zero_like(value: Any) -> bool:
    if isinstance(value, (int, float)):
        return value == 0
    if isinstance(value, (list, tuple)) and value:
        return all(_is_zero_like(item) for item in value)
    return False


def _field_for(config_key: ConfigKey, value: Any) -> dict[str, Any]:
    notes = list(config_key.notes)
    confidence = config_key.confidence
    source = "orca_resolved_profile"

    if isinstance(value, ConfigReadError):
        confidence = "unknown"
        source = "unknown"
        notes.append(f"ctx.config_value failed: {value.error}: {value.message}")
        safe_value = None
    elif value is None:
        confidence = "unknown"
        source = "unknown"
        notes.append("ctx.config_value returned no value.")
        safe_value = None
    elif "acceleration" in config_key.key and _is_zero_like(value):
        confidence = "unknown"
        notes.append("Zero acceleration may mean firmware default, not zero.")
        safe_value = _json_safe(value)
    else:
        safe_value = _json_safe(value)

    return {
        "value": safe_value,
        "source": source,
        "confidence": confidence,
        "key": config_key.key,
        "category": config_key.category,
        "notes": notes,
    }


def _read_config_value(ctx: Any, key: str) -> Any:
    try:
        return ctx.config_value(key)
    except Exception as exc:  # noqa: BLE001 - plugin contexts may raise host errors.
        return ConfigReadError(type(exc).__name__, str(exc))


def extract_profile_snapshot(
    ctx: Any,
    keys: Iterable[ConfigKey] = CONFIG_KEYS,
) -> dict[str, Any]:
    fields: dict[str, dict[str, Any]] = {}

    for config_key in keys:
        value = _read_config_value(ctx, config_key.key)
        fields[config_key.key] = _field_for(config_key, value)

    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": "orca.ctx.config_value",
        "fields": fields,
    }
