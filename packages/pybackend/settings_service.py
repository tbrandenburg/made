import json
from pathlib import Path

from config import ensure_made_structure

SETTINGS_FILE = "settings.json"


def get_settings_path() -> Path:
    made_dir = ensure_made_structure()
    return made_dir / SETTINGS_FILE


def read_settings():
    settings_path = get_settings_path()
    if not settings_path.exists():
        defaults = {
            # Supported values: "opencode", "kiro", "copilot"
            "agentCli": "opencode",
        }
        settings_path.write_text(json.dumps(defaults, indent=2), encoding="utf-8")
        return defaults
    return json.loads(settings_path.read_text(encoding="utf-8"))


def write_settings(settings):
    settings_path = get_settings_path()
    settings_path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    return settings
