from __future__ import annotations

import struct
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.reslice import (
    FakeHost,
    FakeMesh,
    FakeModel,
    MeshPart,
    ResliceService,
    SliceOutcome,
    apply_changes,
    first_number,
    parse_config_block,
    parse_duration,
    parse_estimate_seconds,
    snapshot_model,
    split_config_sections,
    write_binary_stl,
)
from bottleneck3d_orca.web_bridge import GcodeStore, PageBridge

SAMPLE_GCODE = """G1 X1 E0.1
; estimated printing time (normal mode) = 13m 35s
; CONFIG_BLOCK_START
; default_acceleration = 5000
; outer_wall_acceleration = 5000
; inner_wall_acceleration = 5000
; top_surface_acceleration = 3000
; travel_acceleration = 6000
; sparse_infill_acceleration = 100%
; outer_wall_speed = 100
; inner_wall_speed = 150
; sparse_infill_speed = 180
; internal_solid_infill_speed = 150
; top_surface_speed = 80
; travel_speed = 300
; initial_layer_speed = 20
; filament_max_volumetric_speed = 23
; slow_down_layer_time = 6
; default_filament_colour = ""
; machine_max_acceleration_x = 6000,6000
; machine_max_acceleration_y = 6000,6000
; machine_max_acceleration_extruding = 6000,6000
; machine_max_speed_x = 300,300
; machine_max_speed_y = 300,300
; layer_height = 0.2
; nozzle_diameter = 0.4
; curr_bed_type = Textured PEI Plate
; wipe_tower_x = 5
; bed_shape = 0x0,300x0,300x300,0x300
; CONFIG_BLOCK_END
"""

TETRA = MeshPart(
    vertices=(
        (0.0, 0.0, 0.0),
        (10.0, 0.0, 0.0),
        (0.0, 10.0, 0.0),
        (0.0, 0.0, 10.0),
    ),
    triangles=((0, 1, 2), (0, 3, 1), (0, 2, 3), (1, 3, 2)),
    matrix=(
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 1.0, 0.0, 0.0),
        (0.0, 0.0, 1.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ),
)


class RecordingRunner:
    def __init__(self, seconds=(815.0, 869.0)):
        self.seconds = list(seconds)
        self.calls = []

    def slice(self, model_path, output_dir, machine, process, filament, timeout_s, cancel):
        self.calls.append(
            {
                "model": Path(model_path),
                "model_exists": Path(model_path).is_file(),
                "out": Path(output_dir),
                "machine": dict(machine),
                "process": dict(process),
                "filament": dict(filament),
            }
        )
        if cancel.is_set():
            return SliceOutcome(False, None, None, 1, "отменено")
        output_dir.mkdir(parents=True, exist_ok=True)
        value = self.seconds[min(len(self.calls) - 1, len(self.seconds) - 1)]
        gcode = output_dir / "plate_1.gcode"
        gcode.write_text(
            f"; estimated printing time (normal mode) = {int(value)}s\n",
            encoding="utf-8",
        )
        return SliceOutcome(True, float(value), gcode.name, 11)


