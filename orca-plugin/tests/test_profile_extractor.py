from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.profile_extractor import extract_profile_snapshot


class FakeContext:
    def __init__(self, values):
        self.values = values

    def config_value(self, key):
        if key == "raises":
            raise RuntimeError("boom")
        return self.values.get(key)


class ProfileExtractorTest(unittest.TestCase):
    def test_extracts_known_orca_values(self):
        snapshot = extract_profile_snapshot(
            FakeContext(
                {
                    "filament_max_volumetric_speed": 12.5,
                    "machine_max_acceleration_x": [5000.0],
                    "nozzle_diameter": [0.4],
                },
            ),
        )

        fields = snapshot["fields"]
        self.assertEqual(snapshot["source"], "orca.ctx.config_value")
        self.assertEqual(fields["filament_max_volumetric_speed"]["value"], 12.5)
        self.assertEqual(
            fields["filament_max_volumetric_speed"]["confidence"],
            "medium",
        )
        self.assertIn(
            "not proven hotend capability",
            fields["filament_max_volumetric_speed"]["notes"][0],
        )
        self.assertEqual(fields["machine_max_acceleration_x"]["value"], [5000.0])

    def test_zero_acceleration_is_unknown_firmware_default(self):
        snapshot = extract_profile_snapshot(
            FakeContext({"default_acceleration": 0}),
        )

        field = snapshot["fields"]["default_acceleration"]
        self.assertEqual(field["value"], 0)
        self.assertEqual(field["confidence"], "unknown")
        self.assertIn("firmware default", field["notes"][0])

    def test_missing_value_is_unknown(self):
        snapshot = extract_profile_snapshot(FakeContext({}))

        field = snapshot["fields"]["travel_acceleration"]
        self.assertIsNone(field["value"])
        self.assertEqual(field["source"], "unknown")
        self.assertEqual(field["confidence"], "unknown")


if __name__ == "__main__":
    unittest.main()
