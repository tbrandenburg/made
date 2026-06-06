from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Tuple

from config import get_made_home, get_workspace_home


_HARNESS_PROCESSES: Dict[int, subprocess.Popen[Any]] = {}


def _load_harness_file(file_path: Path, source: str) -> Dict[str, Any]:
    return {
        "id": f"{source}:{file_path}",
        "name": file_path.stem,
        "path": str(file_path.resolve()),
        "source": source,
    }


def _load_harnesses_from_dir(directory: Path, source: str) -> List[Dict[str, Any]]:
    if not directory.exists() or not directory.is_dir():
        return []

    harness_files = sorted(path for path in directory.rglob("*.sh") if path.is_file())
    return [_load_harness_file(file_path, source) for file_path in harness_files]


def _load_repo_harnesses(repo_name: str | None) -> List[Dict[str, Any]]:
    if not repo_name:
        return []
    repo_path = get_workspace_home() / repo_name
    harness_entries: List[Tuple[Path, str]] = []
    if repo_path.exists():
        for path in repo_path.glob(".*/harness/**/*.sh"):
            if path.is_file():
                harness_entries.append((path, "repository"))
        for path in (repo_path / ".harness").rglob("*.sh"):
            if path.is_file():
                harness_entries.append((path, "repository"))

    return [
        _load_harness_file(path, source) for path, source in sorted(harness_entries)
    ]


def list_harnesses(repo_name: str | None = None) -> List[Dict[str, Any]]:
    harnesses: List[Dict[str, Any]] = []
    harness_roots: List[Tuple[Path, str]] = [
        (get_made_home() / ".made" / "harness", "made"),
        (get_workspace_home() / ".made" / "harness", "workspace"),
        (get_made_home() / ".kiro" / "harness", "made"),
        (get_workspace_home() / ".kiro" / "harness", "workspace"),
        (Path.home() / ".made" / "harness", "user"),
        (Path.home() / ".claude" / "harness", "user"),
        (Path.home() / ".codex" / "harness", "user"),
        (Path.home() / ".kiro" / "harness", "user"),
        (Path.home() / ".opencode" / "harness", "user"),
        (get_made_home() / ".harness", "made"),
        (get_workspace_home() / ".harness", "workspace"),
        (Path.home() / ".harness", "user"),
    ]

    for directory, source in harness_roots:
        harnesses.extend(_load_harnesses_from_dir(directory, source))

    harnesses.extend(_load_repo_harnesses(repo_name))
    return harnesses


def _parse_harness_args(raw_args: Any | None) -> List[str]:
    if raw_args is None:
        return []
    if isinstance(raw_args, list):
        return [str(arg) for arg in raw_args if str(arg)]
    if isinstance(raw_args, str):
        return shlex.split(raw_args)
    return [str(raw_args)]


def run_harness(
    repo_name: str | None, harness_path: str, args: List[str] | None = None
) -> Dict[str, Any]:
    resolved_path = Path(harness_path).expanduser().resolve()
    allowed_paths = {
        Path(entry["path"]).resolve() for entry in list_harnesses(repo_name)
    }
    if resolved_path not in allowed_paths:
        raise FileNotFoundError("Harness script not found")

    command = ["bash", str(resolved_path), *(_parse_harness_args(args))]

    execution_cwd = resolved_path.parent
    if repo_name:
        candidate_repo_path = get_workspace_home() / repo_name
        if candidate_repo_path.exists() and candidate_repo_path.is_dir():
            execution_cwd = candidate_repo_path

    process = subprocess.Popen(
        command,
        cwd=str(execution_cwd),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    _HARNESS_PROCESSES[process.pid] = process
    return {
        "pid": process.pid,
        "name": resolved_path.stem,
        "path": str(resolved_path),
    }


def _read_process_state(pid: int) -> str | None:
    proc_stat = Path("/proc") / str(pid) / "stat"
    if not proc_stat.exists():
        return None
    try:
        content = proc_stat.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if ") " not in content:
        return None
    _, remainder = content.split(") ", 1)
    if not remainder:
        return None
    return remainder.split(" ", 1)[0]


def is_process_running(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    state = _read_process_state(pid)
    if state in {"Z", "X"}:
        _HARNESS_PROCESSES.pop(pid, None)
        return False
    return True
