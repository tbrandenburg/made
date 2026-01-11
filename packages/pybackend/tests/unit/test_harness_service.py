import os
from pathlib import Path

import pytest

from harness_service import is_process_running, list_harnesses, run_harness


def write_harness_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.fixture
def temp_env(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    made_home = tmp_path / "made_home"
    user_home = tmp_path / "user_home"
    workspace.mkdir()
    made_home.mkdir()
    user_home.mkdir()

    monkeypatch.setenv("MADE_HOME", str(made_home))
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(workspace))
    monkeypatch.setattr(Path, "home", lambda: user_home)
    return workspace, made_home, user_home


def test_list_harnesses_collects_all_locations(temp_env):
    workspace, made_home, user_home = temp_env
    repo_path = workspace / "sample-repo"
    repo_harness = repo_path / ".opencode" / "harness" / "repo.sh"
    workspace_harness = workspace / ".harness" / "workspace.sh"
    made_harness = made_home / ".harness" / "made.sh"
    user_harness = user_home / ".opencode" / "harness" / "user.sh"

    for path in [
        repo_path / ".opencode" / "harness",
        workspace / ".harness",
        made_home / ".harness",
        user_home / ".opencode" / "harness",
    ]:
        path.mkdir(parents=True, exist_ok=True)

    write_harness_file(repo_harness, "echo repo")
    write_harness_file(workspace_harness, "echo workspace")
    write_harness_file(made_harness, "echo made")
    write_harness_file(user_harness, "echo user")

    harnesses = list_harnesses("sample-repo")

    names = {harness["name"] for harness in harnesses}
    assert names == {"repo", "workspace", "made", "user"}


def test_run_harness_starts_process(temp_env):
    workspace, _, _ = temp_env
    repo_path = workspace / "runner"
    harness_path = repo_path / ".harness" / "sleepy.sh"
    harness_path.parent.mkdir(parents=True, exist_ok=True)
    write_harness_file(harness_path, "sleep 0.2")

    result = run_harness("runner", str(harness_path))

    assert "pid" in result
    assert result["name"] == "sleepy"
    assert result["path"].endswith("sleepy.sh")
    assert is_process_running(result["pid"]) is True
    os.waitpid(result["pid"], 0)


def test_run_harness_accepts_arguments(temp_env):
    workspace, _, _ = temp_env
    repo_path = workspace / "runner"
    harness_path = repo_path / ".harness" / "touchy.sh"
    output_path = repo_path / "output.txt"
    harness_path.parent.mkdir(parents=True, exist_ok=True)
    write_harness_file(harness_path, 'echo "$2" > "$1"')

    result = run_harness("runner", str(harness_path), f"{output_path} success")

    os.waitpid(result["pid"], 0)
    assert output_path.read_text(encoding="utf-8").strip() == "success"


def test_run_harness_accepts_multiline_argument(temp_env):
    workspace, _, _ = temp_env
    repo_path = workspace / "runner"
    harness_path = repo_path / ".harness" / "multiline.sh"
    output_path = repo_path / "output.txt"
    harness_path.parent.mkdir(parents=True, exist_ok=True)
    write_harness_file(harness_path, 'printf "%s" "$1" > "$2"')

    multiline_value = "line1\nline2"
    result = run_harness(
        "runner",
        str(harness_path),
        f'"{multiline_value}" "{output_path}"',
    )

    os.waitpid(result["pid"], 0)
    assert output_path.read_text(encoding="utf-8") == multiline_value


def test_is_process_running_handles_invalid_pid():
    assert is_process_running(-1) is False
