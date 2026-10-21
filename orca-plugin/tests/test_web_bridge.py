from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca import web_bridge
from bottleneck3d_orca.web_bridge import GcodeStore, PageBridge


def collect(messages):
    return lambda message: messages.append(json.loads(json.dumps(message)))


def assemble(messages, request):
    begin = next(m for m in messages if m["type"] == "b3d.begin" and m["request"] == request)
    chunks = [m for m in messages if m["type"] == "b3d.chunk" and m["request"] == request]
    assert any(m["type"] == "b3d.end" and m["request"] == request for m in messages)
    assert len(chunks) == begin["chunks"]
    return begin, "".join(m["data"] for m in sorted(chunks, key=lambda m: m["index"]))


class WebBridgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = GcodeStore(self.root / "storage")

    def tearDown(self):
        self.tmp.cleanup()

    def test_status_without_gcode(self):
        messages = []
        PageBridge(self.store, None, "0.3.0").handle({"type": "b3d.hello"}, collect(messages))
        self.assertEqual(messages[0]["type"], "b3d.status")
        self.assertIsNone(messages[0]["gcode"])
        self.assertFalse(messages[0]["presets"])

    def test_exported_gcode_streams_in_chunks(self):
        gcode = self.root / "Cube_PLA.gcode"
        text = "G1 X1 Y2 E0.1\n" * 40000
        gcode.write_text(text, encoding="utf-8")
        self.store.remember_export(str(gcode))
        self.store.remember_export(str(self.root / "plate.3mf"))

        messages = []
        bridge = PageBridge(self.store, None, "0.3.0")
        bridge.handle(json.dumps({"type": "b3d.hello"}), collect(messages))
        self.assertEqual(messages[0]["gcode"]["name"], "Cube_PLA.gcode")

        bridge.handle({"type": "b3d.get-gcode", "request": 7}, collect(messages))
        begin, received = assemble(messages, 7)
        self.assertEqual(begin["kind"], "gcode")
        self.assertGreater(begin["chunks"], 1)
        self.assertEqual(received, text)

    def test_pipeline_copy_keeps_output_name(self):
        working = self.root / "tmp123.gcode"
        working.write_text("G28\n", encoding="utf-8")
        self.store.remember_copy(str(working), "Benchy_PETG.gcode")
        working.unlink()
        self.assertEqual(self.store.latest()["name"], "Benchy_PETG.gcode")
        self.assertEqual(self.store.read_latest(), ("Benchy_PETG.gcode", "G28\n"))

    def test_presets_and_errors(self):
        messages = []
        bridge = PageBridge(self.store, lambda: {"format": "x", "presets": []}, "0.3.0")
        bridge.handle({"type": "b3d.get-presets", "request": 2}, collect(messages))
        _, received = assemble(messages, 2)
        self.assertEqual(json.loads(received)["format"], "x")

        bridge.handle({"type": "b3d.get-gcode", "request": 3}, collect(messages))
        self.assertEqual(messages[-1]["type"], "b3d.error")

    def test_page_html_fallback_mentions_build(self):
        html = web_bridge.load_page_html()
        self.assertIn("Bottleneck3D", html)


if __name__ == "__main__":
    unittest.main()
