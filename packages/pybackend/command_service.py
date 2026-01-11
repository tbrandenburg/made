from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import frontmatter
import yaml

from config import get_made_home, get_workspace_home


logger = logging.getLogger(__name__)


def _load_command_file(file_path: Path, source: str) -> Optional[Dict[str, Any]]:
    try:
        post = frontmatter.load(file_path)
    except (yaml.YAMLError, ValueError) as exc:
        logger.warning(
            "Skipping command file with invalid frontmatter: %s (%s)", file_path, exc
        )
        return None
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "Skipping command file due to unexpected error: %s (%s)", file_path, exc
        )
        return None
    metadata = post.metadata or {}
    description = str(metadata.get("description") or file_path.stem)
    argument_hint = metadata.get("argument-hint")

    return {
        "id": f"{source}:{file_path}",
        "name": file_path.stem,
        "description": description,
        "path": str(file_path),
        "source": source,
        "content": post.content.strip(),
        "metadata": metadata,
        "argumentHint": argument_hint,
    }


def _load_commands_from_dir(directory: Path, source: str) -> List[Dict[str, Any]]:
    if not directory.exists() or not directory.is_dir():
        return []

    command_files = sorted(directory.rglob("*.md"))
    commands = (_load_command_file(file_path, source) for file_path in command_files)
    return [command for command in commands if command]


def _load_repo_commands(repo_name: str) -> List[Dict[str, Any]]:
    repo_path = get_workspace_home() / repo_name
    command_files: List[Tuple[Path, str]] = []
    if repo_path.exists():
        for path in repo_path.glob(".*/commands/**/*.md"):
            if path.is_file():
                command_files.append((path, "repository"))

    commands = (_load_command_file(path, source) for path, source in sorted(command_files))
    return [command for command in commands if command]


def list_commands(repo_name: str) -> List[Dict[str, Any]]:
    commands: List[Dict[str, Any]] = []
    command_roots: List[Tuple[Path, str]] = [
        (get_made_home() / ".made" / "commands", "made"),
        (get_workspace_home() / ".made" / "commands", "workspace"),
        (get_made_home() / ".kiro" / "prompts", "made"),
        (get_workspace_home() / ".kiro" / "prompts", "workspace"),
        (Path.home() / ".made" / "commands", "user"),
        (Path.home() / ".claude" / "commands", "user"),
        (Path.home() / ".codex" / "commands", "user"),
        (Path.home() / ".kiro" / "commands", "user"),
        (Path.home() / ".kiro" / "prompts", "user"),
        (Path.home() / ".opencode" / "command", "user"),
    ]

    for directory, source in command_roots:
        commands.extend(_load_commands_from_dir(directory, source))

    commands.extend(_load_repo_commands(repo_name))
    return commands
