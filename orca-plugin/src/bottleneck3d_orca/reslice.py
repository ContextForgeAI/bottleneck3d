"""Re-slice the current Orca model with upgrade-lever changes via orca-slicer CLI."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import struct
import sys
import threading
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol
from xml.etree import ElementTree as ET

from ._preset_keys import FILAMENT_KEYS, MACHINE_KEYS, PROCESS_KEYS

PROTOCOL = "b3d"
FLAT_NAMES = {
    "machine": "B3D Reslice Machine",
    "process": "B3D Reslice Process",
    "filament": "B3D Reslice Filament",
}
PRINT_ACCEL_KEYS = (
    "default_acceleration",
    "outer_wall_acceleration",
    "inner_wall_acceleration",
    "top_surface_acceleration",
)
PRINT_SPEED_KEYS = (
    "outer_wall_speed",
    "inner_wall_speed",
    "sparse_infill_speed",
    "internal_solid_infill_speed",
    "top_surface_speed",
)
MACHINE_ACCEL_KEYS = (
    "machine_max_acceleration_x",
    "machine_max_acceleration_y",
    "machine_max_acceleration_extruding",
    "machine_max_acceleration_travel",
)
MACHINE_SPEED_KEYS = ("machine_max_speed_x", "machine_max_speed_y")
FALLBACK_EXE = Path(r"C:\Program Files\OrcaSlicer\orca-slicer.exe")
SLICE_TIMEOUT_S = 600
CREATE_NO_WINDOW = 0x08000000
IDENTITY = (
    (1.0, 0.0, 0.0, 0.0),
    (0.0, 1.0, 0.0, 0.0),
    (0.0, 0.0, 1.0, 0.0),
    (0.0, 0.0, 0.0, 1.0),
)
_DURATION = re.compile(r"(\d+(?:\.\d+)?)\s*([dhms])", re.I)
_FACTORS = {"d": 86400.0, "h": 3600.0, "m": 60.0, "s": 1.0}
_ESTIMATE = re.compile(
    r";\s*estimated printing time \(normal mode\)\s*=\s*(.+)",
    re.I,
)
_CONFIG_LINE = re.compile(r"^;\s*([a-z][a-z0-9_]*)\s*=\s*(.*)$")


class ResliceError(Exception):
    """User-facing failure while preparing or running a re-slice."""


@dataclass
class ResliceChanges:
    acceleration_scale: float | None = None
    print_speed_scale: float | None = None
    max_volumetric_flow: float | None = None
    minimum_layer_time: float | None = None
    raise_machine_acceleration: bool = False
    raise_machine_speed: bool = False
    raise_machine_speed_to: float | None = None


@dataclass(frozen=True)
class MeshPart:
    vertices: tuple[tuple[float, float, float], ...]
    triangles: tuple[tuple[int, int, int], ...]
    matrix: tuple[tuple[float, float, float, float], ...]


@dataclass
class Snapshot:
    gcode_name: str
    gcode_mtime: float
    config: dict[str, str]
    sections: dict[str, dict[str, Any]]
    parts: tuple[MeshPart, ...]
    config_hash: str


@dataclass
class SliceOutcome:
    ok: bool
    seconds: float | None
    gcode_name: str | None
    elapsed_ms: int
    message: str = ""


class SlicerRunner(Protocol):
    def slice(
        self,
        model_path: Path,
        output_dir: Path,
        machine: dict[str, Any],
        process: dict[str, Any],
        filament: dict[str, Any],
        timeout_s: float,
        cancel: threading.Event,
    ) -> SliceOutcome: ...


def parse_duration(text: str) -> float | None:
    total = 0.0
    found = False
    for number, unit in _DURATION.findall(text):
        total += float(number) * _FACTORS[unit.lower()]
        found = True
    return total if found else None


def parse_estimate_seconds(gcode_text: str) -> float | None:
    for line in reversed(gcode_text.splitlines()):
        match = _ESTIMATE.match(line.strip())
        if match:
            return parse_duration(match.group(1))
    return None


def parse_config_block(text: str) -> dict[str, str]:
    start = text.find("; CONFIG_BLOCK_START")
    end = text.find("; CONFIG_BLOCK_END")
    if start < 0 or end < 0 or end <= start:
        raise ResliceError("В G-code нет блока CONFIG_BLOCK — нужен файл OrcaSlicer.")
    config: dict[str, str] = {}
    for line in text[start:end].splitlines():
        match = _CONFIG_LINE.match(line.strip())
        if not match:
            continue
        config[match.group(1)] = match.group(2).rstrip()
    if not config:
        raise ResliceError("Блок CONFIG_BLOCK пуст.")
    return config


def key_sets_from_bundle(bundle: Any) -> dict[str, frozenset[str]] | None:
    from .preset_export import COLLECTIONS, iter_collection

    sets = {"machine": set(), "filament": set(), "process": set()}
    try:
        for attribute, kind in COLLECTIONS:
            collection = getattr(bundle, attribute, None)
            if collection is None:
                continue
            for preset in iter_collection(collection):
                keys = getattr(preset, "config_keys", None)
                if not callable(keys):
                    continue
                try:
                    sets[kind].update(keys())
                except Exception:  # noqa: BLE001 - skip presets the binding cannot read.
                    continue
    except Exception:  # noqa: BLE001 - fall back to the baked Orca 2.5 lists.
        return None
    if not any(sets.values()):
        return None
    return {kind: frozenset(keys) for kind, keys in sets.items()}


def fallback_key_sets() -> dict[str, frozenset[str]]:
    return {"machine": MACHINE_KEYS, "process": PROCESS_KEYS, "filament": FILAMENT_KEYS}


def _heuristic_section(key: str) -> str | None:
    if key.startswith(("machine_", "printer_", "nozzle_", "printable_", "extruder_")):
        return "machine"
    if key.startswith(("filament_", "slow_down_")):
        return "filament"
    return None


def split_config_sections(
    config: dict[str, str],
    key_sets: dict[str, frozenset[str]] | None = None,
) -> dict[str, dict[str, Any]]:
    sets = key_sets or fallback_key_sets()
    sections: dict[str, dict[str, Any]] = {"machine": {}, "process": {}, "filament": {}}
    for key, value in config.items():
        placed = False
        for kind, keys in sets.items():
            if key in keys:
                sections[kind][key] = value
                placed = True
        if not placed:
            kind = _heuristic_section(key)
            if kind:
                sections[kind][key] = value
    return {kind: _finish_preset(kind, values) for kind, values in sections.items()}


def _finish_preset(kind: str, values: dict[str, Any]) -> dict[str, Any]:
    name = FLAT_NAMES[kind]
    preset = dict(values)
    preset["type"] = kind
    preset["name"] = name
    preset["from"] = "User"
    preset["instantiation"] = "true"
    preset["compatible_printers"] = []
    if kind == "machine":
        preset["printer_settings_id"] = name
    elif kind == "process":
        preset["print_settings_id"] = name
    else:
        preset["filament_settings_id"] = [name]
    return preset


def parse_changes(raw: Any) -> ResliceChanges:
    data = raw if isinstance(raw, dict) else {}

    def number(*keys: str) -> float | None:
        for key in keys:
            if key in data and data[key] is not None and data[key] != "":
                return float(data[key])
        return None

    def flag(*keys: str) -> bool:
        for key in keys:
            if key in data:
                return bool(data[key])
        return False

    return ResliceChanges(
        acceleration_scale=number("accelerationScale", "acceleration_scale"),
        print_speed_scale=number("printSpeedScale", "print_speed_scale"),
        max_volumetric_flow=number("maxVolumetricFlow", "max_volumetric_flow"),
        minimum_layer_time=number("minimumLayerTime", "minimum_layer_time"),
        raise_machine_acceleration=flag(
            "raiseMachineAcceleration", "raise_machine_acceleration"
        ),
        raise_machine_speed=flag("raiseMachineSpeed", "raise_machine_speed"),
        raise_machine_speed_to=number("raiseMachineSpeedTo", "raise_machine_speed_to"),
    )


def first_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, (list, tuple)) and value:
        return first_number(value[0])
    text = str(value).strip()
    if not text or text.endswith("%"):
        return None
    token = text.split(",")[0].strip()
    try:
        return float(token)
    except ValueError:
        return None


def format_number(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return text or "0"


def set_scalar(preset: dict[str, Any], key: str, value: float) -> None:
    text = format_number(value)
    current = preset.get(key)
    if isinstance(current, list):
        preset[key] = [text] * len(current)
        return
    if isinstance(current, str) and "," in current:
        preset[key] = ",".join(text for _ in current.split(","))
        return
    preset[key] = text


def scale_scalar(preset: dict[str, Any], key: str, factor: float) -> None:
    number = first_number(preset.get(key))
    if number is None:
        return
    set_scalar(preset, key, number * factor)


def apply_changes(
    sections: dict[str, dict[str, Any]],
    changes: ResliceChanges | dict[str, Any],
) -> dict[str, dict[str, Any]]:
    parsed = changes if isinstance(changes, ResliceChanges) else parse_changes(changes)
    machine = dict(sections["machine"])
    process = dict(sections["process"])
    filament = dict(sections["filament"])

    if parsed.acceleration_scale is not None:
        factor = parsed.acceleration_scale
        for key in PRINT_ACCEL_KEYS:
            if key in process:
                scale_scalar(process, key, factor)
        if parsed.raise_machine_acceleration and factor > 1 + 1e-9:
            for key in MACHINE_ACCEL_KEYS:
                if key in machine:
                    scale_scalar(machine, key, factor)
        else:
            _raise_machine_accel_to_process(machine, process)

    if parsed.print_speed_scale is not None:
        for key in PRINT_SPEED_KEYS:
            if key in process:
                scale_scalar(process, key, parsed.print_speed_scale)

    if parsed.max_volumetric_flow is not None:
        set_scalar(filament, "filament_max_volumetric_speed", parsed.max_volumetric_flow)

    if parsed.minimum_layer_time is not None:
        set_scalar(filament, "slow_down_layer_time", parsed.minimum_layer_time)

    if parsed.raise_machine_speed:
        target = parsed.raise_machine_speed_to
        if target is None and parsed.print_speed_scale is not None:
            speeds = [first_number(machine.get(key)) or 0.0 for key in MACHINE_SPEED_KEYS]
            target = max(speeds) * parsed.print_speed_scale
        if target is not None:
            for key in MACHINE_SPEED_KEYS:
                current = first_number(machine.get(key)) or 0.0
                if target > current:
                    set_scalar(machine, key, target)

    return {"machine": machine, "process": process, "filament": filament}


def _raise_machine_accel_to_process(
    machine: dict[str, Any], process: dict[str, Any]
) -> None:
    needed = 0.0
    for key in PRINT_ACCEL_KEYS:
        number = first_number(process.get(key))
        if number is not None:
            needed = max(needed, number)
    if needed <= 0:
        return
    for key in MACHINE_ACCEL_KEYS[:3]:
        current = first_number(machine.get(key))
        if current is not None and needed > current + 1e-9:
            set_scalar(machine, key, needed)


def _as_vec3(value: Any, default: tuple[float, float, float]) -> tuple[float, float, float]:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        number = float(value)
        return (number, number, number)
    seq = list(value)
    if not seq:
        return default
    if len(seq) == 1:
        number = float(seq[0])
        return (number, number, number)
    return (float(seq[0]), float(seq[1]), float(seq[2] if len(seq) > 2 else default[2]))


def _attr(obj: Any, name: str, default: Any = None) -> Any:
    attr = getattr(obj, name, default)
    try:
        return attr() if callable(attr) else attr
    except Exception:  # noqa: BLE001 - host accessors are best effort.
        return default


def _matmul(
    left: tuple[tuple[float, float, float, float], ...],
    right: tuple[tuple[float, float, float, float], ...],
) -> tuple[tuple[float, float, float, float], ...]:
    return tuple(
        tuple(sum(left[i][k] * right[k][j] for k in range(4)) for j in range(4))
        for i in range(4)
    )


def _transform(
    offset: tuple[float, float, float],
    rotation: tuple[float, float, float],
    scale: tuple[float, float, float],
    mirror: tuple[float, float, float],
) -> tuple[tuple[float, float, float, float], ...]:
    def diag(x: float, y: float, z: float) -> tuple[tuple[float, float, float, float], ...]:
        return (
            (x, 0.0, 0.0, 0.0),
            (0.0, y, 0.0, 0.0),
            (0.0, 0.0, z, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        )

    def rotate(axis: str, angle: float) -> tuple[tuple[float, float, float, float], ...]:
        cosine, sine = math.cos(angle), math.sin(angle)
        if axis == "x":
            return (
                (1.0, 0.0, 0.0, 0.0),
                (0.0, cosine, -sine, 0.0),
                (0.0, sine, cosine, 0.0),
                (0.0, 0.0, 0.0, 1.0),
            )
        if axis == "y":
            return (
                (cosine, 0.0, sine, 0.0),
                (0.0, 1.0, 0.0, 0.0),
                (-sine, 0.0, cosine, 0.0),
                (0.0, 0.0, 0.0, 1.0),
            )
        return (
            (cosine, -sine, 0.0, 0.0),
            (sine, cosine, 0.0, 0.0),
            (0.0, 0.0, 1.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        )

    translate = (
        (1.0, 0.0, 0.0, offset[0]),
        (0.0, 1.0, 0.0, offset[1]),
        (0.0, 0.0, 1.0, offset[2]),
        (0.0, 0.0, 0.0, 1.0),
    )
    return _matmul(
        translate,
        _matmul(
            rotate("z", rotation[2]),
            _matmul(
                rotate("y", rotation[1]),
                _matmul(
                    rotate("x", rotation[0]),
                    _matmul(diag(*scale), diag(*mirror)),
                ),
            ),
        ),
    )


def _numpy_matrix(obj: Any) -> tuple[tuple[float, float, float, float], ...] | None:
    getter = getattr(obj, "matrix", None)
    if not callable(getter):
        return None
    try:
        import numpy as np

        matrix = np.asarray(getter(), dtype=float)
        if matrix.shape != (4, 4):
            return None
        return tuple(tuple(float(cell) for cell in row) for row in matrix)
    except Exception:  # noqa: BLE001 - numpy or the binding may be missing.
        return None


def instance_matrix(obj: Any) -> tuple[tuple[float, float, float, float], ...]:
    matrix = _numpy_matrix(obj)
    if matrix is not None:
        return matrix
    return _transform(
        _as_vec3(_attr(obj, "offset"), (0.0, 0.0, 0.0)),
        _as_vec3(_attr(obj, "rotation"), (0.0, 0.0, 0.0)),
        _as_vec3(_attr(obj, "scaling_factor"), (1.0, 1.0, 1.0)),
        _as_vec3(_attr(obj, "mirror"), (1.0, 1.0, 1.0)),
    )


def _iter_indexed(container: Any, plural: str, singular: str) -> list[Any]:
    getter = getattr(container, plural, None)
    if callable(getter):
        try:
            items = getter()
            if items is not None:
                return list(items)
        except TypeError:
            pass
    count = _attr(container, "size", None)
    if count is None:
        count = _attr(container, f"{singular}_count", None)
    item = getattr(container, singular, None)
    if callable(item) and isinstance(count, int):
        return [item(index) for index in range(count)]
    return []


def _mesh_geometry(mesh: Any) -> tuple[list[tuple[float, float, float]], list[tuple[int, int, int]]]:
    try:
        import numpy as np

        vertices = np.asarray(mesh.vertices())
        triangles = np.asarray(mesh.triangles())
        return (
            [tuple(float(cell) for cell in row) for row in vertices],
            [tuple(int(cell) for cell in row) for row in triangles],
        )
    except Exception:  # noqa: BLE001 - numpy-free path is the default.
        pass
    vertex_count = int(_attr(mesh, "vertex_count", 0) or 0)
    triangle_count = int(
        _attr(mesh, "triangle_count", None) or _attr(mesh, "facets_count", 0) or 0
    )
    return (
        [tuple(float(cell) for cell in mesh.vertex(index)) for index in range(vertex_count)],
        [tuple(int(cell) for cell in mesh.triangle(index)) for index in range(triangle_count)],
    )


def snapshot_model(model: Any) -> tuple[MeshPart, ...]:
    parts: list[MeshPart] = []
    objects = _iter_indexed(model, "objects", "object")
    if not objects:
        raw = _attr(model, "objects")
        objects = list(raw) if raw else []
    for obj in objects:
        instances = _iter_indexed(obj, "instances", "instance")
        volumes = _iter_indexed(obj, "volumes", "volume")
        if not instances:
            instances = [None]
        for instance in instances:
            inst_xf = instance_matrix(instance) if instance is not None else IDENTITY
            for volume in volumes:
                vol_xf = instance_matrix(volume)
                mesh = _attr(volume, "mesh")
                if mesh is None:
                    continue
                vertices, triangles = _mesh_geometry(mesh)
                if not triangles:
                    continue
                parts.append(
                    MeshPart(
                        vertices=tuple(vertices),
                        triangles=tuple(triangles),
                        matrix=_matmul(inst_xf, vol_xf),
                    )
                )
    return tuple(parts)


def _apply_point(
    matrix: tuple[tuple[float, float, float, float], ...],
    point: tuple[float, float, float],
) -> tuple[float, float, float]:
    x, y, z = point
    return (
        matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z + matrix[0][3],
        matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z + matrix[1][3],
        matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z + matrix[2][3],
    )


def _det3(matrix: tuple[tuple[float, float, float, float], ...]) -> float:
    a, b, c = matrix[0][0], matrix[0][1], matrix[0][2]
    d, e, f = matrix[1][0], matrix[1][1], matrix[1][2]
    g, h, i = matrix[2][0], matrix[2][1], matrix[2][2]
    return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)


def _normal(
    v0: tuple[float, float, float],
    v1: tuple[float, float, float],
    v2: tuple[float, float, float],
) -> tuple[float, float, float]:
    ux, uy, uz = v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]
    vx, vy, vz = v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz)
    if length <= 1e-12:
        return (0.0, 0.0, 0.0)
    return (nx / length, ny / length, nz / length)


def write_binary_stl(path: Path, parts: tuple[MeshPart, ...]) -> int:
    triangles: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]] = []
    for part in parts:
        flipped = _det3(part.matrix) < 0
        world = [_apply_point(part.matrix, vertex) for vertex in part.vertices]
        for a, b, c in part.triangles:
            v0, v1, v2 = world[a], world[b], world[c]
            if flipped:
                v1, v2 = v2, v1
            triangles.append((v0, v1, v2))
    if not triangles:
        raise ResliceError("Модель пуста — нечего нарезать.")
    path.parent.mkdir(parents=True, exist_ok=True)
    header = b"Bottleneck3D reslice" + b"\0" * (80 - 20)
    with path.open("wb") as handle:
        handle.write(header)
        handle.write(struct.pack("<I", len(triangles)))
        for v0, v1, v2 in triangles:
            nx, ny, nz = _normal(v0, v1, v2)
            handle.write(struct.pack("<12fH", nx, ny, nz, *v0, *v1, *v2, 0))
    return len(triangles)


def read_binary_stl(path: Path) -> MeshPart:
    data = path.read_bytes()
    count = struct.unpack_from("<I", data, 80)[0]
    vertices: list[tuple[float, float, float]] = []
    triangles: list[tuple[int, int, int]] = []
    index_of: dict[tuple[float, float, float], int] = {}
    offset = 84
    for _ in range(count):
        packed = struct.unpack_from("<12fH", data, offset)
        offset += 50
        points = (packed[3:6], packed[6:9], packed[9:12])
        ids = []
        for point in points:
            key = (float(point[0]), float(point[1]), float(point[2]))
            if key not in index_of:
                index_of[key] = len(vertices)
                vertices.append(key)
            ids.append(index_of[key])
        triangles.append((ids[0], ids[1], ids[2]))
    return MeshPart(tuple(vertices), tuple(triangles), IDENTITY)


def read_3mf_mesh(path: Path) -> MeshPart:
    with zipfile.ZipFile(path) as archive:
        name = next(
            (item for item in archive.namelist() if item.lower().endswith(".model")),
            None,
        )
        if name is None:
            raise ResliceError(f"В {path.name} нет 3D-модели.")
        xml = archive.read(name)
    root = ET.fromstring(xml)
    ns = {"m": "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"}
    vertices = [
        (float(node.get("x", 0)), float(node.get("y", 0)), float(node.get("z", 0)))
        for node in root.findall(".//m:vertex", ns)
    ]
    triangles = [
        (int(node.get("v1", 0)), int(node.get("v2", 0)), int(node.get("v3", 0)))
        for node in root.findall(".//m:triangle", ns)
    ]
    if not triangles:
        raise ResliceError(f"В {path.name} нет треугольников.")
    return MeshPart(tuple(vertices), tuple(triangles), IDENTITY)


def mesh_from_model_file(path: Path) -> MeshPart:
    suffix = path.suffix.lower()
    if suffix == ".stl":
        return read_binary_stl(path)
    if suffix == ".3mf":
        return read_3mf_mesh(path)
    raise ResliceError(f"Неизвестный формат модели: {path.suffix}")


def find_orca_exe(explicit: str | Path | None = None) -> Path | None:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    env = os.environ.get("ORCA_SLICER") or os.environ.get("ORCA_EXE")
    if env:
        candidates.append(Path(env))
    image = _process_image()
    if image:
        candidates.append(image)
    python = Path(sys.executable).resolve()
    candidates.append(python)
    for folder in _search_dirs(candidates):
        for name in ("orca-slicer.exe", "orca-slicer"):
            path = folder / name
            if path.is_file():
                return path
    registry = _registry_exe()
    if registry and registry.is_file():
        return registry
    if FALLBACK_EXE.is_file():
        return FALLBACK_EXE
    return None


def _search_dirs(starts: list[Path]) -> list[Path]:
    seen: list[Path] = []
    for start in starts:
        current = start if start.is_dir() else start.parent
        for folder in [current, *current.parents]:
            if folder not in seen:
                seen.append(folder)
    return seen


def _process_image() -> Path | None:
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        buf = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(buf))
        if kernel.QueryFullProcessImageNameW(kernel.GetCurrentProcess(), 0, buf, ctypes.byref(size)):
            return Path(buf.value)
    except Exception:  # noqa: BLE001 - optional probe.
        return None
    return None


def _registry_exe() -> Path | None:
    if sys.platform != "win32":
        return None
    try:
        import winreg
    except ImportError:
        return None
    keys = (
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\orca-slicer.exe"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\orca-slicer.exe"),
    )
    for hive, path in keys:
        try:
            with winreg.OpenKey(hive, path) as key:
                value, _ = winreg.QueryValueEx(key, "")
        except OSError:
            continue
        candidate = Path(str(value))
        if candidate.is_file():
            return candidate
    return None


def kill_process_tree(pid: int) -> None:
    if sys.platform == "win32":
        import subprocess

        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
            check=False,
        )
        return
    try:
        os.kill(pid, 15)
    except OSError:
        pass


def config_hash(config: dict[str, str]) -> str:
    blob = json.dumps(config, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def write_preset(path: Path, preset: dict[str, Any]) -> None:
    path.write_text(json.dumps(preset, ensure_ascii=False, indent="\t"), encoding="utf-8")


class OrcaCliRunner:
    def __init__(self, exe: Path):
        self.exe = exe
        self._lock = threading.Lock()
        self._proc: Any = None

    def slice(
        self,
        model_path: Path,
        output_dir: Path,
        machine: dict[str, Any],
        process: dict[str, Any],
        filament: dict[str, Any],
        timeout_s: float,
        cancel: threading.Event,
    ) -> SliceOutcome:
        import subprocess

        output_dir.mkdir(parents=True, exist_ok=True)
        machine_path = output_dir / "machine.json"
        process_path = output_dir / "process.json"
        filament_path = output_dir / "filament.json"
        write_preset(machine_path, machine)
        write_preset(process_path, process)
        write_preset(filament_path, filament)
        args = [
            str(self.exe),
            "--slice",
            "0",
            "--arrange",
            "1",
            "--allow-newer-file",
            "--load-settings",
            str(machine_path),
            "--load-settings",
            str(process_path),
            "--load-filaments",
            str(filament_path),
            "--outputdir",
            str(output_dir),
            str(model_path),
        ]
        started = time.perf_counter()
        kwargs: dict[str, Any] = {
            "args": args,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "stdin": subprocess.DEVNULL,
            "cwd": str(output_dir),
        }
        if sys.platform == "win32":
            kwargs["creationflags"] = CREATE_NO_WINDOW
        proc = subprocess.Popen(**kwargs)
        with self._lock:
            self._proc = proc
        deadline = time.monotonic() + timeout_s
        killed = False
        try:
            while proc.poll() is None:
                if cancel.is_set() or time.monotonic() > deadline:
                    killed = True
                    if proc.pid:
                        kill_process_tree(proc.pid)
                    break
                time.sleep(0.2)
            stdout_b, stderr_b = proc.communicate(timeout=5)
        except Exception:  # noqa: BLE001 - still look for G-code.
            stdout_b, stderr_b = b"", b""
        finally:
            with self._lock:
                if self._proc is proc:
                    self._proc = None
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        gcode = _find_gcode(output_dir)
        if killed:
            reason = "отменено" if cancel.is_set() else "таймаут нарезки"
            return SliceOutcome(False, None, None, elapsed_ms, reason)
        if gcode is None:
            stderr = (stderr_b or b"").decode("utf-8", "replace")[:240]
            stdout = (stdout_b or b"").decode("utf-8", "replace")[:120]
            return SliceOutcome(
                False,
                None,
                None,
                elapsed_ms,
                f"Orca не выдала G-code (exit={proc.returncode}) {stderr or stdout}".strip(),
            )
        seconds = parse_estimate_seconds(gcode.read_text(encoding="utf-8", errors="replace"))
        if seconds is None:
            return SliceOutcome(False, None, gcode.name, elapsed_ms, "В G-code нет оценки normal mode")
        return SliceOutcome(True, seconds, gcode.name, elapsed_ms)

    def kill_current(self) -> None:
        with self._lock:
            proc = self._proc
        if proc is not None and proc.poll() is None and proc.pid:
            kill_process_tree(proc.pid)


def _find_gcode(folder: Path) -> Path | None:
    names = [path for path in folder.iterdir() if path.suffix.lower() == ".gcode"]
    if not names:
        return None
    preferred = [path for path in names if re.match(r"plate_\d+\.gcode$", path.name, re.I)]
    return (preferred or names)[0]


class FakeModel:
    def __init__(self, parts: tuple[MeshPart, ...]):
        self._parts = parts

    def objects(self):
        return [FakeObject(self._parts)]


class FakeObject:
    def __init__(self, parts: tuple[MeshPart, ...]):
        self._parts = parts

    def instances(self):
        return [FakeInstance()]

    def volumes(self):
        return [FakeVolume(part) for part in self._parts]


class FakeInstance:
    def offset(self):
        return (0.0, 0.0, 0.0)

    def rotation(self):
        return (0.0, 0.0, 0.0)

    def scaling_factor(self):
        return (1.0, 1.0, 1.0)

    def mirror(self):
        return (1.0, 1.0, 1.0)


class FakeVolume:
    def __init__(self, part: MeshPart):
        self._part = part

    def mesh(self):
        return FakeMesh(self._part.vertices, self._part.triangles)

    def offset(self):
        return (0.0, 0.0, 0.0)

    def rotation(self):
        return (0.0, 0.0, 0.0)

    def scaling_factor(self):
        return (1.0, 1.0, 1.0)

    def mirror(self):
        return (1.0, 1.0, 1.0)


class FakeMesh:
    def __init__(
        self,
        vertices: tuple[tuple[float, float, float], ...],
        triangles: tuple[tuple[int, int, int], ...],
    ):
        self._vertices = vertices
        self._triangles = triangles

    def vertex_count(self) -> int:
        return len(self._vertices)

    def triangle_count(self) -> int:
        return len(self._triangles)

    def facets_count(self) -> int:
        return len(self._triangles)

    def is_empty(self) -> bool:
        return not self._triangles

    def vertex(self, index: int) -> tuple[float, float, float]:
        return self._vertices[index]

    def triangle(self, index: int) -> tuple[int, int, int]:
        return self._triangles[index]


class FakeHost:
    def __init__(self, model: Any, bundle: Any = None):
        self._model = model
        self._bundle = bundle

    def model(self):
        return self._model

    def preset_bundle(self):
        if self._bundle is None:
            raise RuntimeError("preset_bundle unavailable")
        return self._bundle


class ResliceService:
    """One in-flight re-slice; a new request cancels the previous one."""

    def __init__(
        self,
        store: Any,
        host: Any | None = None,
        *,
        work_root: Path | None = None,
        exe: Path | None = None,
        runner: SlicerRunner | None = None,
        background: bool = True,
    ):
        self.store = store
        self.host = host
        self.work_root = work_root
        self._exe = exe
        self.runner = runner
        self.background = background
        self._lock = threading.Lock()
        self._generation = 0
        self._thread: threading.Thread | None = None
        self._cancel = threading.Event()
        self._baseline: dict[tuple[float, str], float] = {}

    def available(self) -> bool:
        if self.runner is None and self._find_exe() is None:
            return False
        if self.host is None:
            return False
        try:
            return self.host.model() is not None
        except Exception:  # noqa: BLE001 - GUI/model may not be ready.
            return False

    def _find_exe(self) -> Path | None:
        if self._exe and Path(self._exe).is_file():
            return Path(self._exe)
        found = find_orca_exe()
        if found:
            self._exe = found
        return found

    def _runner(self) -> SlicerRunner:
        if self.runner is not None:
            return self.runner
        exe = self._find_exe()
        if exe is None:
            raise ResliceError("Не найден orca-slicer.exe.")
        self.runner = OrcaCliRunner(exe)
        return self.runner

    def capture(self) -> Snapshot:
        latest = self.store.read_latest()
        if latest is None:
            raise ResliceError("Orca ещё не выдала G-code: нарежьте модель.")
        name, text = latest
        meta = self.store.latest() or {}
        config = parse_config_block(text)
        key_sets = None
        if self.host is not None:
            bundle_fn = getattr(self.host, "preset_bundle", None)
            if callable(bundle_fn):
                try:
                    key_sets = key_sets_from_bundle(bundle_fn())
                except Exception:  # noqa: BLE001 - baked key lists still work.
                    key_sets = None
        sections = split_config_sections(config, key_sets)
        if self.host is None:
            raise ResliceError("Нет доступа к модели Orca.")
        parts = snapshot_model(self.host.model())
        if not parts:
            raise ResliceError("На столе нет модели.")
        return Snapshot(
            gcode_name=name,
            gcode_mtime=float(meta.get("modified") or 0.0),
            config=config,
            sections=sections,
            parts=parts,
            config_hash=config_hash(config),
        )

    def submit(self, request: int, changes: Any, post: Callable[[Any], None]) -> None:
        try:
            snapshot = self.capture()
        except Exception as exc:  # noqa: BLE001 - report instead of crashing the tab.
            post(_error(request, exc))
            return
        parsed = parse_changes(changes)
        with self._lock:
            self._generation += 1
            generation = self._generation
            self._cancel.set()
            runner = self.runner
            self._cancel = threading.Event()
            cancel = self._cancel
        if isinstance(runner, OrcaCliRunner):
            runner.kill_current()
        if self.background:
            thread = threading.Thread(
                target=self._run,
                args=(request, parsed, snapshot, post, generation, cancel),
                daemon=True,
                name="b3d-reslice",
            )
            with self._lock:
                self._thread = thread
            thread.start()
            return
        self._run(request, parsed, snapshot, post, generation, cancel)

    def wait(self, timeout: float | None = None) -> None:
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    def _run(
        self,
        request: int,
        changes: ResliceChanges,
        snapshot: Snapshot,
        post: Callable[[Any], None],
        generation: int,
        cancel: threading.Event,
    ) -> None:
        started = time.perf_counter()
        work: Path | None = None
        try:
            if cancel.is_set() or not self._is_current(generation):
                post(_error(request, ResliceError("заменён новым запросом")))
                return
            root = self.work_root or Path(self.store.folder) / "reslice-work"
            work = root / f"job-{request}-{generation}"
            if work.exists():
                shutil.rmtree(work, ignore_errors=True)
            work.mkdir(parents=True, exist_ok=True)
            model_path = work / "model.stl"
            write_binary_stl(model_path, snapshot.parts)
            runner = self._runner()
            baseline = self._baseline_seconds(
                runner, model_path, snapshot, work / "baseline", cancel, generation
            )
            if cancel.is_set() or not self._is_current(generation):
                post(_error(request, ResliceError("заменён новым запросом")))
                return
            if _changes_empty(changes):
                post(
                    {
                        "type": f"{PROTOCOL}.reslice-result",
                        "request": request,
                        "ok": True,
                        "seconds": baseline,
                        "baselineSeconds": baseline,
                        "elapsedMs": int((time.perf_counter() - started) * 1000),
                    }
                )
                return
            changed = apply_changes(snapshot.sections, changes)
            variant = runner.slice(
                model_path,
                work / "variant",
                changed["machine"],
                changed["process"],
                changed["filament"],
                SLICE_TIMEOUT_S,
                cancel,
            )
            if cancel.is_set() or not self._is_current(generation):
                post(_error(request, ResliceError("заменён новым запросом")))
                return
            if not variant.ok or variant.seconds is None:
                post(
                    {
                        "type": f"{PROTOCOL}.reslice-result",
                        "request": request,
                        "ok": False,
                        "message": variant.message or "нарезка не удалась",
                        "elapsedMs": int((time.perf_counter() - started) * 1000),
                    }
                )
                return
            post(
                {
                    "type": f"{PROTOCOL}.reslice-result",
                    "request": request,
                    "ok": True,
                    "seconds": variant.seconds,
                    "baselineSeconds": baseline,
                    "elapsedMs": int((time.perf_counter() - started) * 1000),
                    "gcodeName": variant.gcode_name,
                }
            )
        except Exception as exc:  # noqa: BLE001 - the page shows the message.
            post(_error(request, exc))
        finally:
            if work is not None:
                shutil.rmtree(work, ignore_errors=True)

    def _is_current(self, generation: int) -> bool:
        with self._lock:
            return generation == self._generation

    def _baseline_seconds(
        self,
        runner: SlicerRunner,
        model_path: Path,
        snapshot: Snapshot,
        output_dir: Path,
        cancel: threading.Event,
        generation: int,
    ) -> float:
        key = (snapshot.gcode_mtime, snapshot.config_hash)
        cached = self._baseline.get(key)
        if cached is not None:
            return cached
        result = runner.slice(
            model_path,
            output_dir,
            snapshot.sections["machine"],
            snapshot.sections["process"],
            snapshot.sections["filament"],
            SLICE_TIMEOUT_S,
            cancel,
        )
        if cancel.is_set() or not self._is_current(generation):
            raise ResliceError("заменён новым запросом")
        if not result.ok or result.seconds is None:
            raise ResliceError(result.message or "не удалось нарезать baseline")
        self._baseline[key] = result.seconds
        return result.seconds


def _changes_empty(changes: ResliceChanges) -> bool:
    return (
        changes.acceleration_scale is None
        and changes.print_speed_scale is None
        and changes.max_volumetric_flow is None
        and changes.minimum_layer_time is None
        and not changes.raise_machine_acceleration
        and not changes.raise_machine_speed
    )


def _error(request: int, exc: BaseException) -> dict[str, Any]:
    message = str(exc) if isinstance(exc, ResliceError) else f"{type(exc).__name__}: {exc}"
    return {"type": f"{PROTOCOL}.error", "request": request, "message": message}