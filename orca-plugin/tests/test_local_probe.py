from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.local_probe import main
from bottleneck3d_orca.report_writer import REPORT_NAME


class LocalProbeTest(unittest.TestCase):
    def test_cli_generates_report_from_fake_values(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            gcode_path = root / "fixture.gcode"
            values_path = root / "values.json"
            gcode_path.write_text("G1 X10 F1200\n", encoding="utf-8")
            values_path.write_text(
                json.dumps(
                    {
                        "filament_max_volumetric_speed": 13.5,
                        "travel_acceleration": 9000,
                    },
                ),
                encoding="utf-8",
            )

            exit_code = main(
                [
                    "--gcode",
                    str(gcode_path),
                    "--values",
                    str(values_path),
                ],
            )

            self.assertEqual(exit_code, 0)
            report_path = root / REPORT_NAME
            report = json.loads(report_path.read_text(encoding="utf-8"))
            fields = report["profile"]["fields"]
            self.assertEqual(fields["filament_max_volumetric_speed"]["value"], 13.5)
            self.assertEqual(fields["travel_acceleration"]["value"], 9000)


if __name__ == "__main__":
    unittest.main()
