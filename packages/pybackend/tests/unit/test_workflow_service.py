from pathlib import Path
from unittest.mock import patch

import yaml
from flowsh_cli.models import (
    AgentStep,
    BashStep,
    ForStep,
    ParallelStep,
    VarsStep,
    WhileStep,
    WorkflowParam,
)

from workflow_service import (
    _normalize_payload,
    _normalize_step,
    _normalize_workflow_params,
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


# ---------------------------------------------------------------------------
# round-trip — full flowsh-cli schema surface (#727)
# ---------------------------------------------------------------------------


def test_normalize_payload_round_trips_full_flowsh_schema(tmp_path):
    """Regression test for #727: normalization must not silently drop step
    types (for/while/parallel) or fields (when/params/model/capture/
    expandPrompt/expandFields/dangerouslySkipPermissions/description) that
    flowsh-cli's schema supports."""
    payload = {
        "workflows": [
            {
                "id": "wf_full",
                "name": "Full schema workflow",
                "description": "Exercises every supported field",
                "params": [
                    {"name": "TARGET_ENV", "description": "Target environment", "required": True}
                ],
                "enabled": True,
                "schedule": "0 6 * * *",
                "steps": [
                    {
                        "type": "agent",
                        "name": "run-agent",
                        "when": "$SHOULD_RUN == 1",
                        "prompt": "Do the thing",
                        "agent": "opencode",
                        "model": "claude-sonnet-5",
                        "command": "run",
                        "capture": "AGENT_RESULT",
                        "expandPrompt": True,
                        "expandFields": True,
                        "dangerouslySkipPermissions": True,
                    },
                    {
                        "type": "for",
                        "name": "loop-items",
                        "when": "$ITEMS != ''",
                        "in": "ITEMS",
                        "item": "ITEM",
                        "steps": [{"type": "bash", "run": "echo $ITEM"}],
                    },
                    {
                        "type": "while",
                        "name": "loop-while",
                        "condition": "$COUNT -lt 5",
                        "steps": [{"type": "bash", "run": "echo tick"}],
                    },
                    {
                        "type": "parallel",
                        "name": "run-parallel",
                        "steps": [
                            {"type": "bash", "run": "echo a"},
                            {"type": "bash", "run": "echo b"},
                        ],
                    },
                ],
            }
        ]
    }

    with patch("workflow_service._workflow_path", return_value=tmp_path / "workflows.yml"):
        write_workflows(payload)
        result = read_workflows()

    workflow = result["workflows"][0]
    assert workflow["description"] == "Exercises every supported field"
    assert workflow["params"] == [
        {"name": "TARGET_ENV", "description": "Target environment", "required": True}
    ]

    agent_step, for_step, while_step, parallel_step = workflow["steps"]

    assert agent_step["type"] == "agent"
    assert agent_step["name"] == "run-agent"
    assert agent_step["when"] == "$SHOULD_RUN == 1"
    assert agent_step["model"] == "claude-sonnet-5"
    assert agent_step["capture"] == "AGENT_RESULT"
    assert agent_step["expandPrompt"] is True
    assert agent_step["expandFields"] is True
    assert agent_step["dangerouslySkipPermissions"] is True

    assert for_step["type"] == "for"
    assert for_step["name"] == "loop-items"
    assert for_step["when"] == "$ITEMS != ''"
    assert for_step["in"] == "ITEMS"
    assert for_step["item"] == "ITEM"
    assert for_step["steps"] == [{"type": "bash", "run": "echo $ITEM"}]

    assert while_step["type"] == "while"
    assert while_step["name"] == "loop-while"
    assert while_step["condition"] == "$COUNT -lt 5"
    assert while_step["steps"] == [{"type": "bash", "run": "echo tick"}]

    assert parallel_step["type"] == "parallel"
    assert parallel_step["name"] == "run-parallel"
    assert parallel_step["steps"] == [
        {"type": "bash", "run": "echo a"},
        {"type": "bash", "run": "echo b"},
    ]


# ---------------------------------------------------------------------------
# drift detection — introspects flowsh-cli's real schema at test-run time
# (#739). If flowsh-cli adds a new field to a step model or WorkflowParam in
# a future version bump, this test's own expectations grow automatically
# (they are derived from `model_cls.model_fields`, not hand-copied here) and
# it starts failing until workflow_service.py's normalization is updated to
# preserve that new field.
# ---------------------------------------------------------------------------

# Known-valid sample value per flowsh-cli field name, chosen to satisfy each
# model's own field validators (e.g. `capture` must match ^[A-Z_][A-Z0-9_]*$).
# This is the only hand-maintained part of the test: supplying a value that
# passes validation for a *known* field. The set of fields checked is never
# hand-maintained — it always comes from `model_cls.model_fields`.
_SAMPLE_FIELD_VALUES: dict[str, object] = {
    "name": "step-name",
    "when": "$FLAG == 1",
    "prompt": "Do the thing",
    "agent": "opencode",
    "model": "claude-sonnet-5",
    "command": "run",
    "capture": "AGENT_RESULT",
    "dangerouslySkipPermissions": True,
    "expandPrompt": True,
    "expandFields": True,
    "in_": "ITEMS",
    "item": "ITEM",
    "condition": "$COUNT -lt 5",
    "description": "A workflow parameter",
    "required": True,
}


def _external_key(model_cls, field_name: str) -> str:
    field_info = model_cls.model_fields[field_name]
    alias = field_info.validation_alias
    if isinstance(alias, str):
        return alias
    choices = getattr(alias, "choices", None)
    if choices:
        return choices[0]
    return field_name


def _build_step_payload(model_cls, step_type: str, structural: dict) -> dict:
    payload = {"type": step_type, **structural}
    for field_name in model_cls.model_fields:
        if field_name in ("type", "steps") or field_name in structural:
            continue
        key = _external_key(model_cls, field_name)
        if key in payload:
            continue
        payload[key] = _SAMPLE_FIELD_VALUES[field_name]
    return payload


def test_normalize_step_preserves_every_bash_step_field_from_flowsh_schema():
    payload = _build_step_payload(BashStep, "bash", {"run": "echo hi"})

    normalized = _normalize_step(payload)

    for field_name in BashStep.model_fields:
        if field_name == "type":
            continue
        key = _external_key(BashStep, field_name)
        assert key in normalized, f"BashStep field '{key}' was dropped by normalization"
        assert normalized[key] == payload[key]


def test_normalize_step_preserves_every_vars_step_field_from_flowsh_schema():
    payload = {"type": "vars", "name": "step-name", "when": "$FLAG == 1", "values": {"RELEASE": "echo stable"}}

    normalized = _normalize_step(payload)

    for field_name in VarsStep.model_fields:
        if field_name == "type":
            continue
        key = _external_key(VarsStep, field_name)
        assert key in normalized, f"VarsStep field '{key}' was dropped by normalization"
        assert normalized[key] == payload[key]


def test_normalize_step_preserves_every_agent_step_field_from_flowsh_schema():
    payload = _build_step_payload(AgentStep, "agent", {})

    normalized = _normalize_step(payload)

    for field_name in AgentStep.model_fields:
        if field_name == "type":
            continue
        key = _external_key(AgentStep, field_name)
        assert key in normalized, f"AgentStep field '{key}' was dropped by normalization"
        assert normalized[key] == payload[key]


def test_normalize_step_preserves_every_for_step_field_from_flowsh_schema():
    nested = [{"type": "bash", "run": "echo hi"}]
    payload = _build_step_payload(ForStep, "for", {"steps": nested})

    normalized = _normalize_step(payload)

    for field_name in ForStep.model_fields:
        if field_name == "type":
            continue
        key = _external_key(ForStep, field_name)
        assert key in normalized, f"ForStep field '{key}' was dropped by normalization"
        if key == "steps":
            assert len(normalized[key]) == len(nested)
            continue
        assert normalized[key] == payload[key]


def test_normalize_step_preserves_every_while_step_field_from_flowsh_schema():
    nested = [{"type": "bash", "run": "echo hi"}]
    payload = _build_step_payload(WhileStep, "while", {"steps": nested})

    normalized = _normalize_step(payload)

    for field_name in WhileStep.model_fields:
        if field_name == "type":
            continue
        key = _external_key(WhileStep, field_name)
        assert key in normalized, f"WhileStep field '{key}' was dropped by normalization"
        if key == "steps":
            assert len(normalized[key]) == len(nested)
            continue
        assert normalized[key] == payload[key]


def test_normalize_step_preserves_every_parallel_step_field_from_flowsh_schema():
    nested = [{"type": "bash", "run": "echo a"}, {"type": "bash", "run": "echo b"}]
    payload = _build_step_payload(ParallelStep, "parallel", {"steps": nested})

    normalized = _normalize_step(payload)

    for field_name in ParallelStep.model_fields:
        if field_name == "type":
            continue
        key = _external_key(ParallelStep, field_name)
        assert key in normalized, f"ParallelStep field '{key}' was dropped by normalization"
        if key == "steps":
            assert len(normalized[key]) == len(nested)
            continue
        assert normalized[key] == payload[key]


def test_normalize_workflow_params_preserves_every_workflow_param_field_from_flowsh_schema():
    payload = [_build_step_payload(WorkflowParam, "", {"name": "TARGET_ENV"})]
    payload[0].pop("type", None)

    normalized = _normalize_workflow_params({"params": payload})

    assert len(normalized) == 1
    for field_name in WorkflowParam.model_fields:
        key = _external_key(WorkflowParam, field_name)
        assert key in normalized[0], f"WorkflowParam field '{key}' was dropped by normalization"
        assert normalized[0][key] == payload[0][key]
