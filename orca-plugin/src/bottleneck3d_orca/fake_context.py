"""Local fake Orca context for spike development without OrcaSlicer."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class FakeOrcaContext:
    def __init__(
        self,
        gcode_path: str | Path,
        values: dict[str, Any],
        output_name: str | None = None,
    ) -> None:
        self.gcode_path = str(gcode_path)
        self.output_name = output_name or Path(gcode_path).name
        self.values = values

    def config_value(self, key: str) -> Any:
        return self.values.get(key)


def load_fake_context(gcode_path: str | Path, values_path: str | Path) -> FakeOrcaContext:
    values = json.loads(Path(values_path).read_text(encoding="utf-8"))
    if not isinstance(values, dict):
        raise ValueError("Fake Orca values file must contain a JSON object.")
    return FakeOrcaContext(gcode_path, values)
