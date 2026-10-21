from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.line_roles import extract_line_role, normalize_role


class LineRolesTest(unittest.TestCase):
    def test_normalizes_common_slicer_roles(self):
        self.assertEqual(normalize_role("Outer wall"), "outer_wall")
        self.assertEqual(normalize_role("External perimeter"), "outer_wall")
        self.assertEqual(normalize_role("Internal infill"), "infill")
        self.assertEqual(normalize_role("Top surface"), "top_surface")
        self.assertEqual(normalize_role("Bridge infill"), "bridge")
        self.assertEqual(normalize_role("Support material"), "support")

    def test_extracts_type_and_feature_comments(self):
        self.assertEqual(
            extract_line_role(";TYPE:External perimeter")["role"],
            "outer_wall",
        )
        self.assertEqual(
            extract_line_role("; FEATURE: Sparse infill")["role"],
            "infill",
        )
        self.assertIsNone(extract_line_role("G1 X10 F1200"))


if __name__ == "__main__":
    unittest.main()
