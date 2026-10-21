"""Message bridge between the embedded Bottleneck3D page and the Orca plugin."""

from __future__ import annotations

import json
import shutil
import time
from importlib import resources
from pathlib import Path
from typing import Any, Callable

from .reslice import ResliceService

PROTOCOL = "b3d"
CHUNK_CHARS = 256 * 1024
LAST_GCODE_FILE = "last.gcode"
LAST_META_FILE = "last-gcode.json"

Post = Callable[[Any], None]


def load_page_html() -> str:
    """The built web app, inlined into one HTML file by `npm run build:orca`."""
    page = resources.files(__package__).joinpath("web", "index.html")
    try:
        return page.read_text(encoding="utf-8")
    except FileNotFoundError:
        return (
            "<!doctype html><meta charset='utf-8'><body style='font-family:sans-serif'>"
            "<h2>Bottleneck3D</h2><p>Веб-интерфейс не собран: выполните "
            "<code>npm run build:orca</code> и пересоберите плагин.</p></body>"
        )


def _message_dict(message: Any) -> dict[str, Any]:
    if isinstance(message, str):
        try:
            message = json.loads(message)
        except ValueError:
            return {}
    return message if isinstance(message, dict) else {}


class GcodeStore:
    """Remembers the newest G-code Orca produced, from export events or the pipeline step."""

    def __init__(self, folder: Path):
        self.folder = folder

    @property
    def meta_path(self) -> Path:
        return self.folder / LAST_META_FILE

    def _write_meta(self, meta: dict[str, Any]) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        self.meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    def remember_export(self, path: str) -> None:
        if path and path.lower().endswith(".gcode"):
            self._write_meta({"path": path, "name": Path(path).name, "at": time.time()})

    def remember_copy(self, gcode_path: str, output_name: str | None = None) -> Path:
        self.folder.mkdir(parents=True, exist_ok=True)
        target = self.folder / LAST_GCODE_FILE
        shutil.copyfile(gcode_path, target)
        name = Path(output_name).name if output_name else Path(gcode_path).name
        self._write_meta({"path": str(target), "name": name, "at": time.time()})
        return target

    def latest(self) -> dict[str, Any] | None:
        try:
            meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
            stat = Path(meta["path"]).stat()
        except (OSError, ValueError, KeyError, TypeError):
            return None
        return {
            "name": meta.get("name") or Path(meta["path"]).name,
            "size": stat.st_size,
            "modified": stat.st_mtime,
        }

    def read_latest(self) -> tuple[str, str] | None:
        try:
            meta = json.loads(self.meta_path.read_text(encoding="utf-8"))
            path = Path(meta["path"])
            return meta.get("name") or path.name, path.read_text(
                encoding="utf-8", errors="replace"
            )
        except (OSError, ValueError, KeyError, TypeError):
            return None


def post_text(post: Post, kind: str, name: str, text: str, request: int) -> None:
    chunks = max(1, -(-len(text) // CHUNK_CHARS))
    post({"type": f"{PROTOCOL}.begin", "kind": kind, "name": name, "chunks": chunks,
          "request": request})
    for index in range(chunks):
        post({
            "type": f"{PROTOCOL}.chunk",
            "request": request,
            "index": index,
            "data": text[index * CHUNK_CHARS:(index + 1) * CHUNK_CHARS],
        })
    post({"type": f"{PROTOCOL}.end", "request": request})


class PageBridge:
    """Handles page requests; `presets` builds the preset export on demand."""

    def __init__(
        self,
        store: GcodeStore,
        presets: Callable[[], dict[str, Any]] | None,
        version: str,
        reslice: ResliceService | None = None,
    ):
        self.store = store
        self.presets = presets
        self.version = version
        self.reslice = reslice

    def status(self) -> dict[str, Any]:
        return {
            "type": f"{PROTOCOL}.status",
            "version": self.version,
            "gcode": self.store.latest(),
            "presets": self.presets is not None,
            "reslice": bool(self.reslice and self.reslice.available()),
        }

    def handle(self, message: Any, post: Post) -> None:
        data = _message_dict(message)
        kind = data.get("type")
        request = int(data.get("request") or 0)
        try:
            if kind == f"{PROTOCOL}.hello":
                post(self.status())
            elif kind == f"{PROTOCOL}.get-gcode":
                latest = self.store.read_latest()
                if latest is None:
                    post({"type": f"{PROTOCOL}.error", "request": request,
                          "message": "Orca ещё не выдала G-code: нарежьте модель."})
                else:
                    post_text(post, "gcode", latest[0], latest[1], request)
            elif kind == f"{PROTOCOL}.get-presets" and self.presets is not None:
                text = json.dumps(self.presets(), ensure_ascii=False)
                post_text(post, "presets", "bottleneck3d-presets.json", text, request)
            elif kind == f"{PROTOCOL}.reslice":
                if self.reslice is None:
                    post({"type": f"{PROTOCOL}.error", "request": request,
                          "message": "Переслайс в этом окне недоступен."})
                else:
                    self.reslice.submit(request, data.get("changes") or {}, post)
        except Exception as exc:  # noqa: BLE001 - report to the page instead of the log.
            post({"type": f"{PROTOCOL}.error", "request": request,
                  "message": f"{type(exc).__name__}: {exc}"})
