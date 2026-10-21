"""OrcaSlicer plugin entrypoint for the Bottleneck3D spike."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .effective_profile import build_effective_profile
from .gcode_command_extractor import extract_gcode_command_snapshot
from .gcode_timeline import build_gcode_timeline
from .preset_export import build_preset_export, write_preset_export
from .profile_extractor import extract_profile_snapshot
from .report_writer import write_report
from .role_impact import build_role_impact
from .time_waterfall import build_time_waterfall
from .reslice import ResliceService, find_orca_exe
from .web_bridge import GcodeStore, PageBridge, load_page_html

try:
    import orca  # type: ignore[import-not-found]
except ModuleNotFoundError:  # Local tests run without OrcaSlicer.
    orca = None  # type: ignore[assignment]

_store: GcodeStore | None = None


def gcode_store() -> GcodeStore:
    global _store
    if _store is None:
        _store = GcodeStore(Path(orca.host.plugin.storage()))
    return _store


def page_bridge() -> PageBridge:
    from . import __version__

    store = gcode_store()
    return PageBridge(
        store,
        lambda: build_preset_export(
            orca.host.preset_bundle(), str(getattr(orca, "__version__", ""))
        ),
        __version__,
        reslice=ResliceService(
            store,
            orca.host,
            work_root=Path(orca.host.plugin.storage()) / "reslice-work",
            exe=find_orca_exe(),
        ),
    )


def run_profile_probe(ctx: Any) -> Path:
    """Extract profile values and write a local report next to the G-code."""
    gcode_path = getattr(ctx, "gcode_path", None)
    if not gcode_path:
        raise ValueError("Orca context does not expose gcode_path.")

    profile_snapshot = extract_profile_snapshot(ctx)
    command_snapshot = extract_gcode_command_snapshot(gcode_path)
    effective_profile = build_effective_profile(profile_snapshot, command_snapshot)
    gcode_timeline = build_gcode_timeline(gcode_path)
    time_waterfall = build_time_waterfall(gcode_timeline)
    role_impact = build_role_impact(gcode_timeline)
    return write_report(
        gcode_path,
        profile_snapshot,
        command_snapshot,
        effective_profile,
        gcode_timeline,
        time_waterfall,
        role_impact,
    )


if orca is not None:

    class Bottleneck3DProfileProbe(orca.slicing.SlicingPipelineCapabilityBase):
        def get_name(self):
            return "Bottleneck3D Profile Probe"

        def execute(self, ctx):
            if ctx.step != orca.slicing.Step.psGCodePostProcess:
                return orca.ExecutionResult.success("Skipped non-G-code step.")

            try:
                gcode_store().remember_copy(ctx.gcode_path, getattr(ctx, "output_name", None))
            except Exception:  # noqa: BLE001 - the export event still records the path.
                pass

            try:
                report_path = run_profile_probe(ctx)
            except Exception as exc:  # noqa: BLE001 - keep slicing from hard failing.
                return orca.ExecutionResult.success(
                    f"Bottleneck3D profile probe failed: {type(exc).__name__}: {exc}",
                )

            return orca.ExecutionResult.success(
                f"Bottleneck3D report written: {report_path.name}",
            )


    class Bottleneck3DPresetExport(orca.script.ScriptPluginCapabilityBase):
        def get_name(self):
            return "Bottleneck3D Export Presets"

        def execute(self):
            try:
                path = write_preset_export(
                    orca.host.preset_bundle(),
                    Path(orca.host.plugin.storage()),
                    str(getattr(orca, "__version__", "")),
                )
            except Exception as exc:  # noqa: BLE001 - report instead of crashing the UI.
                return orca.ExecutionResult.failure(
                    orca.PluginResult.RecoverableError,
                    f"Bottleneck3D preset export failed: {type(exc).__name__}: {exc}",
                )
            orca.host.ui.message(
                "Пресеты выгружены. Откройте этот файл в Bottleneck3D "
                f"(«Пресеты Orca» → «Файл экспорта»):\n\n{path}",
                title="Bottleneck3D",
            )
            return orca.ExecutionResult.success(f"Presets exported: {path}")


    class Bottleneck3DPage(orca.pages.PagesPluginCapabilityBase):
        """Main-window tab with the full web app; also records exported G-code."""

        def get_name(self):
            return "Bottleneck3D"

        def get_ui(self):
            return load_page_html()

        def on_message(self, message):
            page_bridge().handle(message, self.post_message)

        def on_lifecycle_event(self, event, ctx):
            if (
                event == orca.LifecycleEvent.GCodeExportFinished
                and ctx.code == orca.LifecycleEvtCode.Ok
            ):
                gcode_store().remember_export(ctx.msg or ctx.name)


    class Bottleneck3DWindow(orca.script.ScriptPluginCapabilityBase):
        """Same app in a separate window, for hosts without plugin tabs."""

        window = None

        def get_name(self):
            return "Bottleneck3D Window"

        def execute(self):
            if self.window is not None and self.window.is_open():
                self.window.close()
            bridge = page_bridge()

            def on_message(message):
                if self.window is not None:
                    bridge.handle(message, self.window.post)

            options = {"html": load_page_html(), "title": "Bottleneck3D",
                       "on_message": on_message}
            try:
                self.window = orca.host.ui.create_window(width=1280, height=860, **options)
            except TypeError:
                self.window = orca.host.ui.create_window(**options)
            return orca.ExecutionResult.success("Bottleneck3D window opened.")


    @orca.plugin
    class Bottleneck3DPlugin(orca.base):
        def register_capabilities(self):
            orca.register_capability(Bottleneck3DPage)
            orca.register_capability(Bottleneck3DWindow)
            orca.register_capability(Bottleneck3DProfileProbe)
            orca.register_capability(Bottleneck3DPresetExport)
