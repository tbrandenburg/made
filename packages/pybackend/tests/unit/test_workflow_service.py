from pathlib import Path
from unittest.mock import patch

import yaml

from workflow_service import _normalize_payload, list_workspace_workflows, read_workflows, write_workflows


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
# read_workflows — single-file
# ---------------------------------------------------------------------------


def test_read_workflows_does_not_expose_source_file(tmp_path):
    """Regression test for #541: sourceFile must never appear in API response."""
    (tmp_path / "workflows.yml").write_text(
        yaml.safe_dump({"workflows": [{"id": "wf_1", "name": "Solo", "enabled": False, "schedule": None, "steps": []}]})
    )
    with patch("workflow_service._workflow_path", return_value=tmp_path / "workflows.yml"):
        result = read_workflows()
    assert "sourceFile" not in result["workflows"][0]


def test_read_workflows_single_file(tmp_path):
    (tmp_path / "workflows.yml").write_text(
        yaml.safe_dump({"workflows": [{"id": "wf_1", "name": "Solo", "enabled": False, "schedule": None, "steps": []}]})
    )

    with patch("workflow_service._workflow_path", return_value=tmp_path / "workflows.yml"):
        result = read_workflows()

    assert len(result["workflows"]) == 1
    assert result["workflows"][0]["id"] == "wf_1"


def test_read_workflows_missing_file_returns_empty(tmp_path):
    with patch("workflow_service._workflow_path", return_value=tmp_path / "workflows.yml"):
        result = read_workflows()
    assert result == {"workflows": []}


def test_read_workflows_malformed_file_returns_empty(tmp_path):
    (tmp_path / "workflows.yml").write_text(": broken yaml: [", encoding="utf-8")
    with patch("workflow_service._workflow_path", return_value=tmp_path / "workflows.yml"):
        result = read_workflows()
    assert result == {"workflows": []}


# ---------------------------------------------------------------------------
# write_workflows — single-file
# ---------------------------------------------------------------------------


def test_write_workflows_writes_to_workflows_yml(tmp_path):
    payload = {
        "workflows": [
            {"id": "wf_1", "name": "Solo", "enabled": False, "schedule": None, "steps": []},
        ]
    }
    with patch("workflow_service._workflow_path", return_value=tmp_path / "workflows.yml"):
        write_workflows(payload)
    content = yaml.safe_load((tmp_path / "workflows.yml").read_text())
    assert content["workflows"][0]["id"] == "wf_1"
    assert "sourceFile" not in content["workflows"][0]


def test_write_workflows_empty_payload_writes_empty_list(tmp_path):
    payload = {"workflows": []}
    with patch("workflow_service._workflow_path", return_value=tmp_path / "workflows.yml"):
        write_workflows(payload)
    content = yaml.safe_load((tmp_path / "workflows.yml").read_text())
    assert content["workflows"] == []
