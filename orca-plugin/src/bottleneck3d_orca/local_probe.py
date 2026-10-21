"""Run the Bottleneck3D Orca profile probe without OrcaSlicer."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Sequence

from .fake_context import load_fake_context
from .plugin import run_profile_probe


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate a Bottleneck3D probe report from fake Orca values.",
    )
    parser.add_argument("--gcode", required=True, help="Path to a local G-code file.")
    parser.add_argument(
        "--values",
        required=True,
        help="Path to a JSON object with fake ctx.config_value values.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    gcode_path = Path(args.gcode)
    values_path = Path(args.values)
    ctx = load_fake_context(gcode_path, values_path)
    report_path = run_profile_probe(ctx)
    print(report_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
