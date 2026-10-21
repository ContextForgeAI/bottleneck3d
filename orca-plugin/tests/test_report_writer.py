from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.plugin import run_profile_probe
from bottleneck3d_orca.report_writer import REPORT_NAME, write_report


class FakeContext:
    def __init__(self, gcode_path: Path, values):
        self.gcode_path = str(gcode_path)
        self.values = values

    def config_value(self, key):
        return self.values.get(key)


class ReportWriterTest(unittest.TestCase):
    def test_writes_local_report_next_to_gcode(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            gcode_path = Path(temp_dir) / "part.gcode"
            gcode_path.write_text("G1 X10 F1200\n", encoding="utf-8")

            report_path = write_report(
                gcode_path,
                {"schemaVersion": 1, "fields": {}},
            )

            self.assertEqual(report_path, Path(temp_dir) / REPORT_NAME)
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["gcode"]["fileName"], "part.gcode")
            self.assertEqual(report["gcode"]["sizeBytes"], gcode_path.stat().st_size)
            self.assertIsNone(report["gcodeCommands"])
            self.assertIsNone(report["effectiveProfile"])
            self.assertIsNone(report["gcodeTimeline"])
            self.assertIsNone(report["timeWaterfall"])
            self.assertIsNone(report["roleImpact"])
            self.assertNotIn(str(temp_dir), json.dumps(report))

    def test_profile_probe_uses_context_gcode_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            gcode_path = Path(temp_dir) / "part.gcode"
            gcode_path.write_text("M204 P5000 T9000\nG1 X10 F1200\n", encoding="utf-8")
            ctx = FakeContext(
                gcode_path,
                {"filament_max_volumetric_speed": 14.0},
            )

            report_path = run_profile_probe(ctx)

            report = json.loads(report_path.read_text(encoding="utf-8"))
            field = report["profile"]["fields"]["filament_max_volumetric_speed"]
            self.assertEqual(field["value"], 14.0)
            self.assertEqual(field["confidence"], "medium")
            self.assertEqual(
                report["gcodeCommands"]["lastByCommand"]["M204"]["parameters"]["P"],
                5000,
            )
            self.assertEqual(
                report["effectiveProfile"]["fields"]["effective_print_acceleration"][
                    "value"
                ],
                5000,
            )
            self.assertEqual(report["gcodeTimeline"]["moveCount"], 1)
            self.assertEqual(report["timeWaterfall"]["mode"], "emitted_gcode_audit")
            self.assertEqual(report["roleImpact"]["mode"], "upgrade_relevance")


if __name__ == "__main__":
    unittest.main()
