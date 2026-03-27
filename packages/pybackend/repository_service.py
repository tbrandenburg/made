import os
import subprocess
import logging
import shutil
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Union
from urllib.parse import quote_plus

from config import get_made_home, get_workspace_home

logger = logging.getLogger(__name__)


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


def walk_for_extension(
    dir_path: Path, ext: str, depth: int = 0, max_depth: int = 3
) -> bool:
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


def get_branch_name(repo_path: Path) -> str | None:
    try:
        output = subprocess.check_output(
            ["git", "-C", str(repo_path), "rev-parse", "--abbrev-ref", "HEAD"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None

    if not output:
        return None
    if output == "HEAD":
        return "Detached"
    return output


def get_license(repo_path: Path) -> str:
    for candidate in ["LICENSE", "LICENSE.md", "LICENSE.txt"]:
        license_path = repo_path / candidate
        if license_path.exists() and license_path.is_file():
            first_line = (
                license_path.read_text(encoding="utf-8", errors="ignore")
                .split("\n")[0]
                .strip()
            )
            return first_line or license_path.name
    return "Unknown"


def _extract_repo_name(repo_url: str) -> str:
    if not repo_url:
        raise ValueError("Repository URL is required")

    name = repo_url.rstrip("/").split("/")[-1]
    if name.endswith(".git"):
        name = name[:-4]

    if not name:
        raise ValueError("Invalid repository URL")

    return name


def get_repository_info(repo_name: str) -> Dict[str, Union[str, bool, None]]:
    workspace = get_workspace_home()
    repo_path = workspace / repo_name
    if not repo_path.exists() or not repo_path.is_dir():
        raise FileNotFoundError("Repository not found")

    git_dir = repo_path / ".git"
    is_git = git_dir.exists() and (git_dir.is_dir() or git_dir.is_file())
    is_worktree_child = is_git and git_dir.is_file()
    return {
        "name": repo_name,
        "path": str(repo_path),
        "hasGit": is_git,
        "isWorktreeChild": is_worktree_child,
        "lastCommit": get_last_commit_date(repo_path) if is_git else None,
        "branch": get_branch_name(repo_path) if is_git else None,
        "technology": detect_technology(repo_path),
        "license": get_license(repo_path),
    }


def list_repositories() -> List[Dict[str, Union[str, bool, None]]]:
    workspace = get_workspace_home()
    return [get_repository_info(name) for name in list_directories(workspace)]


def list_repository_templates() -> List[str]:
    templates_root = get_made_home() / ".made" / "templates"
    if not templates_root.exists() or not templates_root.is_dir():
        return []

    return sorted(
        [entry.name for entry in templates_root.iterdir() if entry.is_dir()],
        key=str.casefold,
    )


def apply_repository_template(repo_name: str, template_name: str) -> Dict[str, str]:
    normalized_template_name = template_name.strip()
    if not normalized_template_name:
        raise ValueError("Template name is required")
    if Path(normalized_template_name).name != normalized_template_name:
        raise ValueError("Invalid template name")

    workspace = get_workspace_home()
    repo_path = workspace / repo_name
    if not repo_path.exists() or not repo_path.is_dir():
        raise FileNotFoundError("Repository not found")

    source_path = get_made_home() / ".made" / normalized_template_name
    if not source_path.exists() or not source_path.is_dir():
        raise FileNotFoundError("Template not found")

    for child in source_path.iterdir():
        destination_path = repo_path / child.name
        if child.is_dir():
            shutil.copytree(child, destination_path, dirs_exist_ok=True)
        else:
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(child, destination_path)

    return {"repository": repo_name, "template": normalized_template_name}


def create_repository(name: str) -> Dict[str, Union[str, bool, None]]:
    workspace = get_workspace_home()
    repo_path = workspace / name
    if repo_path.exists():
        raise ValueError("Repository already exists")
    logger.info("Initializing repository '%s' in %s", name, workspace)
    repo_path.mkdir(parents=True, exist_ok=False)
    try:
        subprocess.check_call(
            ["git", "init"],
            cwd=str(repo_path),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        try:
            os.rmdir(repo_path)
        except OSError:
            pass
        raise ValueError("Failed to initialize git repository")
    logger.info("Repository '%s' initialized successfully", name)
    return get_repository_info(name)


def clone_repository(
    repo_url: str,
    target_name: str | None = None,
    branch: str | None = None,
) -> Dict[str, Union[str, bool, None]]:
    repo_name = target_name.strip() if target_name else None
    branch_name = branch.strip() if branch else None
    if not repo_name:
        repo_name = _extract_repo_name(repo_url)
    workspace = get_workspace_home()
    workspace.mkdir(parents=True, exist_ok=True)
    target_path = workspace / repo_name

    if target_path.exists():
        raise ValueError("Repository already exists")

    logger.info("Cloning repository '%s' into '%s'", repo_url, target_path)
    try:
        command = ["git", "clone"]
        if branch_name:
            command.extend(["-b", branch_name])
        command.extend([repo_url, repo_name])
        subprocess.check_call(
            command,
            cwd=str(workspace),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        raise ValueError("Failed to clone repository")

    logger.info("Repository cloned to '%s'", target_path)
    return get_repository_info(repo_name)


def build_directory_node(current_path: Path, base_path: Path) -> FileNode:
    relative_path = current_path.relative_to(base_path)
    children: list[FileNode] = []
    for child in current_path.iterdir():
        if child.name == ".git":
            continue
        child_relative = child.relative_to(base_path)
        if child.is_dir():
            children.append(
                {
                    "name": child.name,
                    "path": (
                        str(child_relative) if str(child_relative) != "." else "."
                    ),
                    "type": "folder",
                }
            )
        else:
            stats = child.stat()
            children.append(
                {
                    "name": child.name,
                    "path": str(child_relative),
                    "type": "file",
                    "size": stats.st_size,
                }
            )
    return {
        "name": current_path.name,
        "path": str(relative_path) if str(relative_path) != "." else ".",
        "type": "folder",
        "children": children,
    }


def list_repository_files(repo_name: str, path: str = ".") -> FileNode:
    workspace = get_workspace_home()
    repo_path = workspace / repo_name
    if not repo_path.exists():
        raise FileNotFoundError("Repository not found")
    target_path = repo_path / path
    if not target_path.exists() or not target_path.is_dir():
        raise FileNotFoundError("Repository path not found")
    return build_directory_node(target_path, repo_path)


def read_repository_file(repo_name: str, file_path: str) -> str:
    workspace = get_workspace_home()
    target = workspace / repo_name / file_path
    return target.read_text(encoding="utf-8")


def write_repository_file(repo_name: str, file_path: str, content: str) -> None:
    workspace = get_workspace_home()
    target = workspace / repo_name / file_path
    logger.info("Writing repository file '%s' in '%s'", file_path, repo_name)
    target.write_text(content, encoding="utf-8")


def create_repository_file(repo_name: str, file_path: str, content: str = "") -> None:
    workspace = get_workspace_home()
    target = workspace / repo_name / file_path
    target.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Creating repository file '%s' in '%s'", file_path, repo_name)
    target.write_text(content, encoding="utf-8")


def write_repository_file_bytes(repo_name: str, file_path: str, content: bytes) -> None:
    workspace = get_workspace_home()
    target = workspace / repo_name / file_path
    target.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Uploading repository file '%s' in '%s'", file_path, repo_name)
    target.write_bytes(content)


def rename_repository_file(repo_name: str, old_path: str, new_path: str) -> None:
    workspace = get_workspace_home()
    logger.info(
        "Renaming repository file from '%s' to '%s' in '%s'",
        old_path,
        new_path,
        repo_name,
    )
    (workspace / repo_name / old_path).rename(workspace / repo_name / new_path)


def delete_repository_file(repo_name: str, file_path: str) -> None:
    workspace = get_workspace_home()
    target = workspace / repo_name / file_path
    logger.info("Deleting repository path '%s' in '%s'", file_path, repo_name)
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


def _run_git(repo_path: Path, args: list[str]) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repo_path), *args],
        stderr=subprocess.DEVNULL,
        text=True,
    ).strip()


def _github_repo(repo_path: Path) -> str | None:
    try:
        remote_url = _run_git(repo_path, ["remote", "get-url", "origin"])
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None

    if remote_url.startswith("git@github.com:"):
        remote_url = remote_url.replace("git@github.com:", "")
    elif "github.com/" in remote_url:
        remote_url = remote_url.split("github.com/", 1)[1]
    else:
        return None

    repo = remote_url.removesuffix(".git").strip("/")
    return repo or None


def _github_get_json(url: str) -> dict | list | None:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "made-app",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310
            import json

            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def _github_count(url: str, field: str = "total_count") -> int | None:
    payload = _github_get_json(url)
    if isinstance(payload, dict):
        value = payload.get(field)
        if isinstance(value, int):
            return value
    return None


def _ahead_behind(repo_path: Path) -> dict[str, int]:
    try:
        output = _run_git(
            repo_path, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]
        )
        ahead, behind = output.split()
        return {"ahead": int(ahead), "behind": int(behind)}
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
        return {"ahead": 0, "behind": 0}


