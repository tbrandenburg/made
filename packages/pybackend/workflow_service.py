from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml
from flowsh_cli.models import (
    AgentStep,
    BaseStep,
    WorkflowParam as FlowshWorkflowParam,
)
from pydantic import AliasChoices
from pydantic.fields import FieldInfo

from config import ensure_directory, get_made_directory, get_workspace_home
from task_service import list_scheduled_tasks

logger = logging.getLogger(__name__)

DEFAULT_WORKFLOW_NAME = "New workflow"

# Fields handled structurally elsewhere (required-field checks, nested
# steps, dict-shaped values) rather than by the generic scalar/bool copier
# below. Everything NOT in this set is derived directly from flowsh-cli's
# own pydantic models, so a future flowsh-cli field addition flows through
# `_copy_model_fields` automatically without a hand edit here.
_COMMON_STEP_SKIP = {"type"}
_AGENT_STEP_SKIP = {"type", "prompt"}
_WORKFLOW_PARAM_SKIP = {"name", "required"}


def _field_external_key(field_name: str, field_info: FieldInfo) -> str:
    """Resolve the wire-format (YAML/JSON) key for a pydantic field.

    Mirrors flowsh-cli's own aliasing (e.g. ForStep.in_ -> "in") so made's
    normalized dicts use the same keys flowsh-cli's schema expects.
    """
    alias = field_info.validation_alias
    if isinstance(alias, str):
        return alias
    if isinstance(alias, AliasChoices) and alias.choices:
        first_choice = alias.choices[0]
        if isinstance(first_choice, str):
            return first_choice
    return field_name


def _copy_model_fields(
    model_cls: type,
    source: dict[str, Any],
    target: dict[str, Any],
    skip: set[str],
) -> None:
    """Copy simple str/bool fields declared on `model_cls` from `source` into
    `target`, deriving the field set from flowsh-cli's own pydantic model
    (`model_cls.model_fields`) instead of a hand-maintained list. This is the
    mechanism that keeps made's normalization coupled to flowsh-cli's schema:
    a field added to a flowsh-cli step/param model is picked up here without
    a corresponding manual edit in made.
    """
    for field_name, field_info in model_cls.model_fields.items():
        if field_name in skip:
            continue
        key = _field_external_key(field_name, field_info)
        if field_info.annotation is bool:
            if _as_bool(source.get(key)):
                target[key] = True
            continue
        value = _as_string(source.get(key))
        if value:
            target[key] = value


def _workflow_path(repo_name: str | None = None) -> Path:
    if repo_name:
        base_path = get_workspace_home() / repo_name
    else:
        base_path = get_made_directory()
    workflow_dir = ensure_directory(base_path / ".made") if repo_name else base_path
    return workflow_dir / "workflows.yml"


