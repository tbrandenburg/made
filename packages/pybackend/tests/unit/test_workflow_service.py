from pathlib import Path
from unittest.mock import MagicMock, patch

import yaml

from workflow_service import (
    _normalize_payload,
    _normalize_workflow,
    _workflow_paths,
    list_workspace_workflows,
    read_workflows,
    write_workflows,
)


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


# ── _workflow_paths ──────────────────────────────────────────────────────────


@patch("workflow_service._workflow_dir")
def test_workflow_paths_returns_empty_when_dir_missing(mock_dir):
    mock_path = MagicMock(spec=Path)
    mock_path.exists.return_value = False
    mock_dir.return_value = mock_path
    assert _workflow_paths() == []


@patch("workflow_service._workflow_dir")
def test_workflow_paths_orders_workflows_yml_first(mock_dir, tmp_path):
    # Create real yml files so sorted() and Path operations work naturally
    (tmp_path / "zeta.yml").write_text("workflows: []")
    (tmp_path / "alpha.yml").write_text("workflows: []")
    (tmp_path / "workflows.yml").write_text("workflows: []")
    mock_dir.return_value = tmp_path

    result = _workflow_paths()

    assert len(result) == 3
    assert result[0].name == "workflows.yml"
    assert result[1].name == "alpha.yml"
    assert result[2].name == "zeta.yml"


# ── _normalize_workflow ──────────────────────────────────────────────────────


def test_normalize_workflow_preserves_source_file():
    wf = {
        "id": "wf_1",
        "name": "Test",
        "enabled": False,
        "schedule": None,
        "steps": [],
        "sourceFile": "my-team.yml",
    }
    result = _normalize_workflow(wf, 0)
    assert result is not None
    assert result["sourceFile"] == "my-team.yml"


def test_normalize_workflow_omits_source_file_when_absent():
    wf = {"id": "wf_1", "name": "Test", "enabled": False, "schedule": None, "steps": []}
    result = _normalize_workflow(wf, 0)
    assert result is not None
    assert "sourceFile" not in result


# ── read_workflows ───────────────────────────────────────────────────────────


@patch("workflow_service._workflow_paths")
def test_read_workflows_returns_empty_when_no_files(mock_paths):
    mock_paths.return_value = []
    assert read_workflows() == {"workflows": []}


@patch("workflow_service._workflow_paths")
def test_read_workflows_attaches_source_file_from_each_yml(mock_paths, tmp_path):
    file_a = tmp_path / "alpha.yml"
    file_a.write_text(
        yaml.safe_dump({"workflows": [{"id": "wf_a", "name": "A", "enabled": False, "schedule": None, "steps": []}]}),
        encoding="utf-8",
    )
    file_b = tmp_path / "workflows.yml"
    file_b.write_text(
        yaml.safe_dump({"workflows": [{"id": "wf_b", "name": "B", "enabled": True, "schedule": None, "steps": []}]}),
        encoding="utf-8",
    )
    mock_paths.return_value = [file_b, file_a]  # workflows.yml first

    result = read_workflows()

    assert len(result["workflows"]) == 2
    assert result["workflows"][0]["id"] == "wf_b"
    assert result["workflows"][0]["sourceFile"] == "workflows.yml"
    assert result["workflows"][1]["id"] == "wf_a"
    assert result["workflows"][1]["sourceFile"] == "alpha.yml"


@patch("workflow_service._workflow_paths")
def test_read_workflows_single_file_backward_compat(mock_paths, tmp_path):
    wf_file = tmp_path / "workflows.yml"
    wf_file.write_text(
        yaml.safe_dump({"workflows": [{"id": "wf_1", "name": "Solo", "enabled": False, "schedule": None, "steps": []}]}),
        encoding="utf-8",
    )
    mock_paths.return_value = [wf_file]

    result = read_workflows()

    assert len(result["workflows"]) == 1
    assert result["workflows"][0]["id"] == "wf_1"
    assert result["workflows"][0]["sourceFile"] == "workflows.yml"


# ── write_workflows ──────────────────────────────────────────────────────────


@patch("workflow_service._workflow_dir")
def test_write_workflows_splits_by_source_file(mock_dir, tmp_path):
    mock_dir.return_value = tmp_path

    payload = {
        "workflows": [
            {"id": "wf_a", "name": "A", "enabled": False, "schedule": None, "steps": [], "sourceFile": "alpha.yml"},
            {"id": "wf_b", "name": "B", "enabled": False, "schedule": None, "steps": [], "sourceFile": "workflows.yml"},
        ]
    }
    write_workflows(payload)

    alpha = yaml.safe_load((tmp_path / "alpha.yml").read_text())
    assert len(alpha["workflows"]) == 1
    assert alpha["workflows"][0]["id"] == "wf_a"
    assert "sourceFile" not in alpha["workflows"][0]

    default = yaml.safe_load((tmp_path / "workflows.yml").read_text())
    assert len(default["workflows"]) == 1
    assert default["workflows"][0]["id"] == "wf_b"
    assert "sourceFile" not in default["workflows"][0]


@patch("workflow_service._workflow_dir")
@patch("workflow_service._workflow_path")
def test_write_workflows_defaults_to_workflows_yml_when_no_source_file(mock_path, mock_dir, tmp_path):
    wf_path = tmp_path / "workflows.yml"
    mock_path.return_value = wf_path
    mock_dir.return_value = tmp_path

    payload = {
        "workflows": [
            {"id": "wf_1", "name": "Legacy", "enabled": False, "schedule": None, "steps": []}
        ]
    }
    write_workflows(payload)

    written = yaml.safe_load(wf_path.read_text())
    assert written["workflows"][0]["id"] == "wf_1"
    assert "sourceFile" not in written["workflows"][0]


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


# ── write_workflows — path traversal guard ──────────────────────────────────


@patch("workflow_service._workflow_dir")
def test_write_workflows_rejects_path_traversal_in_source_file(mock_dir, tmp_path):
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

    try:
        write_workflows(payload)
        assert False, "Expected ValueError for path traversal in sourceFile"
    except ValueError as exc:
        assert "sourceFile" in str(exc).lower() or "invalid" in str(exc).lower()
