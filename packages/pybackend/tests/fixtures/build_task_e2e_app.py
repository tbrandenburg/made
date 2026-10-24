"""Serve the real MADE app and built frontend together on an isolated test port."""

from pathlib import Path

from fastapi.responses import FileResponse

from app import app

DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"


@app.get("/{path:path}")
def frontend(path: str):
    candidate = (DIST / path).resolve()
    if candidate.is_relative_to(DIST) and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(DIST / "index.html")
