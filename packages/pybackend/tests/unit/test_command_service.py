from pathlib import Path

import frontmatter
import pytest

from command_service import list_commands


def write_command_file(path: Path, description: str | None, argument_hint: str | None, content: str):
    metadata = {}
    if description:
        metadata["description"] = description
    if argument_hint:
        metadata["argument-hint"] = argument_hint
    post = frontmatter.Post(content, **metadata)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(frontmatter.dumps(post), encoding="utf-8")


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


def test_list_commands_collects_all_locations(temp_env):
    workspace, made_home, user_home = temp_env
    repo_path = workspace / "sample-repo"
    repo_command = repo_path / ".hidden" / "commands" / "repo.md"
    workspace_command = workspace / ".made" / "commands" / "workspace.md"
    made_command = made_home / ".made" / "commands" / "made.md"
    user_command = user_home / ".made" / "commands" / "user.md"
    codex_command = user_home / ".codex" / "commands" / "codex.md"
    kiro_command = user_home / ".kiro" / "commands" / "kiro.md"
    opencode_command = user_home / ".opencode" / "command" / "opencode.md"

    for path in [
        repo_path,
        workspace / ".made" / "commands",
        made_home / ".made" / "commands",
        user_home / ".made" / "commands",
        user_home / ".codex" / "commands",
        user_home / ".kiro" / "commands",
        user_home / ".opencode" / "command",
    ]:
        path.mkdir(parents=True, exist_ok=True)

    write_command_file(repo_command, "Repo command", "[name]", "echo $1")
    write_command_file(workspace_command, None, None, "workspace content")
    write_command_file(made_command, "Made command", "[arg]", "run $1")
    write_command_file(user_command, "User command", None, "say hi")
    write_command_file(codex_command, None, "[num]", "count $1")
    write_command_file(kiro_command, None, None, "kiro content")
    write_command_file(opencode_command, None, None, "opencode content")

    commands = list_commands("sample-repo")

    assert len(commands) == 7
    descriptions = {command["description"] for command in commands}
    assert "Repo command" in descriptions
    assert "workspace" in descriptions
    assert "Made command" in descriptions
    assert "User command" in descriptions
    assert "codex" in descriptions
    assert "kiro" in descriptions
    assert "opencode" in descriptions

    repo_entry = next(cmd for cmd in commands if cmd["name"] == "repo")
    assert repo_entry["argumentHint"] == "[name]"
    assert repo_entry["content"] == "echo $1"


def test_description_defaults_to_stem(temp_env):
    workspace, made_home, user_home = temp_env
    repo_path = workspace / "stem-repo"
    command_path = repo_path / ".cmds" / "commands" / "no-meta.md"
    command_path.parent.mkdir(parents=True, exist_ok=True)
    command_path.write_text("Plain content", encoding="utf-8")

    commands = list_commands("stem-repo")

    assert len(commands) == 1
    assert commands[0]["description"] == "no-meta"
    assert commands[0]["content"] == "Plain content"
