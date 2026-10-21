from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.time_waterfall import build_time_waterfall


class TimeWaterfallTest(unittest.TestCase):
    def test_builds_emitted_gcode_motion_waterfall(self):
        waterfall = build_time_waterfall(
            {
                "totals": {
                    "unscaledSeconds": 10.0,
                    "speedFactorDeltaSeconds": 5.0,
                    "nominalSeconds": 15.0,
                    "extrusionSeconds": 12.0,
                    "travelSeconds": 3.0,
                },
            },
        )

        self.assertEqual(waterfall["mode"], "emitted_gcode_audit")
        self.assertEqual(waterfall["confidence"], "low")
        self.assertEqual(waterfall["items"][0]["seconds"], 10.0)
        self.assertEqual(waterfall["items"][1]["seconds"], 5.0)
        self.assertEqual(waterfall["totals"]["motionSeconds"], 15.0)
        self.assertEqual(len(waterfall["unavailable"]), 3)


if __name__ == "__main__":
    unittest.main()
