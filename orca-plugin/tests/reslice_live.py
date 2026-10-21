"""Live check: plugin reslice path vs demo/accuracy-sweep/results.csv.

Uses %TEMP%/b3d-sweep G-code + models and a real orca-slicer.exe.
Does not talk to a running Orca GUI.

  python tests/reslice_live.py
"""

from __future__ import annotations

import csv
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from bottleneck3d_orca.reslice import (  # noqa: E402
    FakeHost,
    FakeModel,
    OrcaCliRunner,
    ResliceService,
    find_orca_exe,
    mesh_from_model_file,
)
from bottleneck3d_orca.web_bridge import GcodeStore  # noqa: E402

TEMP_ROOT = Path(os.environ.get("TEMP") or os.environ.get("TMP") or tempfile.gettempdir()) / "b3d-sweep"
HERE = Path(__file__).resolve().parents[2]
RESULTS_CSV = HERE / "demo" / "accuracy-sweep" / "results.csv"
MODELS = {
    "cube": TEMP_ROOT / "models" / "cube.stl",
    "penholder": TEMP_ROOT / "models" / "penholder.3mf",
}
VARIANTS = (
    ("baseline", "base", "1", {}),
    ("accel×0.5", "print_accel", "0.5", {"accelerationScale": 0.5}),
    ("speed×1.5", "print_speed", "1.5", {"printSpeedScale": 1.5}),
)


def load_stand() -> dict[tuple[str, str, str], float]:
    rows = {}
    with RESULTS_CSV.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["orca_s"]:
                rows[(row["model"], row["group"], row["value"])] = float(row["orca_s"])
    return rows


def run_model(model_id: str, exe: Path, stand: dict[tuple[str, str, str], float]) -> list[dict]:
    gcode_path = TEMP_ROOT / "gcode" / model_id / "base.gcode"
    model_path = MODELS[model_id]
    if not gcode_path.is_file():
        raise FileNotFoundError(gcode_path)
    if not model_path.is_file():
        raise FileNotFoundError(model_path)
    part = mesh_from_model_file(model_path)
    rows = []
    with tempfile.TemporaryDirectory(prefix=f"b3d-live-{model_id}-") as temp:
        root = Path(temp)
        store = GcodeStore(root / "storage")
        store.remember_export(str(gcode_path))
        service = ResliceService(
            store,
            FakeHost(FakeModel((part,))),
            work_root=root / "work",
            exe=exe,
            runner=OrcaCliRunner(exe),
            background=False,
        )
        posted: list[dict] = []

        def post(message):
            posted.append(json.loads(json.dumps(message)))

        for label, group, value, changes in VARIANTS:
            posted.clear()
            started = time.perf_counter()
            service.submit(1, changes, post)
            elapsed = time.perf_counter() - started
            result = posted[-1]
            if result.get("type") != "b3d.reslice-result" or not result.get("ok"):
                rows.append(
                    {
                        "model": model_id,
                        "variant": label,
                        "ok": False,
                        "message": result.get("message"),
                        "elapsed_s": round(elapsed, 1),
                    }
                )
                continue
            seconds = float(result["seconds"])
            baseline = float(result["baselineSeconds"])
            delta = seconds - baseline
            stand_base = stand[(model_id, "base", "1")]
            stand_variant = stand[(model_id, group, value)]
            stand_delta = stand_variant - stand_base
            rows.append(
                {
                    "model": model_id,
                    "variant": label,
                    "ok": True,
                    "ours_s": seconds,
                    "ours_baseline_s": baseline,
                    "ours_delta_s": delta,
                    "stand_s": stand_variant,
                    "stand_delta_s": stand_delta,
                    "delta_diff_s": delta - stand_delta,
                    "slice_elapsed_ms": result.get("elapsedMs"),
                    "wall_s": round(elapsed, 1),
                }
            )
    return rows


def main() -> int:
    exe = find_orca_exe()
    if exe is None:
        print("нет orca-slicer.exe")
        return 2
    stand = load_stand()
    print(f"exe={exe}")
    print(f"stand={RESULTS_CSV}")
    all_rows: list[dict] = []
    for model_id in MODELS:
        print(f"\n=== {model_id} ===")
        rows = run_model(model_id, exe, stand)
        all_rows.extend(rows)
        for row in rows:
            print(json.dumps(row, ensure_ascii=False))
    print("\n# таблица")
    print(
        "| модель | вариант | наш s | наш baseline | наш Δ | стенд s | стенд Δ | Δнаш−Δстенд | нарезка с |"
    )
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|")
    worst = 0.0
    for row in all_rows:
        if not row.get("ok"):
            print(f"| {row['model']} | {row['variant']} | FAIL | | | | | | {row.get('elapsed_s')} |")
            continue
        worst = max(worst, abs(row["delta_diff_s"]))
        print(
            f"| {row['model']} | {row['variant']} | {row['ours_s']:.0f} | {row['ours_baseline_s']:.0f} | "
            f"{row['ours_delta_s']:+.0f} | {row['stand_s']:.0f} | {row['stand_delta_s']:+.0f} | "
            f"{row['delta_diff_s']:+.1f} | {row['wall_s']:.1f} |"
        )
    print(f"\nхудшее |Δнаш−Δстенд| = {worst:.1f} с")
    out = Path(__file__).with_name("reslice_live_results.json")
    out.write_text(json.dumps(all_rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"json: {out}")
    failed = any(not row.get("ok") for row in all_rows)
    return 1 if failed or worst > 8 else 0


if __name__ == "__main__":
    raise SystemExit(main())
