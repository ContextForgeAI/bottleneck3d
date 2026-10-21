from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.role_impact import build_role_impact


class RoleImpactTest(unittest.TestCase):
    def test_ranks_roles_and_assigns_upgrade_levers(self):
        impact = build_role_impact(
            {
                "totals": {"nominalSeconds": 100.0},
                "roleSummary": {
                    "travel": {
                        "nominalSeconds": 20.0,
                        "distanceMm": 500.0,
                        "travelMoveCount": 10,
                    },
                    "outer_wall": {
                        "nominalSeconds": 70.0,
                        "distanceMm": 700.0,
                        "extrusionSeconds": 70.0,
                        "extrusionMoveCount": 12,
                    },
                    "unknown": {
                        "nominalSeconds": 10.0,
                        "distanceMm": 100.0,
                        "extrusionSeconds": 10.0,
                        "extrusionMoveCount": 2,
                    },
                },
            },
        )

        self.assertEqual(impact["topRole"], "outer_wall")
        self.assertEqual(impact["roles"][0]["percent"], 70.0)
        self.assertIn("quality_limited", impact["roles"][0]["upgradeLevers"])
        self.assertEqual(impact["roles"][1]["role"], "travel")
        self.assertEqual(impact["roles"][1]["upgradeLevers"], ["motion"])
        self.assertEqual(impact["roles"][2]["upgradeLevers"], ["needs_role_data"])


if __name__ == "__main__":
    unittest.main()
