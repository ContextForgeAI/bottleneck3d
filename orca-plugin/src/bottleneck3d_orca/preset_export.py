"""Export Orca presets (system included) for the Bottleneck3D web preset picker."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

EXPORT_FORMAT = "bottleneck3d-orca-presets"
EXPORT_FILE = "bottleneck3d-presets.json"

# Orca collection attribute -> preset "type" as in Orca preset JSON files.
COLLECTIONS: tuple[tuple[str, str], ...] = (
    ("printers", "machine"),
    ("filaments", "filament"),
    ("prints", "process"),
)


def config_text(value: Any) -> Any:
    """Orca preset JSON style: strings, lists of strings, booleans as "1"/"0"."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float):
        text = repr(value)
        return text[:-2] if text.endswith(".0") else text
    if isinstance(value, (list, tuple)):
        return ["" if item is None else config_text(item) for item in value]
    name = getattr(value, "name", None)
    if isinstance(name, str) and not isinstance(value, (str, int)):
        return name
    return str(value)


def _flag(preset: Any, name: str) -> bool:
    attr = getattr(preset, name, False)
    try:
        return bool(attr() if callable(attr) else attr)
    except Exception:  # noqa: BLE001 - host flags are best effort.
        return False


def preset_record(preset: Any, kind: str) -> dict[str, Any] | None:
    name = getattr(preset, "name", "")
    if not name:
        return None
    record: dict[str, Any] = {
        "type": kind,
        "name": name,
        "from": "system" if _flag(preset, "is_system") else "User",
        "instantiation": "true",
    }
    for key in preset.config_keys():
        try:
            value = config_text(preset.config_value(key))
        except Exception:  # noqa: BLE001 - skip options the binding cannot convert.
            continue
        if value is not None and key not in record:
            record[key] = value
    return record


def iter_collection(collection: Any) -> Iterable[Any]:
    for index in range(collection.size()):
        yield collection.preset(index)


def build_preset_export(bundle: Any, orca_version: str = "") -> dict[str, Any]:
    presets: list[dict[str, Any]] = []
    for attribute, kind in COLLECTIONS:
        collection = getattr(bundle, attribute, None)
        if collection is None:
            continue
        for preset in iter_collection(collection):
            if _flag(preset, "is_default") or not _flag(preset, "is_visible"):
                continue
            record = preset_record(preset, kind)
            if record:
                presets.append(record)
    return {
        "format": EXPORT_FORMAT,
        "version": 1,
        "orcaVersion": orca_version,
        "exportedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "presets": presets,
    }


def write_preset_export(bundle: Any, folder: Path, orca_version: str = "") -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / EXPORT_FILE
    data = build_preset_export(bundle, orca_version)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path
