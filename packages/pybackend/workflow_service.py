from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from config import ensure_directory, get_made_directory, get_workspace_home
from task_service import list_scheduled_tasks

DEFAULT_WORKFLOW_NAME = "New workflow"


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


def _normalize_step(step: Any) -> dict[str, str]:
    if not isinstance(step, dict):
        return {}
    step_type = _as_string(step.get("type"))
    if step_type == "bash":
        run = _as_string(step.get("run"))
        return {"type": "bash", "run": run or ""}
    if step_type == "agent":
        normalized: dict[str, str] = {"type": "agent"}
        agent = _as_string(step.get("agent"))
        command = _as_string(step.get("command"))
        prompt = _as_string(step.get("prompt"))
        if agent:
            normalized["agent"] = agent
        if command:
            normalized["command"] = command
        if prompt:
            normalized["prompt"] = prompt
        return normalized
    return {}


def _normalize_workflow(workflow: Any, index: int) -> dict[str, Any] | None:
    if not isinstance(workflow, dict):
        return None
    workflow_id = _as_string(workflow.get("id")) or f"workflow_{index + 1}"
    name = _as_string(workflow.get("name")) or DEFAULT_WORKFLOW_NAME
    enabled = _as_bool(workflow.get("enabled"), default=False)
    schedule = _as_string(workflow.get("schedule"))
    shell_script_path = _as_string(workflow.get("shellScriptPath"))
    raw_steps = workflow.get("steps")
    steps: list[dict[str, str]] = []
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
    workflow_file = _workflow_path(repo_name)
    if not workflow_file.exists():
        return {"workflows": []}

    data = yaml.safe_load(workflow_file.read_text(encoding="utf-8"))
    return _normalize_payload(data)


def write_workflows(
    workflows_payload: dict[str, Any], repo_name: str | None = None
) -> dict[str, list[dict[str, Any]]]:
    normalized = _normalize_payload(workflows_payload)
    workflow_file = _workflow_path(repo_name)
    ensure_directory(workflow_file.parent)
    workflow_file.write_text(
        yaml.safe_dump(normalized, sort_keys=False, allow_unicode=True),
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

    workflows.sort(key=lambda workflow: (str(workflow.get("repository") or ""), str(workflow.get("name") or "")))

    return {"workflows": workflows}
