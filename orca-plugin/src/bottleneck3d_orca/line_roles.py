"""Extract normalized line roles from slicer G-code comments."""

from __future__ import annotations

import re
from typing import Any


SCHEMA_VERSION = 1
ROLE_COMMENT_PATTERN = re.compile(r";\s*(?:TYPE|FEATURE)\s*:\s*(.+)", re.IGNORECASE)


def _clean(value: str) -> str:
    return re.sub(r"[\s_\-]+", " ", value.strip().lower())


def normalize_role(value: str) -> str:
    role = _clean(value)

    if any(token in role for token in ("outer wall", "external perimeter", "wall outer")):
        return "outer_wall"
    if any(token in role for token in ("inner wall", "internal perimeter", "wall inner")):
        return "inner_wall"
    if "top surface" in role or "top solid" in role:
        return "top_surface"
    if "bridge" in role:
        return "bridge"
    if "support" in role:
        return "support"
    if "skirt" in role or "brim" in role:
        return "skirt_brim"
    if "gap fill" in role:
        return "gap_fill"
    if "solid infill" in role or "internal solid" in role:
        return "solid_infill"
    if "infill" in role:
        return "infill"
    if "travel" in role:
        return "travel"
    if "wall" in role or "perimeter" in role:
        return "wall"
    return "unknown"


def extract_line_role(line: str) -> dict[str, Any] | None:
    match = ROLE_COMMENT_PATTERN.search(line)
    if not match:
        return None

    raw_role = match.group(1).strip()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "role": normalize_role(raw_role),
        "rawRole": raw_role,
        "source": "gcode_comment",
    }