def _remote_line_stats(repo_path: Path) -> dict[str, int]:
    try:
        numstat_output = _run_git(repo_path, ["diff", "--numstat", "@{upstream}..HEAD"])
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {"green": 0, "red": 0}

    return _line_stats_from_numstat(numstat_output)


def _line_stats_from_numstat(numstat_output: str) -> dict[str, int]:
    green = 0
    red = 0
    for line in numstat_output.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        added, deleted = parts[0], parts[1]
        if added.isdigit():
            green += int(added)
        if deleted.isdigit():
            red += int(deleted)
    return {"green": green, "red": red}


def _untracked_files(repo_path: Path) -> list[str]:
    try:
        output = _run_git(repo_path, ["ls-files", "--others", "--exclude-standard"])
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []

    return [line for line in output.splitlines() if line]


def get_repository_git_status(
    repo_name: str,
) -> Dict[str, Union[str, int, dict, list, None]]:
    workspace = get_workspace_home()
    repo_path = workspace / repo_name
    if not repo_path.exists() or not repo_path.is_dir():
        raise FileNotFoundError("Repository not found")

    if not (repo_path / ".git").exists():
        raise ValueError("Repository is not a git repository")

    branch = get_branch_name(repo_path)
    ahead_behind = _ahead_behind(repo_path)

    diff_numstat = ""
    try:
        diff_numstat = _run_git(repo_path, ["diff", "--numstat", "HEAD"])
    except (subprocess.CalledProcessError, FileNotFoundError):
        diff_numstat = ""

    line_stats = _remote_line_stats(repo_path)

    diff_files = []
    seen_paths: set[str] = set()
    for line in diff_numstat.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        added, deleted, path = parts[0], parts[1], parts[2]
        seen_paths.add(path)
        diff_files.append(
            {
                "path": path,
                "green": int(added) if added.isdigit() else 0,
                "red": int(deleted) if deleted.isdigit() else 0,
            }
        )

    for path in _untracked_files(repo_path):
        if path in seen_paths:
            continue
        diff_files.append({"path": path, "green": 0, "red": 0})

    last_commit_id = None
    last_commit_date = None
    try:
        raw = _run_git(repo_path, ["log", "-1", "--format=%H\t%cI"])
        if raw:
            commit_id, commit_date = raw.split("\t", 1)
            last_commit_id = commit_id
            try:
                last_commit_date = (
                    datetime.fromisoformat(commit_date.replace("Z", "+00:00"))
                    .astimezone(timezone.utc)
                    .isoformat()
                )
            except ValueError:
                last_commit_date = commit_date
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
        pass

    try:
        worktrees_output = _run_git(repo_path, ["worktree", "list", "--porcelain"])
        worktree_count = worktrees_output.count("\nworktree ") + (
            1 if worktrees_output.startswith("worktree ") else 0
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        worktree_count = 0

    github_repo = _github_repo(repo_path)
    links = {
        "repo": None,
        "issues": None,
        "pulls": None,
        "branches": None,
        "commit": None,
    }
    counts = {
        "issues": None,
        "pullRequests": None,
        "branches": None,
        "worktrees": worktree_count,
    }
    if github_repo:
        base = f"https://github.com/{github_repo}"
        links = {
            "repo": base,
            "issues": f"{base}/issues",
            "pulls": f"{base}/pulls",
            "branches": f"{base}/branches",
            "commit": f"{base}/commit/{last_commit_id}" if last_commit_id else None,
        }
        counts["issues"] = _github_count(
            f"https://api.github.com/search/issues?q={quote_plus(f'repo:{github_repo} type:issue state:open')}"
        )
        counts["pullRequests"] = _github_count(
            f"https://api.github.com/search/issues?q={quote_plus(f'repo:{github_repo} type:pr state:open')}"
        )
        branches_payload = _github_get_json(
            f"https://api.github.com/repos/{github_repo}/branches?per_page=100"
        )
        if isinstance(branches_payload, list):
            counts["branches"] = len(branches_payload)

    return {
        "branch": branch,
        "aheadBehind": ahead_behind,
        "lineStats": line_stats,
        "lastCommit": {
            "id": last_commit_id,
            "date": last_commit_date,
        },
        "counts": counts,
        "links": links,
        "diff": diff_files,
    }


def pull_repository(repo_name: str) -> Dict[str, str]:
    workspace = get_workspace_home()
    repo_path = workspace / repo_name
    if not repo_path.exists() or not repo_path.is_dir():
        raise FileNotFoundError("Repository not found")
    try:
        output = _run_git(repo_path, ["pull"])
        return {"output": output}
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise ValueError("Failed to pull repository") from exc


def create_repository_worktree(
    repo_name: str, directory_name: str, branch_name: str
) -> Dict[str, str]:
    workspace = get_workspace_home()
    repo_path = workspace / repo_name
    if not repo_path.exists() or not repo_path.is_dir():
        raise FileNotFoundError("Repository not found")

    target_dir = workspace / directory_name
    if target_dir.exists():
        raise ValueError("Target worktree directory already exists")

    try:
        _run_git(
            repo_path,
            ["worktree", "add", str(target_dir), "-b", branch_name],
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise ValueError("Failed to create worktree") from exc

    return {"path": str(target_dir), "branch": branch_name}


def remove_repository_worktree(repo_name: str) -> Dict[str, str]:
    workspace = get_workspace_home()
    worktree_path = workspace / repo_name
    if not worktree_path.exists() or not worktree_path.is_dir():
        raise FileNotFoundError("Repository not found")

    git_file = worktree_path / ".git"
    if not git_file.exists() or not git_file.is_file():
        raise ValueError("Repository is not a worktree")

    try:
        git_file_content = git_file.read_text(encoding="utf-8", errors="ignore")
        gitdir_line = git_file_content.splitlines()[0].strip()
        if not gitdir_line.startswith("gitdir:"):
            raise ValueError("Invalid git metadata")

        worktree_gitdir = Path(gitdir_line.split(":", 1)[1].strip())
        if not worktree_gitdir.is_absolute():
            worktree_gitdir = (worktree_path / worktree_gitdir).resolve()

        main_repo_path = worktree_gitdir.parents[2]
        _run_git(
            main_repo_path,
            ["worktree", "remove", str(worktree_path)],
        )
    except IndexError as exc:
        raise ValueError("Invalid git metadata") from exc
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise ValueError("Failed to remove worktree") from exc

    return {"removed": repo_name}
