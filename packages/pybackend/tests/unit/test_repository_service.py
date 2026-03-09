import subprocess
from pathlib import Path

import pytest

from repository_service import (
    clone_repository,
    create_repository_worktree,
    get_repository_git_status,
    get_repository_info,
    pull_repository,
    remove_repository_worktree,
)


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


def test_get_repository_git_status(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    _init_local_repo(repo_path)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._github_repo", lambda *_: "org/repo")
    monkeypatch.setattr(
        "repository_service._github_count",
        lambda url, field="total_count": 7 if "type%3Aissue" in url else 2,
    )
    monkeypatch.setattr("repository_service._github_get_json", lambda *_: [1, 2, 3])

    result = get_repository_git_status("repo")

    assert result["branch"] in {"master", "main"}
    assert result["counts"]["issues"] == 7
    assert result["counts"]["pullRequests"] == 2
    assert result["counts"]["branches"] == 3
    assert "lineStats" in result




def test_get_repository_git_status_includes_untracked_files(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    _init_local_repo(repo_path)
    (repo_path / "new_file.txt").write_text("new", encoding="utf-8")

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._github_repo", lambda *_: None)

    result = get_repository_git_status("repo")

    assert any(entry["path"] == "new_file.txt" for entry in result["diff"])

def test_pull_repository(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    repo_path.mkdir()

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._run_git", lambda *_: "Already up to date.")

    result = pull_repository("repo")

    assert result == {"output": "Already up to date."}


def test_create_repository_worktree(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    repo_path.mkdir()

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._run_git", lambda *_: "")

    result = create_repository_worktree("repo", "repo-feature", "feature/test")

    assert result["branch"] == "feature/test"
    assert result["path"].endswith("repo-feature")




def test_remove_repository_worktree(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    worktree_path = workspace / "repo-feature"
    worktree_path.mkdir()
    (worktree_path / ".git").write_text(
        "gitdir: /tmp/parent/.git/worktrees/repo-feature\n",
        encoding="utf-8",
    )

    calls = []

    def fake_run_git(repo_path, command):
        calls.append((repo_path, command))
        return ""

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._run_git", fake_run_git)

    result = remove_repository_worktree("repo-feature")

    assert result == {"removed": "repo-feature"}
    assert calls[0][0] == Path("/tmp/parent")
    assert calls[0][1] == ["worktree", "remove", str(worktree_path)]


def test_remove_repository_worktree_rejects_non_worktree(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()

    repo_path = workspace / "repo"
    _init_local_repo(repo_path)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    with pytest.raises(ValueError, match="Repository is not a worktree"):
        remove_repository_worktree("repo")
def test_get_repository_info_detects_git_worktree_child(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    repo_path = workspace / "child-wt1"
    repo_path.mkdir(parents=True)
    (repo_path / ".git").write_text(
        "gitdir: /tmp/parent/.git/worktrees/child-wt1\n", encoding="utf-8"
    )

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    result = get_repository_info("child-wt1")

    assert result["hasGit"] is True
    assert result["isWorktreeChild"] is True


def test_get_repository_info_marks_non_worktree_repo(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    repo_path = workspace / "standard"
    _init_local_repo(repo_path)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    result = get_repository_info("standard")

    assert result["hasGit"] is True
    assert result["isWorktreeChild"] is False


def test_get_repository_git_status_uses_remote_line_stats(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    _init_local_repo(repo_path)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._github_repo", lambda *_: None)

    def fake_run_git(path, command):
        if command == ["rev-parse", "--abbrev-ref", "HEAD"]:
            return "main"
        if command == ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]:
            return "1 2"
        if command == ["diff", "--numstat", "@{upstream}..HEAD"]:
            return "4\t1\tsrc/main.py"
        if command == ["diff", "--numstat", "HEAD"]:
            return "10\t8\tsrc/local.py"
        if command == ["ls-files", "--others", "--exclude-standard"]:
            return ""
        if command == ["log", "-1", "--format=%H\t%cI"]:
            return "abc123\t2024-01-01T00:00:00Z"
        if command == ["worktree", "list", "--porcelain"]:
            return "worktree /tmp/repo"
        raise AssertionError(f"Unexpected command: {command}")

    monkeypatch.setattr("repository_service._run_git", fake_run_git)

    result = get_repository_git_status("repo")

    assert result["aheadBehind"] == {"ahead": 1, "behind": 2}
    assert result["lineStats"] == {"green": 4, "red": 1}
    assert result["diff"] == [{"path": "src/local.py", "green": 10, "red": 8}]
