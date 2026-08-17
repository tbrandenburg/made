import os
from pathlib import Path


def get_made_home() -> Path:
    return Path(os.environ.get("MADE_HOME", os.getcwd()))


def get_workspace_home() -> Path:
    return Path(os.environ.get("MADE_WORKSPACE_HOME", os.getcwd()))


def get_made_directory() -> Path:
    return get_made_home() / ".made"


def ensure_directory(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_made_structure() -> Path:
    made_dir = ensure_directory(get_made_directory())
    ensure_directory(made_dir / "knowledge")
    ensure_directory(made_dir / "constitutions")
    ensure_directory(made_dir / "tasks")
    return made_dir


def get_backend_host() -> str:
    return os.environ.get("MADE_BACKEND_HOST", "0.0.0.0")


def get_backend_port() -> int:
    return int(os.environ.get("MADE_BACKEND_PORT", 3000))


def get_cors_origins() -> list[str]:
    default_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
    configured_origins = os.environ.get("MADE_ALLOWED_ORIGINS")
    if not configured_origins:
        return default_origins
    origins = [origin.strip() for origin in configured_origins.split(",") if origin.strip()]
    return origins or default_origins
