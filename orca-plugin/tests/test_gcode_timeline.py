from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.gcode_timeline import build_gcode_timeline


class GcodeTimelineTest(unittest.TestCase):
    def test_aggregates_moves_by_active_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            gcode_path = Path(temp_dir) / "timeline.gcode"
            gcode_path.write_text(
                "\n".join(
                    [
                        "G90",
                        "M83",
                        "M204 P5000 T9000",
                        "M220 S100",
                        "; FEATURE: Outer wall",
                        "G1 X10 E1 F6000",
                        "M221 S95",
                        "G1 X20 E1 F6000",
                        "M107",
                        "G1 X30 F6000",
                    ],
                ),
                encoding="utf-8",
            )

            timeline = build_gcode_timeline(gcode_path)

            self.assertEqual(timeline["moveCount"], 3)
            self.assertEqual(timeline["extrusionMoveCount"], 2)
            self.assertEqual(timeline["stateChangeCount"], 4)
            self.assertEqual(len(timeline["groups"]), 3)
            self.assertEqual(timeline["roleChangeCount"], 1)
            self.assertEqual(
                timeline["groups"][0]["state"]["printAcceleration"],
                5000,
            )
            self.assertEqual(timeline["groups"][0]["state"]["role"], "outer_wall")
            self.assertEqual(timeline["groups"][1]["state"]["flowFactorPercent"], 95)
            self.assertAlmostEqual(
                timeline["groups"][1]["flowAdjustedExtrusionMm"],
                0.95,
            )
            self.assertEqual(timeline["groups"][2]["state"]["fanPwm"], 0.0)
            self.assertEqual(timeline["groups"][2]["state"]["role"], "travel")
            self.assertEqual(timeline["roleSummary"]["outer_wall"]["extrusionMoveCount"], 2)
            self.assertEqual(timeline["roleSummary"]["travel"]["travelMoveCount"], 1)
            self.assertAlmostEqual(
                timeline["totals"]["nominalSeconds"],
                sum(group["nominalSeconds"] for group in timeline["groups"]),
            )

    def test_speed_factor_changes_nominal_seconds(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            gcode_path = Path(temp_dir) / "timeline.gcode"
            gcode_path.write_text(
                "\n".join(
                    [
                        "G90",
                        "M83",
                        "M220 S50",
                        "G1 X60 F3600",
                    ],
                ),
                encoding="utf-8",
            )

            timeline = build_gcode_timeline(gcode_path)

            self.assertAlmostEqual(timeline["groups"][0]["nominalSeconds"], 2.0)
            self.assertAlmostEqual(timeline["groups"][0]["unscaledSeconds"], 1.0)
            self.assertAlmostEqual(timeline["groups"][0]["speedFactorDeltaSeconds"], 1.0)


if __name__ == "__main__":
    unittest.main()
