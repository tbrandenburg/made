from pathlib import Path
from unittest.mock import patch

import yaml

from workflow_service import _normalize_payload, _normalize_workflow, _safe_workflow_filename, _workflow_paths, list_workspace_workflows, read_workflows, write_workflows


def test_normalize_payload_keeps_shell_script_path():
    payload = {
        "workflows": [
            {
                "id": "wf_1",
                "name": "Release",
                "enabled": False,
                "schedule": "0 5 * * *",
                "shellScriptPath": "  .harness/release.sh  ",
                "steps": [{"type": "bash", "run": "echo done"}],
            }
        ]
    }

    result = _normalize_payload(payload)

    assert result == {
        "workflows": [
            {
                "id": "wf_1",
                "name": "Release",
                "enabled": False,
                "schedule": "0 5 * * *",
                "shellScriptPath": ".harness/release.sh",
                "steps": [{"type": "bash", "run": "echo done"}],
            }
        ]
    }


def test_normalize_payload_defaults_enabled_false_when_missing():
    payload = {
        "workflows": [
            {
                "id": "wf_1",
                "name": "Release",
                "steps": [],
            }
        ]
    }

    result = _normalize_payload(payload)

    assert result["workflows"][0]["enabled"] is False


def test_normalize_payload_keeps_vars_steps():
    payload = {
        "workflows": [
            {
                "id": "wf_1",
                "name": "Vars Workflow",
                "steps": [
                    {
                        "type": "vars",
                        "varName": "  RELEASE_CHANNEL  ",
                        "run": " stable ",
                        "values": {" RELEASE_CHANNEL ": " stable ", "": "ignore"},
                    }
                ],
            }
        ]
    }

    result = _normalize_payload(payload)

    assert result["workflows"][0]["steps"] == [
        {
            "type": "vars",
            "values": {"RELEASE_CHANNEL": "stable"},
        }
    ]


def test_normalize_payload_omits_empty_shell_script_path():
    payload = {
        "workflows": [
            {
                "id": "wf_1",
                "name": "Release",
                "shellScriptPath": "   ",
                "steps": [],
            }
        ]
    }

    result = _normalize_payload(payload)

    assert result["workflows"][0].get("shellScriptPath") is None


@patch("workflow_service.read_workflows")
@patch("workflow_service.list_scheduled_tasks")
@patch("workflow_service.get_workspace_home")
def test_list_workspace_workflows_collects_repository_workflows(
    mock_workspace_home, mock_list_scheduled_tasks, mock_read_workflows
):
    mock_workspace_home.return_value = Path("/workspace/home")

    repos = [Path("/workspace/home/repo-a"), Path("/workspace/home/repo-b")]
    file_entry = Path("/workspace/home/README.md")

    with patch.object(Path, "iterdir", return_value=[*repos, file_entry]), patch.object(
        Path, "is_dir", side_effect=[True, True, False]
    ):
        mock_read_workflows.side_effect = [
            {"workflows": [{"id": "wf_a", "name": "A", "enabled": True, "schedule": "* * * * *"}]},
            {"workflows": []},
        ]

        result = list_workspace_workflows(
            {"repo-a:wf_a": "2026-01-02T03:04:05+00:00"},
            {"repo-a:wf_a": {"lastExitCode": 0, "running": False}},
        )

    assert result == {
        "workflows": [
            {
                "repository": "repo-a",
                "id": "wf_a",
                "name": "A",
                "enabled": True,
                "schedule": "* * * * *",
                "shellScriptPath": None,
                "lastRun": "2026-01-02T03:04:05+00:00",
                "diagnostics": {"lastExitCode": 0, "running": False},
            }
        ]
    }


@patch("workflow_service.read_workflows")
@patch("workflow_service.list_scheduled_tasks")
@patch("workflow_service.get_workspace_home")
def test_list_workspace_workflows_skips_git_worktrees(
    mock_workspace_home, mock_list_scheduled_tasks, mock_read_workflows
):
    mock_workspace_home.return_value = Path("/workspace/home")

    repo = Path("/workspace/home/repo-a")
    worktree = Path("/workspace/home/repo-a-feature")

    with patch.object(Path, "iterdir", return_value=[repo, worktree]), patch.object(
        Path, "is_dir", return_value=True
    ), patch.object(Path, "is_file", side_effect=[False, True]):
        mock_read_workflows.return_value = {
            "workflows": [
                {"id": "wf_a", "name": "A", "enabled": True, "schedule": "* * * * *"}
            ]
        }

        result = list_workspace_workflows()

    assert result == {
        "workflows": [
            {
                "repository": "repo-a",
                "id": "wf_a",
                "name": "A",
                "enabled": True,
                "schedule": "* * * * *",
                "shellScriptPath": None,
                "lastRun": None,
                "diagnostics": None,
            }
        ]
    }
    mock_read_workflows.assert_called_once_with("repo-a")


