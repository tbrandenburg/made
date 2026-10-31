"""Serve the real MADE app and built frontend together on an isolated test port."""

import os
from pathlib import Path

from fastapi.responses import FileResponse

from app import app

DIST = Path(
    os.environ.get("MADE_BUILD_TASK_DIST")
    or Path(__file__).resolve().parents[3] / "frontend" / "dist"
).resolve()


@app.get("/{path:path}")
def frontend(path: str):
    candidate = (DIST / path).resolve()
    if candidate.is_relative_to(DIST) and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(DIST / "index.html")
