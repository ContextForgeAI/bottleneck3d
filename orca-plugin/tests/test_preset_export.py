from __future__ import annotations

import enum
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.preset_export import (
    EXPORT_FILE,
    EXPORT_FORMAT,
    config_text,
    write_preset_export,
)


class Flavor(enum.Enum):
    klipper = 5


class FakePreset:
    def __init__(self, name, config, system=False, visible=True, default=False):
        self.name = name
        self.is_system = system
        self.is_visible = visible
        self.is_default = default
        self._config = config

    def config_keys(self):
        return list(self._config)

    def config_value(self, key):
        return self._config.get(key)


class FakeCollection:
    def __init__(self, presets):
        self._presets = presets

    def size(self):
        return len(self._presets)

    def preset(self, index):
        return self._presets[index]


class FakeBundle:
    def __init__(self):
        self.printers = FakeCollection([
            FakePreset("- default FFF -", {}, default=True),
            FakePreset("Voron 2.4 300 0.4 nozzle", {
                "machine_max_acceleration_x": [20000.0, 20000.0],
                "gcode_flavor": Flavor.klipper,
            }, system=True),
        ])
        self.filaments = FakeCollection([
            FakePreset("Voron PLA Star Plast", {
                "filament_max_volumetric_speed": [23.0],
                "enable_pressure_advance": [False],
            }),
            FakePreset("Hidden", {}, visible=False),
        ])
        self.prints = FakeCollection([])


class PresetExportTest(unittest.TestCase):
    def test_config_text_matches_orca_json_style(self):
        self.assertEqual(config_text([6000.0, 6000.0]), ["6000", "6000"])
        self.assertEqual(config_text(0.035), "0.035")
        self.assertEqual(config_text(True), "1")
        self.assertEqual(config_text(Flavor.klipper), "klipper")
        self.assertEqual(config_text(3), "3")

    def test_export_writes_visible_presets_with_kinds(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = write_preset_export(FakeBundle(), Path(temp_dir), "2.5.0-alpha")
            data = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(path.name, EXPORT_FILE)
        self.assertEqual(data["format"], EXPORT_FORMAT)
        by_name = {preset["name"]: preset for preset in data["presets"]}
        self.assertEqual(sorted(by_name), ["Voron 2.4 300 0.4 nozzle", "Voron PLA Star Plast"])
        machine = by_name["Voron 2.4 300 0.4 nozzle"]
        self.assertEqual(machine["type"], "machine")
        self.assertEqual(machine["from"], "system")
        self.assertEqual(machine["machine_max_acceleration_x"], ["20000", "20000"])
        self.assertEqual(machine["gcode_flavor"], "klipper")
        filament = by_name["Voron PLA Star Plast"]
        self.assertEqual(filament["filament_max_volumetric_speed"], ["23"])
        self.assertEqual(filament["enable_pressure_advance"], ["0"])


if __name__ == "__main__":
    unittest.main()