@patch("workflow_service.read_workflows")
@patch("workflow_service.list_scheduled_tasks")
@patch("workflow_service.get_workspace_home")
def test_list_workspace_workflows_includes_scheduled_tasks(
    mock_workspace_home, mock_list_scheduled_tasks, mock_read_workflows
):
    mock_workspace_home.return_value = Path("/workspace/home")

    with patch.object(Path, "iterdir", return_value=[]):
        mock_read_workflows.return_value = {"workflows": []}
        mock_list_scheduled_tasks.return_value = [
            {
                "name": "daily-report.md",
                "schedule": "0 8 * * 1",
            }
        ]

        result = list_workspace_workflows(
            {"task:daily-report.md": "2026-01-02T03:04:05+00:00"},
            {"task:daily-report.md": {"lastExitCode": 0, "running": False}},
        )

    assert result == {
        "workflows": [
            {
                "repository": ".made/tasks",
                "id": "task:daily-report.md",
                "name": "daily-report.md",
                "enabled": True,
                "schedule": "0 8 * * 1",
                "shellScriptPath": None,
                "lastRun": "2026-01-02T03:04:05+00:00",
                "diagnostics": {"lastExitCode": 0, "running": False},
            }
        ]
    }


# ---------------------------------------------------------------------------
# _workflow_paths
# ---------------------------------------------------------------------------


def test_workflow_paths_workflows_yml_first(tmp_path):
    (tmp_path / "b-team.yml").write_text("workflows: []")
    (tmp_path / "workflows.yml").write_text("workflows: []")
    (tmp_path / "a-team.yml").write_text("workflows: []")

    with patch("workflow_service._workflow_dir", return_value=tmp_path):
        paths = _workflow_paths()

    names = [p.name for p in paths]
    assert names[0] == "workflows.yml"
    assert names[1:] == sorted(names[1:])


def test_workflow_paths_no_directory_returns_empty(tmp_path):
    missing = tmp_path / "nonexistent"
    with patch("workflow_service._workflow_dir", return_value=missing):
        assert _workflow_paths() == []


def test_workflow_paths_no_yml_files_returns_empty(tmp_path):
    (tmp_path / "readme.md").write_text("hi")
    with patch("workflow_service._workflow_dir", return_value=tmp_path):
        assert _workflow_paths() == []


# ---------------------------------------------------------------------------
# _normalize_workflow — sourceFile passthrough
# ---------------------------------------------------------------------------


def test_normalize_workflow_preserves_source_file():
    wf = {
        "id": "wf_1",
        "name": "Test",
        "enabled": True,
        "schedule": None,
        "steps": [],
        "sourceFile": "my-team.yml",
    }
    result = _normalize_workflow(wf, 0)
    assert result is not None
    assert result["sourceFile"] == "my-team.yml"


def test_normalize_workflow_no_source_file_omitted():
    wf = {"id": "wf_1", "name": "Test", "enabled": False, "schedule": None, "steps": []}
    result = _normalize_workflow(wf, 0)
    assert result is not None
    assert "sourceFile" not in result


# ---------------------------------------------------------------------------
# read_workflows — multi-file aggregation
# ---------------------------------------------------------------------------


def test_read_workflows_aggregates_multiple_files(tmp_path):
    (tmp_path / "workflows.yml").write_text(
        yaml.safe_dump({"workflows": [{"id": "wf_a", "name": "A", "enabled": False, "schedule": None, "steps": []}]})
    )
    (tmp_path / "team.yml").write_text(
        yaml.safe_dump({"workflows": [{"id": "wf_b", "name": "B", "enabled": False, "schedule": None, "steps": []}]})
    )

    with patch("workflow_service._workflow_dir", return_value=tmp_path):
        result = read_workflows()

    ids = [wf["id"] for wf in result["workflows"]]
    assert "wf_a" in ids
    assert "wf_b" in ids

    sources = {wf["id"]: wf["sourceFile"] for wf in result["workflows"]}
    assert sources["wf_a"] == "workflows.yml"
    assert sources["wf_b"] == "team.yml"


def test_read_workflows_single_file_backward_compat(tmp_path):
    (tmp_path / "workflows.yml").write_text(
        yaml.safe_dump({"workflows": [{"id": "wf_1", "name": "Solo", "enabled": False, "schedule": None, "steps": []}]})
    )

    with patch("workflow_service._workflow_dir", return_value=tmp_path):
        result = read_workflows()

    assert len(result["workflows"]) == 1
    assert result["workflows"][0]["id"] == "wf_1"
    assert result["workflows"][0]["sourceFile"] == "workflows.yml"


def test_read_workflows_empty_directory_returns_empty(tmp_path):
    with patch("workflow_service._workflow_dir", return_value=tmp_path):
        result = read_workflows()
    assert result == {"workflows": []}


# ---------------------------------------------------------------------------
# write_workflows — per-file write-back
# ---------------------------------------------------------------------------


