import json
from pathlib import Path

from config import ensure_made_structure

SETTINGS_FILE = "settings.json"


def get_settings_path() -> Path:
    made_dir = ensure_made_structure()
    return made_dir / SETTINGS_FILE


def _default_settings() -> dict[str, str]:
    return {
        # Supported values: "opencode", "opencode-legacy", "kiro", "copilot", "codex", "ob1", "claude"
        "agentCli": "opencode",
    }


def _repository_settings_path(context_path: Path | None) -> Path | None:
    if context_path is None:
        return None

    resolved_context = context_path.resolve()
    if resolved_context.is_file():
        resolved_context = resolved_context.parent

    candidate = resolved_context / ".made" / SETTINGS_FILE
    return candidate if candidate.exists() else None


def read_settings(context_path: Path | None = None):
    settings_path = _repository_settings_path(context_path) or get_settings_path()
    if not settings_path.exists():
        defaults = _default_settings()
        settings_path.write_text(json.dumps(defaults, indent=2), encoding="utf-8")
        return defaults
    return json.loads(settings_path.read_text(encoding="utf-8"))


def write_settings(settings):
    settings_path = get_settings_path()
    settings_path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    return settings
