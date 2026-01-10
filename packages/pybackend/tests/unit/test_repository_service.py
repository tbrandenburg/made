import subprocess
from pathlib import Path

import pytest

from repository_service import clone_repository


def _init_local_repo(repo_path: Path) -> None:
    repo_path.mkdir(parents=True)
    subprocess.check_call(
        ["git", "init"],
        cwd=repo_path,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    (repo_path / "README.md").write_text("hello", encoding="utf-8")
    subprocess.check_call(
        ["git", "config", "user.email", "test@example.com"],
        cwd=repo_path,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.check_call(
        ["git", "config", "user.name", "Test User"],
        cwd=repo_path,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.check_call(
        ["git", "add", "README.md"],
        cwd=repo_path,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.check_call(
        ["git", "commit", "-m", "init"],
        cwd=repo_path,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def test_clone_repository_from_local_source(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source_repo = tmp_path / "source_repo"
    _init_local_repo(source_repo)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    result = clone_repository(str(source_repo), "custom-name")

    cloned_repo = workspace / "custom-name"
    assert cloned_repo.exists()
    assert result["name"] == "custom-name"
    assert result["hasGit"] is True


def test_clone_repository_with_branch(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    command_calls = []

    def fake_check_call(command, **kwargs):
        command_calls.append((command, kwargs))
        (workspace / "repo").mkdir()

    monkeypatch.setattr("repository_service.subprocess.check_call", fake_check_call)

    result = clone_repository("https://example.com/repo.git", branch="release")

    assert command_calls == [
        (
            ["git", "clone", "-b", "release", "https://example.com/repo.git", "repo"],
            {
                "cwd": str(workspace),
                "stdout": subprocess.DEVNULL,
                "stderr": subprocess.DEVNULL,
            },
        )
    ]
    assert result["name"] == "repo"


def test_clone_repository_ignores_empty_target(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source_repo = tmp_path / "source_repo"
    _init_local_repo(source_repo)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    result = clone_repository(str(source_repo), " ")

    cloned_repo = workspace / "source_repo"
    assert cloned_repo.exists()
    assert result["name"] == "source_repo"


def test_clone_repository_existing_target(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "existing").mkdir()

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    with pytest.raises(ValueError, match="Repository already exists"):
        clone_repository("https://example.com/existing.git")


def test_clone_repository_requires_url(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    with pytest.raises(ValueError, match="Repository URL is required"):
        clone_repository("")


def test_clone_repository_handles_failure(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr(
        "repository_service.subprocess.check_call",
        lambda *_, **__: (_ for _ in ()).throw(
            subprocess.CalledProcessError(1, "git clone")
        ),
    )

    with pytest.raises(ValueError, match="Failed to clone repository"):
        clone_repository("https://example.com/sample.git")