def test_write_workflows_per_file_writeback(tmp_path):
    payload = {
        "workflows": [
            {"id": "wf_a", "name": "A", "enabled": False, "schedule": None, "steps": [], "sourceFile": "workflows.yml"},
            {"id": "wf_b", "name": "B", "enabled": False, "schedule": None, "steps": [], "sourceFile": "team.yml"},
        ]
    }

    with patch("workflow_service._workflow_dir", return_value=tmp_path):
        write_workflows(payload)

    default_content = yaml.safe_load((tmp_path / "workflows.yml").read_text())
    team_content = yaml.safe_load((tmp_path / "team.yml").read_text())

    assert [wf["id"] for wf in default_content["workflows"]] == ["wf_a"]
    assert [wf["id"] for wf in team_content["workflows"]] == ["wf_b"]

    # sourceFile must NOT appear in the written YAML
    assert "sourceFile" not in default_content["workflows"][0]
    assert "sourceFile" not in team_content["workflows"][0]


def test_write_workflows_defaults_to_workflows_yml_when_no_source_file(tmp_path):
    payload = {
        "workflows": [
            {"id": "wf_1", "name": "Solo", "enabled": False, "schedule": None, "steps": []},
        ]
    }

    with patch("workflow_service._workflow_dir", return_value=tmp_path):
        write_workflows(payload)

    content = yaml.safe_load((tmp_path / "workflows.yml").read_text())
    assert content["workflows"][0]["id"] == "wf_1"
    assert not (tmp_path / "team.yml").exists()


# ---------------------------------------------------------------------------
# _safe_workflow_filename — path traversal guard
# ---------------------------------------------------------------------------


def test_safe_workflow_filename_rejects_traversal():
    assert _safe_workflow_filename("../../evil.yml") == "workflows.yml"
    assert _safe_workflow_filename("/etc/cron.d/evil") == "workflows.yml"
    assert _safe_workflow_filename("../sibling/hack.yml") == "workflows.yml"


def test_safe_workflow_filename_rejects_non_yml():
    assert _safe_workflow_filename("evil.sh") == "workflows.yml"
    assert _safe_workflow_filename("evil.yaml") == "workflows.yml"


def test_safe_workflow_filename_accepts_valid_names():
    assert _safe_workflow_filename("team-a.yml") == "team-a.yml"
    assert _safe_workflow_filename("workflows.yml") == "workflows.yml"
    assert _safe_workflow_filename("my_workflows_2.yml") == "my_workflows_2.yml"


def test_safe_workflow_filename_defaults_for_none_or_empty():
    assert _safe_workflow_filename(None) == "workflows.yml"
    assert _safe_workflow_filename("") == "workflows.yml"


# ---------------------------------------------------------------------------
# write_workflows — clears orphaned secondary files on delete
# ---------------------------------------------------------------------------


def test_write_workflows_clears_secondary_file_when_all_its_workflows_deleted(tmp_path):
    # Pre-existing team.yml on disk
    (tmp_path / "team.yml").write_text(
        yaml.safe_dump({"workflows": [{"id": "wf_b", "name": "B", "enabled": False, "schedule": None, "steps": []}]})
    )

    # Payload only contains wf_a — wf_b was deleted by user
    payload = {
        "workflows": [
            {"id": "wf_a", "name": "A", "enabled": False, "schedule": None, "steps": [], "sourceFile": "workflows.yml"},
        ]
    }

    with patch("workflow_service._workflow_dir", return_value=tmp_path):
        write_workflows(payload)

    # team.yml must exist but be empty
    team_content = yaml.safe_load((tmp_path / "team.yml").read_text())
    assert team_content["workflows"] == []
    # wf_a still in workflows.yml
    default_content = yaml.safe_load((tmp_path / "workflows.yml").read_text())
    assert default_content["workflows"][0]["id"] == "wf_a"


# ---------------------------------------------------------------------------
# write_workflows — path traversal guard (sourceFile sanitised, not raised)
# ---------------------------------------------------------------------------


@patch("workflow_service._workflow_dir")
def test_write_workflows_sanitises_path_traversal_in_source_file(mock_dir, tmp_path):
    """_safe_workflow_filename silently maps traversal inputs to workflows.yml."""
    mock_dir.return_value = tmp_path

    payload = {
        "workflows": [
            {
                "id": "wf_evil",
                "name": "Evil",
                "enabled": False,
                "schedule": None,
                "steps": [],
                "sourceFile": "../../evil.yml",
            }
        ]
    }

    write_workflows(payload)

    # Must NOT have created any file outside tmp_path
    assert not (tmp_path / "../../evil.yml").exists()
    # The workflow must have been written to the safe fallback instead
    safe_path = tmp_path / "workflows.yml"
    assert safe_path.exists()
    content = yaml.safe_load(safe_path.read_text())
    assert content["workflows"][0]["id"] == "wf_evil"


# ---------------------------------------------------------------------------
# write_workflows — non-workflow .yml files must never be touched
# ---------------------------------------------------------------------------


def test_write_workflows_does_not_overwrite_non_workflow_yml(tmp_path):
    """A *.yml file without a top-level 'workflows' key must never be modified."""
    original_content = {"agents": [{"name": "codex"}]}
    (tmp_path / "agents.yml").write_text(yaml.safe_dump(original_content))

    payload = {"workflows": []}

    with patch("workflow_service._workflow_dir", return_value=tmp_path):
        write_workflows(payload)

    # agents.yml must be completely untouched
    result = yaml.safe_load((tmp_path / "agents.yml").read_text())
    assert result == original_content
