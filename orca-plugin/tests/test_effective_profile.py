from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.effective_profile import build_effective_profile


class EffectiveProfileTest(unittest.TestCase):
    def test_gcode_command_overrides_conflicting_profile_value(self):
        profile_snapshot = {
            "fields": {
                "travel_acceleration": {
                    "value": 9000,
                    "source": "orca_resolved_profile",
                    "confidence": "high",
                    "notes": [],
                },
            },
        }
        command_snapshot = {
            "lastByCommand": {
                "M204": {
                    "command": "M204",
                    "lineNumber": 10,
                    "parameters": {"T": 7000.0},
                    "raw": "M204 T7000",
                },
            },
        }

        effective = build_effective_profile(profile_snapshot, command_snapshot)

        field = effective["fields"]["effective_travel_acceleration"]
        self.assertEqual(field["value"], 7000.0)
        self.assertEqual(field["source"], "gcode_command")
        self.assertEqual(field["profileValue"], 9000)
        self.assertEqual(len(effective["conflicts"]), 1)
        self.assertEqual(
            effective["conflicts"][0]["resolution"],
            "gcode_command_wins",
        )

    def test_gcode_only_values_are_effective_without_conflict(self):
        effective = build_effective_profile(
            {"fields": {}},
            {
                "lastByCommand": {
                    "M221": {
                        "command": "M221",
                        "lineNumber": 4,
                        "parameters": {"S": 95.0},
                        "raw": "M221 S95",
                    },
                    "M107": {
                        "command": "M107",
                        "lineNumber": 20,
                        "parameters": {},
                        "raw": "M107",
                    },
                },
            },
        )

        self.assertEqual(effective["fields"]["flow_factor_percent"]["value"], 95.0)
        self.assertEqual(effective["fields"]["last_fan_pwm"]["value"], 0.0)
        self.assertEqual(effective["conflicts"], [])

    def test_unknown_profile_value_does_not_create_conflict(self):
        effective = build_effective_profile(
            {
                "fields": {
                    "default_acceleration": {
                        "value": 0,
                        "source": "orca_resolved_profile",
                        "confidence": "unknown",
                        "notes": ["Zero acceleration may mean firmware default."],
                    },
                },
            },
            {
                "lastByCommand": {
                    "M204": {
                        "command": "M204",
                        "lineNumber": 10,
                        "parameters": {"P": 5000.0},
                        "raw": "M204 P5000",
                    },
                },
            },
        )

        self.assertEqual(effective["fields"]["effective_print_acceleration"]["value"], 5000.0)
        self.assertEqual(effective["conflicts"], [])


if __name__ == "__main__":
    unittest.main()
