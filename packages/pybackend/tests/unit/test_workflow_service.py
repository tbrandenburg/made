from pathlib import Path
from unittest.mock import patch

from workflow_service import _normalize_payload, list_workspace_workflows


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
@patch("workflow_service.get_workspace_home")
def test_list_workspace_workflows_collects_repository_workflows(
    mock_workspace_home, mock_read_workflows
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

        result = list_workspace_workflows({"repo-a:wf_a": "2026-01-02T03:04:05+00:00"})

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
            }
        ]
    }