class ConfigAndChangesTest(unittest.TestCase):
    def test_parse_config_block_and_duration(self):
        config = parse_config_block(SAMPLE_GCODE)
        self.assertEqual(config["default_acceleration"], "5000")
        self.assertEqual(config["filament_max_volumetric_speed"], "23")
        self.assertEqual(config["default_filament_colour"], '""')
        self.assertEqual(parse_duration("13m 35s"), 815)
        self.assertEqual(parse_estimate_seconds(SAMPLE_GCODE), 815)

    def test_split_puts_keys_in_machine_process_filament(self):
        sections = split_config_sections(parse_config_block(SAMPLE_GCODE))
        self.assertEqual(sections["process"]["type"], "process")
        self.assertEqual(sections["process"]["compatible_printers"], [])
        self.assertEqual(sections["filament"]["filament_settings_id"], ["B3D Reslice Filament"])
        self.assertEqual(sections["machine"]["machine_max_acceleration_x"], "6000,6000")
        self.assertEqual(sections["process"]["outer_wall_speed"], "100")
        self.assertEqual(sections["filament"]["slow_down_layer_time"], "6")
        self.assertNotIn("outer_wall_speed", sections["machine"])
        self.assertNotIn("curr_bed_type", sections["process"])
        self.assertNotIn("wipe_tower_x", sections["process"])

    def test_apply_accel_half_does_not_raise_machine(self):
        sections = split_config_sections(parse_config_block(SAMPLE_GCODE))
        changed = apply_changes(sections, {"accelerationScale": 0.5})
        self.assertEqual(changed["process"]["default_acceleration"], "2500")
        self.assertEqual(changed["process"]["top_surface_acceleration"], "1500")
        self.assertEqual(changed["process"]["travel_acceleration"], "6000")
        self.assertEqual(changed["process"]["sparse_infill_acceleration"], "100%")
        self.assertEqual(changed["machine"]["machine_max_acceleration_x"], "6000,6000")

    def test_apply_speed_flow_cooling_and_raised_accel(self):
        sections = split_config_sections(parse_config_block(SAMPLE_GCODE))
        changed = apply_changes(
            sections,
            {
                "printSpeedScale": 1.5,
                "maxVolumetricFlow": 15,
                "minimumLayerTime": 0,
                "accelerationScale": 2,
                "raiseMachineAcceleration": True,
            },
        )
        self.assertEqual(changed["process"]["outer_wall_speed"], "150")
        self.assertEqual(changed["process"]["travel_speed"], "300")
        self.assertEqual(changed["process"]["initial_layer_speed"], "20")
        self.assertEqual(changed["filament"]["filament_max_volumetric_speed"], "15")
        self.assertEqual(changed["filament"]["slow_down_layer_time"], "0")
        self.assertEqual(changed["process"]["default_acceleration"], "10000")
        self.assertEqual(first_number(changed["machine"]["machine_max_acceleration_x"]), 12000)

    def test_apply_raises_machine_when_process_exceeds_limit(self):
        sections = split_config_sections(parse_config_block(SAMPLE_GCODE))
        changed = apply_changes(sections, {"accelerationScale": 2})
        self.assertEqual(first_number(changed["machine"]["machine_max_acceleration_x"]), 10000)
        self.assertEqual(first_number(changed["machine"]["machine_max_acceleration_y"]), 10000)


class StlExportTest(unittest.TestCase):
    def test_write_binary_stl_from_fake_mesh(self):
        class Volume:
            def mesh(self):
                return FakeMesh(TETRA.vertices, TETRA.triangles)

            def offset(self):
                return (1.0, 2.0, 3.0)

            def rotation(self):
                return (0.0, 0.0, 0.0)

            def scaling_factor(self):
                return (1.0, 1.0, 1.0)

            def mirror(self):
                return (1.0, 1.0, 1.0)

        class Instance:
            def offset(self):
                return (5.0, 0.0, 0.0)

            def rotation(self):
                return (0.0, 0.0, 0.0)

            def scaling_factor(self):
                return (1.0, 1.0, 1.0)

            def mirror(self):
                return (1.0, 1.0, 1.0)

        class Obj:
            def volumes(self):
                return [Volume()]

            def instances(self):
                return [Instance()]

        class Model:
            def objects(self):
                return [Obj()]

        parts = snapshot_model(Model())
        self.assertEqual(len(parts), 1)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "part.stl"
            count = write_binary_stl(path, parts)
            data = path.read_bytes()
        self.assertEqual(count, 4)
        self.assertEqual(struct.unpack_from("<I", data, 80)[0], 4)
        first = struct.unpack_from("<12fH", data, 84)
        self.assertAlmostEqual(first[3], 6.0)  # 0 + instance 5 + volume 1
        self.assertAlmostEqual(first[4], 2.0)
        self.assertAlmostEqual(first[5], 3.0)


class BridgeResliceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = GcodeStore(self.root / "storage")
        gcode = self.root / "cube.gcode"
        gcode.write_text(SAMPLE_GCODE, encoding="utf-8")
        self.store.remember_export(str(gcode))
        self.runner = RecordingRunner()
        self.service = ResliceService(
            self.store,
            FakeHost(FakeModel((TETRA,))),
            work_root=self.root / "work",
            runner=self.runner,
            background=False,
        )
        self.bridge = PageBridge(self.store, None, "0.3.0", reslice=self.service)

    def tearDown(self):
        self.tmp.cleanup()

    def test_status_advertises_reslice(self):
        messages = []
        self.bridge.handle({"type": "b3d.hello"}, messages.append)
        self.assertTrue(messages[0]["reslice"])

    def test_reslice_returns_baseline_and_variant(self):
        messages = []
        self.bridge.handle(
            {"type": "b3d.reslice", "request": 9, "changes": {"accelerationScale": 0.5}},
            messages.append,
        )
        result = messages[-1]
        self.assertEqual(result["type"], "b3d.reslice-result")
        self.assertTrue(result["ok"])
        self.assertEqual(result["request"], 9)
        self.assertEqual(result["baselineSeconds"], 815)
        self.assertEqual(result["seconds"], 869)
        self.assertEqual(result["gcodeName"], "plate_1.gcode")
        self.assertEqual(len(self.runner.calls), 2)
        self.assertEqual(
            first_number(self.runner.calls[1]["process"]["default_acceleration"]),
            2500,
        )
        self.assertTrue(self.runner.calls[0]["model_exists"])
        self.assertEqual(self.runner.calls[0]["model"].name, "model.stl")

    def test_second_reslice_reuses_baseline_cache(self):
        messages = []
        self.bridge.handle(
            {"type": "b3d.reslice", "request": 1, "changes": {"printSpeedScale": 1.5}},
            messages.append,
        )
        self.bridge.handle(
            {"type": "b3d.reslice", "request": 2, "changes": {"printSpeedScale": 1.5}},
            messages.append,
        )
        self.assertEqual(len(self.runner.calls), 3)
        self.assertEqual(messages[-1]["baselineSeconds"], 815)

    def test_busy_request_cancels_previous_when_background(self):
        started = threading.Event()
        release = threading.Event()

        class SlowRunner(RecordingRunner):
            def __init__(self):
                super().__init__()
                self.n = 0

            def slice(self, model_path, output_dir, machine, process, filament, timeout_s, cancel):
                self.n += 1
                if self.n == 1:
                    started.set()
                    release.wait(3)
                    return SliceOutcome(False, None, None, 1, "отменено")
                return super().slice(
                    model_path, output_dir, machine, process, filament, timeout_s, cancel
                )

        runner = SlowRunner()
        service = ResliceService(
            self.store,
            FakeHost(FakeModel((TETRA,))),
            work_root=self.root / "slow",
            runner=runner,
            background=True,
        )
        bridge = PageBridge(self.store, None, "0.3.0", reslice=service)
        messages = []
        bridge.handle({"type": "b3d.reslice", "request": 1, "changes": {}}, messages.append)
        self.assertTrue(started.wait(2))
        bridge.handle(
            {"type": "b3d.reslice", "request": 2, "changes": {"printSpeedScale": 1.5}},
            messages.append,
        )
        release.set()
        service.wait(5)
        kinds = [(item.get("request"), item.get("type")) for item in messages]
        self.assertTrue(any(item[0] == 1 and item[1] == "b3d.error" for item in kinds))
        self.assertTrue(any(item[0] == 2 and item[1] == "b3d.reslice-result" for item in kinds))


if __name__ == "__main__":
    unittest.main()
