import os
import subprocess
from pathlib import Path
from typing import Dict, List, Union

from .config import get_workspace_home


FileNode = Dict[str, Union[str, int, List["FileNode"]]]


TECHNOLOGY_INDICATORS = [
    {"files": ["package.json"], "label": "NodeJS"},
    {"files": ["requirements.txt", "pyproject.toml"], "label": "Python"},
    {"files": ["Cargo.toml"], "label": "Rust"},
    {"files": ["go.mod"], "label": "Go"},
    {"files": ["Makefile"], "label": "C/C++"},
    {"files": ["CMakeLists.txt"], "label": "C/C++"},
    {"files": ["Gemfile"], "label": "Ruby"},
    {"files": ["composer.json"], "label": "PHP"},
    {"files": ["build.gradle", "build.gradle.kts"], "label": "Java/Kotlin"},
    {"files": [".csproj"], "label": "C#"},
    {"files": ["Dockerfile"], "label": "Container"},
]


def list_directories(base_path: Path) -> List[str]:
    if not base_path.exists():
        return []
    return [entry.name for entry in base_path.iterdir() if entry.is_dir()]


def walk_for_extension(dir_path: Path, ext: str, depth: int = 0, max_depth: int = 3) -> bool:
    if depth > max_depth:
        return False
    for entry in dir_path.iterdir():
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            if walk_for_extension(entry, ext, depth + 1, max_depth):
                return True
        elif entry.is_file() and entry.suffix == ext:
            return True
    return False


def detect_technology(repo_path: Path) -> str:
    files_in_root = {entry.name for entry in repo_path.iterdir()}
    for indicator in TECHNOLOGY_INDICATORS:
        if any(file_name in files_in_root for file_name in indicator["files"]):
            return indicator["label"]

    if walk_for_extension(repo_path, ".py"):
        return "Python"
    if walk_for_extension(repo_path, ".ts"):
        return "TypeScript"
    if walk_for_extension(repo_path, ".js"):
        return "JavaScript"
    return "Unknown"


def get_last_commit_date(repo_path: Path) -> str | None:
    try:
        output = subprocess.check_output(
            ["git", "-C", str(repo_path), "log", "-1", "--format=%cI"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        return output or None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def get_license(repo_path: Path) -> str:
    for candidate in ["LICENSE", "LICENSE.md", "LICENSE.txt"]:
        license_path = repo_path / candidate
        if license_path.exists() and license_path.is_file():
            first_line = license_path.read_text(encoding="utf-8", errors="ignore").split("\n")[0].strip()
            return first_line or license_path.name
    return "Unknown"


def get_repository_info(repo_name: str) -> Dict[str, Union[str, bool, None]]:
    workspace = get_workspace_home()
    repo_path = workspace / repo_name
    if not repo_path.exists() or not repo_path.is_dir():
        raise FileNotFoundError("Repository not found")

    git_dir = repo_path / ".git"
    is_git = git_dir.exists() and git_dir.is_dir()
    return {
        "name": repo_name,
        "path": str(repo_path),
        "hasGit": is_git,
        "lastCommit": get_last_commit_date(repo_path) if is_git else None,
        "technology": detect_technology(repo_path),
        "license": get_license(repo_path),
    }


def list_repositories() -> List[Dict[str, Union[str, bool, None]]]:
    workspace = get_workspace_home()
    return [get_repository_info(name) for name in list_directories(workspace)]


def create_repository(name: str) -> Dict[str, Union[str, bool, None]]:
    workspace = get_workspace_home()
    repo_path = workspace / name
    if repo_path.exists():
        raise ValueError("Repository already exists")
    repo_path.mkdir(parents=True, exist_ok=False)
    try:
        subprocess.check_call(["git", "init"], cwd=str(repo_path), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, FileNotFoundError):
        try:
            os.rmdir(repo_path)
        except OSError:
            pass
        raise ValueError("Failed to initialize git repository")
    return get_repository_info(name)


def build_file_tree(current_path: Path, base_path: Path) -> FileNode:
    stats = current_path.stat()
    relative_path = current_path.relative_to(base_path)
    if current_path.is_dir():
        children = [
            build_file_tree(child, base_path)
            for child in current_path.iterdir()
            if child.name != ".git"
        ]
        return {
            "name": current_path.name,
            "path": str(relative_path) if str(relative_path) != "." else ".",
            "type": "folder",
            "children": children,
        }
    return {
        "name": current_path.name,
        "path": str(relative_path),
        "type": "file",
        "size": stats.st_size,
    }


def list_repository_files(repo_name: str) -> FileNode:
    workspace = get_workspace_home()
    repo_path = workspace / repo_name
    if not repo_path.exists():
        raise FileNotFoundError("Repository not found")
    return build_file_tree(repo_path, repo_path)


def read_repository_file(repo_name: str, file_path: str) -> str:
    workspace = get_workspace_home()
    target = workspace / repo_name / file_path
    return target.read_text(encoding="utf-8")


def write_repository_file(repo_name: str, file_path: str, content: str) -> None:
    workspace = get_workspace_home()
    target = workspace / repo_name / file_path
    target.write_text(content, encoding="utf-8")


def create_repository_file(repo_name: str, file_path: str, content: str = "") -> None:
    workspace = get_workspace_home()
    target = workspace / repo_name / file_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def rename_repository_file(repo_name: str, old_path: str, new_path: str) -> None:
    workspace = get_workspace_home()
    (workspace / repo_name / old_path).rename(workspace / repo_name / new_path)


def delete_repository_file(repo_name: str, file_path: str) -> None:
    workspace = get_workspace_home()
    target = workspace / repo_name / file_path
    if target.is_dir():
        for child in list(target.iterdir()):
            child_relative = Path(file_path) / child.name
            if child.is_dir():
                delete_repository_file(repo_name, str(child_relative))
            else:
                child.unlink()
        target.rmdir()
    elif target.exists():
        target.unlink()
