from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.fake_context import load_fake_context
from bottleneck3d_orca.plugin import run_profile_probe


ROOT = Path(__file__).resolve().parents[1]


class GoldenFixtureReportTest(unittest.TestCase):
    def test_sample_fixture_report_shape(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            workdir = Path(temp_dir)
            gcode_path = workdir / "sample.gcode"
            values_path = workdir / "fake_orca_values.json"
            gcode_path.write_text(
                (ROOT / "fixtures" / "sample.gcode").read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            values_path.write_text(
                (ROOT / "fixtures" / "fake_orca_values.json").read_text(
                    encoding="utf-8",
                ),
                encoding="utf-8",
            )

            report_path = run_profile_probe(load_fake_context(gcode_path, values_path))
            report = json.loads(report_path.read_text(encoding="utf-8"))

            self.assertEqual(report["schemaVersion"], 1)
            self.assertEqual(report["gcodeCommands"]["lastByCommand"]["M204"]["lineNumber"], 7)
            self.assertEqual(
                report["effectiveProfile"]["fields"]["effective_print_acceleration"][
                    "value"
                ],
                5000,
            )
            self.assertEqual(report["gcodeTimeline"]["roleSummary"]["outer_wall"]["extrusionMoveCount"], 4)
            self.assertEqual(report["roleImpact"]["topRole"], "outer_wall")
            self.assertEqual(report["timeWaterfall"]["items"][0]["key"], "emitted_feed_motion")

    def test_report_schema_file_is_valid_json(self):
        schema = json.loads(
            (ROOT.parent / "contracts" / "bottleneck3d-report.schema.json").read_text(
                encoding="utf-8",
            ),
        )

        self.assertEqual(schema["title"], "Bottleneck3D Report")
        self.assertEqual(schema["properties"]["schemaVersion"]["const"], 1)


if __name__ == "__main__":
    unittest.main()
