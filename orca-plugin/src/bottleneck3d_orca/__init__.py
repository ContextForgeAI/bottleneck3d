"""Bottleneck3D OrcaSlicer integration spike."""

__all__ = ["__version__"]

__version__ = "0.3.0"

# Orca imports the wheel's top-level package; the @orca.plugin class must load with it.
from . import plugin  # noqa: E402,F401
