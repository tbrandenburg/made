from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Tuple

from config import get_made_home, get_workspace_home


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

    harness_files = sorted(
        path for path in directory.rglob("*.sh") if path.is_file()
    )
    return [_load_harness_file(file_path, source) for file_path in harness_files]


def _load_repo_harnesses(repo_name: str) -> List[Dict[str, Any]]:
    repo_path = get_workspace_home() / repo_name
    harness_entries: List[Tuple[Path, str]] = []
    if repo_path.exists():
        for directory in [repo_path / ".opencode" / "harness", repo_path / ".harness"]:
            for path in directory.rglob("*.sh"):
                if path.is_file():
                    harness_entries.append((path, "repository"))

    return [_load_harness_file(path, source) for path, source in sorted(harness_entries)]


def list_harnesses(repo_name: str) -> List[Dict[str, Any]]:
    harnesses: List[Dict[str, Any]] = []
    harness_roots: List[Tuple[Path, str]] = [
        (get_made_home(), "made"),
        (get_workspace_home(), "workspace"),
        (Path.home(), "user"),
    ]

    for root, source in harness_roots:
        for directory in [root / ".opencode" / "harness", root / ".harness"]:
            harnesses.extend(_load_harnesses_from_dir(directory, source))

    harnesses.extend(_load_repo_harnesses(repo_name))
    return harnesses


def run_harness(repo_name: str, harness_path: str) -> Dict[str, Any]:
    resolved_path = Path(harness_path).expanduser().resolve()
    allowed_paths = {
        Path(entry["path"]).resolve() for entry in list_harnesses(repo_name)
    }
    if resolved_path not in allowed_paths:
        raise FileNotFoundError("Harness script not found")

    process = subprocess.Popen(
        ["bash", str(resolved_path)],
        cwd=str(resolved_path.parent),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
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
        return False
    return True