def _as_string(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    return None


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _normalize_common_step_fields(
    step: dict[str, Any], normalized: dict[str, Any]
) -> None:
    """Copy step fields common to every step type (name, when).

    Field set is derived from flowsh-cli's own `BaseStep` model so a future
    common field addition there is picked up automatically.
    """
    _copy_model_fields(BaseStep, step, normalized, _COMMON_STEP_SKIP)


def _normalize_nested_steps(step: dict[str, Any]) -> list[dict[str, Any]]:
    raw_steps = step.get("steps")
    nested: list[dict[str, Any]] = []
    if isinstance(raw_steps, list):
        for raw_step in raw_steps:
            normalized_step = _normalize_step(raw_step)
            if normalized_step:
                nested.append(normalized_step)
    return nested


def _normalize_step(step: Any) -> dict[str, Any]:
    if not isinstance(step, dict):
        return {}
    step_type = _as_string(step.get("type"))
    if step_type == "bash":
        run = _as_string(step.get("run"))
        normalized: dict[str, Any] = {"type": "bash", "run": run or ""}
        _normalize_common_step_fields(step, normalized)
        return normalized
    if step_type == "agent":
        normalized = {"type": "agent"}
        prompt = _as_string(step.get("prompt"))
        if prompt:
            normalized["prompt"] = prompt
        # agent/command/model/capture/expandPrompt/expandFields/
        # dangerouslySkipPermissions are all derived from AgentStep's own
        # pydantic field list, not hand-copied one-by-one.
        _copy_model_fields(AgentStep, step, normalized, _AGENT_STEP_SKIP)
        _normalize_common_step_fields(step, normalized)
        return normalized
    if step_type == "vars":
        var_name = _as_string(step.get("varName"))
        run = _as_string(step.get("run"))
        raw_values = step.get("values")
        values: dict[str, str] = {}
        if isinstance(raw_values, dict):
            for key, value in raw_values.items():
                normalized_key = _as_string(key)
                normalized_value = _as_string(value)
                if normalized_key and normalized_value is not None:
                    values[normalized_key] = normalized_value
        if var_name and run is not None and var_name not in values:
            values[var_name] = run
        normalized = {"type": "vars"}
        if values:
            normalized["values"] = values
        _normalize_common_step_fields(step, normalized)
        return normalized
    if step_type == "for":
        in_var = _as_string(step.get("in"))
        item = _as_string(step.get("item"))
        nested_steps = _normalize_nested_steps(step)
        if not (in_var and item and nested_steps):
            return {}
        normalized = {"type": "for", "in": in_var, "item": item, "steps": nested_steps}
        _normalize_common_step_fields(step, normalized)
        return normalized
    if step_type == "while":
        condition = _as_string(step.get("condition"))
        nested_steps = _normalize_nested_steps(step)
        if not (condition and nested_steps):
            return {}
        normalized = {"type": "while", "condition": condition, "steps": nested_steps}
        _normalize_common_step_fields(step, normalized)
        return normalized
    if step_type == "parallel":
        nested_steps = _normalize_nested_steps(step)
        if not nested_steps:
            return {}
        normalized = {"type": "parallel", "steps": nested_steps}
        _normalize_common_step_fields(step, normalized)
        return normalized
    return {}


def _normalize_workflow_params(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    raw_params = workflow.get("params")
    params: list[dict[str, Any]] = []
    if not isinstance(raw_params, list):
        return params
    for raw_param in raw_params:
        if not isinstance(raw_param, dict):
            continue
        name = _as_string(raw_param.get("name"))
        if not name:
            continue
        param: dict[str, Any] = {"name": name}
        # description is derived from WorkflowParam's own field list.
        _copy_model_fields(FlowshWorkflowParam, raw_param, param, _WORKFLOW_PARAM_SKIP)
        param["required"] = _as_bool(raw_param.get("required"), default=False)
        params.append(param)
    return params


def _normalize_workflow(workflow: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(workflow, dict):
        return None
    workflow_id = _as_string(workflow.get("id")) or f"workflow_{index + 1}"
    name = _as_string(workflow.get("name")) or DEFAULT_WORKFLOW_NAME
    enabled = _as_bool(workflow.get("enabled"), default=False)
    schedule = _as_string(workflow.get("schedule"))
    shell_script_path = _as_string(workflow.get("shellScriptPath"))
    raw_steps = workflow.get("steps")
    steps: list[dict[str, Any]] = []
    if isinstance(raw_steps, list):
        for raw_step in raw_steps:
            step = _normalize_step(raw_step)
            if step:
                steps.append(step)

    normalized_workflow = {
        "id": workflow_id,
        "name": name,
        "enabled": enabled,
        "schedule": schedule,
        "steps": steps,
    }

    description = _as_string(workflow.get("description"))
    if description:
        normalized_workflow["description"] = description

    params = _normalize_workflow_params(workflow)
    if params:
        normalized_workflow["params"] = params

    if shell_script_path:
        normalized_workflow["shellScriptPath"] = shell_script_path

    max_runtime_minutes = workflow.get("maxRuntimeMinutes")
    if isinstance(max_runtime_minutes, int) and max_runtime_minutes > 0:
        normalized_workflow["maxRuntimeMinutes"] = max_runtime_minutes

    return normalized_workflow


def _normalize_payload(payload: Any) -> dict[str, list[dict[str, Any]]]:
    workflows: list[dict[str, Any]] = []
    if isinstance(payload, dict) and isinstance(payload.get("workflows"), list):
        for index, raw_workflow in enumerate(payload["workflows"]):
            normalized = _normalize_workflow(raw_workflow, index)
            if normalized:
                workflows.append(normalized)
    return {"workflows": workflows}


def read_workflows(repo_name: str | None = None) -> dict[str, list[dict[str, Any]]]:
    wf_path = _workflow_path(repo_name)
    if not wf_path.exists():
        return {"workflows": []}
    try:
        data = yaml.safe_load(wf_path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        logger.warning("Malformed workflow file: %s (%s)", wf_path, exc)
        return {"workflows": []}
    return _normalize_payload(data)


def write_workflows(
    workflows_payload: dict[str, Any], repo_name: str | None = None
) -> dict[str, list[dict[str, Any]]]:
    normalized = _normalize_payload(workflows_payload)
    wf_path = _workflow_path(repo_name)
    ensure_directory(wf_path.parent)
    wf_path.write_text(
        yaml.safe_dump(
            {"workflows": normalized.get("workflows", [])},
            sort_keys=False,
            allow_unicode=True,
        ),
        encoding="utf-8",
    )
    return normalized


def list_workspace_workflows(
    last_runs_by_job: dict[str, str | None] | None = None,
    diagnostics_by_job: dict[str, dict[str, Any]] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    workspace_home = get_workspace_home()
    workflows: list[dict[str, Any]] = []

    for repo_path in workspace_home.iterdir():
        if not repo_path.is_dir():
            continue
        if (repo_path / ".git").is_file():
            continue

        repo_name = repo_path.name
        repository_workflows = read_workflows(repo_name).get("workflows", [])

        for workflow in repository_workflows:
            job_id = f"{repo_name}:{workflow.get('id') or 'workflow'}"
            workflows.append(
                {
                    "repository": repo_name,
                    "id": workflow.get("id"),
                    "name": workflow.get("name"),
                    "enabled": bool(workflow.get("enabled", False)),
                    "schedule": workflow.get("schedule"),
                    "shellScriptPath": workflow.get("shellScriptPath"),
                    "lastRun": (last_runs_by_job or {}).get(job_id),
                    "diagnostics": (diagnostics_by_job or {}).get(job_id),
                }
            )

    for task in list_scheduled_tasks():
        task_name = str(task.get("name") or "task.md")
        task_id = f"task:{task_name}"
        workflows.append(
            {
                "repository": ".made/tasks",
                "id": task_id,
                "name": task_name,
                "enabled": True,
                "schedule": task.get("schedule"),
                "shellScriptPath": None,
                "lastRun": (last_runs_by_job or {}).get(task_id),
                "diagnostics": (diagnostics_by_job or {}).get(task_id),
            }
        )

    workflows.sort(
        key=lambda workflow: (
            str(workflow.get("repository") or ""),
            str(workflow.get("name") or ""),
        )
    )

    return {"workflows": workflows}
