"""Extract printer-setting commands from emitted G-code."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 1

TARGET_COMMANDS = frozenset(
    {
        "M201",  # max acceleration
        "M203",  # max speed
        "M204",  # active print/travel acceleration
        "M205",  # jerk / junction deviation
        "M220",  # speed factor
        "M221",  # flow factor
        "M106",  # fan on / speed
        "M107",  # fan off
    },
)

COMMAND_PATTERN = re.compile(r"^\s*([A-Za-z]\d+)")
PARAMETER_PATTERN = re.compile(r"([A-Za-z])\s*(-?(?:\d+\.?\d*|\.\d+))")


def _command_part(line: str) -> str:
    return line.split(";", 1)[0].strip()


def _parameters(command_text: str) -> dict[str, float]:
    payload = COMMAND_PATTERN.sub("", command_text, count=1)
    return {
        key.upper(): float(value)
        for key, value in PARAMETER_PATTERN.findall(payload)
    }


def _observation(line_number: int, command_text: str) -> dict[str, Any] | None:
    match = COMMAND_PATTERN.match(command_text)
    if not match:
        return None

    command = match.group(1).upper()
    if command not in TARGET_COMMANDS:
        return None

    return {
        "lineNumber": line_number,
        "command": command,
        "parameters": _parameters(command_text),
        "raw": command_text,
        "source": "gcode_command",
        "confidence": "high",
    }


def extract_gcode_command_snapshot(
    gcode_path: str | Path,
    target_commands: Iterable[str] = TARGET_COMMANDS,
) -> dict[str, Any]:
    targets = {command.upper() for command in target_commands}
    observations: dict[str, list[dict[str, Any]]] = {command: [] for command in targets}
    line_count = 0

    with Path(gcode_path).open("r", encoding="utf-8", errors="replace") as handle:
        for line_number, line in enumerate(handle, start=1):
            line_count = line_number
            command_text = _command_part(line)
            if not command_text:
                continue

            item = _observation(line_number, command_text)
            if item and item["command"] in targets:
                observations[item["command"]].append(item)

    observations = {
        command: items
        for command, items in sorted(observations.items())
        if items
    }
    last_by_command = {
        command: items[-1]
        for command, items in observations.items()
    }

    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": "gcode.commands",
        "lineCount": line_count,
        "observedCommandCount": sum(len(items) for items in observations.values()),
        "commands": observations,
        "lastByCommand": last_by_command,
    }
