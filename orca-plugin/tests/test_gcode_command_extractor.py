from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.gcode_command_extractor import extract_gcode_command_snapshot


class GcodeCommandExtractorTest(unittest.TestCase):
    def test_extracts_target_commands_and_last_values(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            gcode_path = Path(temp_dir) / "commands.gcode"
            gcode_path.write_text(
                "\n".join(
                    [
                        "G21",
                        "M204 P5000 T9000 ; active accel",
                        "G1 X10 F1200",
                        "M221 S95",
                        "M106 S180",
                        "M107",
                    ],
                ),
                encoding="utf-8",
            )

            snapshot = extract_gcode_command_snapshot(gcode_path)

            self.assertEqual(snapshot["observedCommandCount"], 4)
            self.assertEqual(snapshot["commands"]["M204"][0]["parameters"]["P"], 5000)
            self.assertEqual(snapshot["lastByCommand"]["M221"]["parameters"]["S"], 95)
            self.assertEqual(snapshot["lastByCommand"]["M107"]["parameters"], {})

    def test_ignores_non_target_commands(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            gcode_path = Path(temp_dir) / "commands.gcode"
            gcode_path.write_text("G1 X10 F1200\nM104 S210\n", encoding="utf-8")

            snapshot = extract_gcode_command_snapshot(gcode_path)

            self.assertEqual(snapshot["observedCommandCount"], 0)
            self.assertEqual(snapshot["commands"], {})


if __name__ == "__main__":
    unittest.main()
