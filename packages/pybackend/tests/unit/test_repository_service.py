import subprocess
from pathlib import Path

import pytest
import repository_service as _svc


@pytest.fixture(autouse=True)
def clear_git_status_cache():
    _svc._git_status_cache.clear()
    yield
    _svc._git_status_cache.clear()

from repository_service import (
    apply_repository_template,
    clone_repository,
    create_repository_worktree,
    delete_repository,
    get_repository_file_git_details,
    get_repository_git_status,
    get_repository_info,
    list_repository_files,
    list_repository_templates,
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


def test_list_repository_files_follows_symlinked_directory(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    repo_path = workspace / "repo"
    linked_target = tmp_path / "linked-target"
    repo_path.mkdir(parents=True)
    linked_target.mkdir()
    (linked_target / "linked.txt").write_text("linked content", encoding="utf-8")
    (repo_path / "docs-link").symlink_to(linked_target, target_is_directory=True)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    root = list_repository_files("repo")
    assert root["children"] == [
        {
            "name": "docs-link",
            "path": "docs-link",
            "type": "folder",
            "isSymlink": True,
        }
    ]

    linked_tree = list_repository_files("repo", "docs-link")
    assert linked_tree["children"] == [
        {
            "name": "linked.txt",
            "path": "docs-link/linked.txt",
            "type": "file",
            "size": len("linked content"),
        }
    ]


def test_list_repository_files_handles_symlink_loop(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    repo_path = workspace / "repo"
    repo_path.mkdir(parents=True)

    (repo_path / "self").symlink_to(repo_path, target_is_directory=True)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    root = list_repository_files("repo")
    child_names = {c["name"] for c in root["children"]}
    assert "self" in child_names
    self_node = next(c for c in root["children"] if c["name"] == "self")
    assert self_node["type"] == "folder"
    assert self_node.get("isSymlink") is True


def test_list_repository_files_handles_broken_symlink(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    repo_path = workspace / "repo"
    repo_path.mkdir(parents=True)

    (repo_path / "broken.txt").symlink_to(tmp_path / "nonexistent")

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    root = list_repository_files("repo")
    child_names = {c["name"] for c in root["children"]}
    assert "broken.txt" in child_names
    broken_node = next(c for c in root["children"] if c["name"] == "broken.txt")
    assert broken_node["type"] == "file"
    assert broken_node.get("isSymlink") is True


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


def test_get_repository_file_git_details_for_tracked_file(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    _init_local_repo(repo_path)

    readme = repo_path / "README.md"
    readme.write_text("hello\nupdated\n", encoding="utf-8")

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._github_repo", lambda *_: "org/repo")

    result = get_repository_file_git_details("repo", "README.md")

    assert result["tracked"] is True
    assert result["ignored"] is False
    assert result["lineStats"]["green"] >= 1
    assert result["lineCount"] == 2
    assert result["lastCommit"]["link"] is not None
    assert len(result["diffBlocks"]) >= 1
    assert "lineStats" in result["diffBlocks"][0]
    assert "beforeStart" in result["diffBlocks"][0]


def test_get_repository_file_git_details_for_untracked_file(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    _init_local_repo(repo_path)
    notes = repo_path / "NOTES.md"
    notes.write_text("line one\nline two\n", encoding="utf-8")

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._github_repo", lambda *_: None)

    result = get_repository_file_git_details("repo", "NOTES.md")

    assert result["tracked"] is False
    assert result["lineStats"] == {"green": 2, "red": 0}
    assert result["diffBlocks"] == [
        {
            "before": "",
            "after": "line one\nline two\n",
            "beforeStart": 0,
            "beforeCount": 0,
            "afterStart": 1,
            "afterCount": 2,
            "lineStats": {"green": 2, "red": 0},
        }
    ]

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


def test_delete_repository(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    repo_path.mkdir()
    (repo_path / "README.md").write_text("hello", encoding="utf-8")

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)

    result = delete_repository("repo")

    assert result == {"deleted": "repo"}
    assert not repo_path.exists()


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


def test_list_repository_templates(monkeypatch, tmp_path):
    made_home = tmp_path / "made-home"
    templates_dir = made_home / ".made" / "templates"
    (templates_dir / "zeta").mkdir(parents=True)
    (templates_dir / "alpha").mkdir(parents=True)

    monkeypatch.setattr("repository_service.get_made_home", lambda: made_home)

    result = list_repository_templates()

    assert result == ["alpha", "zeta"]


def test_apply_repository_template(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    repo_path = workspace / "repo"
    repo_path.mkdir(parents=True)
    (repo_path / "README.md").write_text("old", encoding="utf-8")

    made_home = tmp_path / "made-home"
    template_dir = made_home / ".made" / "templates" / "starter"
    template_dir.mkdir(parents=True)
    (template_dir / "README.md").write_text("new", encoding="utf-8")
    (template_dir / "src").mkdir()
    (template_dir / "src" / "main.py").write_text("print('x')", encoding="utf-8")

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service.get_made_home", lambda: made_home)

    result = apply_repository_template("repo", "starter")

    assert result == {"repository": "repo", "template": "starter"}
    assert (repo_path / "README.md").read_text(encoding="utf-8") == "new"
    assert (repo_path / "src" / "main.py").read_text(encoding="utf-8") == "print('x')"


def test_get_repository_git_status_cache_hit(monkeypatch, tmp_path):
    import repository_service as svc

    svc._git_status_cache.clear()

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    _init_local_repo(repo_path)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._github_repo", lambda *_: None)

    call_count = 0
    original_get_branch = svc.get_branch_name

    def counting_get_branch(p):
        nonlocal call_count
        call_count += 1
        return original_get_branch(p)

    monkeypatch.setattr("repository_service.get_branch_name", counting_get_branch)

    result1 = svc.get_repository_git_status("repo")
    assert call_count == 1

    result2 = svc.get_repository_git_status("repo")
    assert call_count == 1, "Second call should use cache, not re-execute git calls"
    assert result2 is result1

    svc._git_status_cache.clear()


def test_get_repository_git_status_cache_expires(monkeypatch, tmp_path):
    import time
    import repository_service as svc

    svc._git_status_cache.clear()

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    _init_local_repo(repo_path)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._github_repo", lambda *_: None)

    call_count = 0
    original_get_branch = svc.get_branch_name

    def counting_get_branch(p):
        nonlocal call_count
        call_count += 1
        return original_get_branch(p)

    monkeypatch.setattr("repository_service.get_branch_name", counting_get_branch)

    svc.get_repository_git_status("repo")
    assert call_count == 1

    # Expire the cache entry by backdating the timestamp
    ts, data = svc._git_status_cache["repo"]
    svc._git_status_cache["repo"] = (ts - svc.GIT_STATUS_CACHE_TTL - 1, data)

    svc.get_repository_git_status("repo")
    assert call_count == 2, "Expired cache should trigger re-execution"

    svc._git_status_cache.clear()


def test_invalidate_git_status_cache(monkeypatch, tmp_path):
    import repository_service as svc

    svc._git_status_cache.clear()

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    repo_path = workspace / "repo"
    _init_local_repo(repo_path)

    monkeypatch.setattr("repository_service.get_workspace_home", lambda: workspace)
    monkeypatch.setattr("repository_service._github_repo", lambda *_: None)

    svc.get_repository_git_status("repo")
    assert "repo" in svc._git_status_cache

    svc.invalidate_git_status_cache("repo")
    assert "repo" not in svc._git_status_cache

    # Should not raise on missing key
    svc.invalidate_git_status_cache("nonexistent")

    svc._git_status_cache.clear()
