from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Tuple

import frontmatter

from config import get_made_home, get_workspace_home


def _load_command_file(file_path: Path, source: str) -> Dict[str, Any]:
    post = frontmatter.load(file_path)
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
    return [_load_command_file(file_path, source) for file_path in command_files]


def _load_repo_commands(repo_name: str) -> List[Dict[str, Any]]:
    repo_path = get_workspace_home() / repo_name
    command_files: List[Tuple[Path, str]] = []
    if repo_path.exists():
        for path in repo_path.glob(".*/commands/**/*.md"):
            if path.is_file():
                command_files.append((path, "repository"))

    return [_load_command_file(path, source) for path, source in sorted(command_files)]


def list_commands(repo_name: str) -> List[Dict[str, Any]]:
    commands: List[Dict[str, Any]] = []
    command_roots: List[Tuple[Path, str]] = [
        (get_made_home() / ".made" / "commands", "made"),
        (get_workspace_home() / ".made" / "commands", "workspace"),
        (Path.home() / ".made" / "commands", "user"),
        (Path.home() / ".claude" / "commands", "user"),
        (Path.home() / ".codex" / "commands", "user"),
        (Path.home() / ".kiro" / "commands", "user"),
    ]

    for directory, source in command_roots:
        commands.extend(_load_commands_from_dir(directory, source))

    commands.extend(_load_repo_commands(repo_name))
    return commands
