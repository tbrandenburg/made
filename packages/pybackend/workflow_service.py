from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import yaml

from config import ensure_directory, get_made_directory, get_workspace_home
from task_service import list_scheduled_tasks

logger = logging.getLogger(__name__)

DEFAULT_WORKFLOW_NAME = "New workflow"


def _workflow_path(repo_name: str | None = None) -> Path:
    if repo_name:
        base_path = get_workspace_home() / repo_name
    else:
        base_path = get_made_directory()
    workflow_dir = ensure_directory(base_path / ".made") if repo_name else base_path
    return workflow_dir / "workflows.yml"


def _workflow_dir(repo_name: str | None = None) -> Path:
    """Return the .made directory path for global or per-repo context (does not create)."""
    if repo_name:
        return get_workspace_home() / repo_name / ".made"
    return get_made_directory()


def _workflow_paths(repo_name: str | None = None) -> list[Path]:
    """Return ordered list of *.yml paths under the .made directory.

    workflows.yml is always first for backward compatibility.
    Remaining files are sorted alphabetically.
    """
    wf_dir = _workflow_dir(repo_name)
    if not wf_dir.exists():
        return []
    default = wf_dir / "workflows.yml"
    others = sorted(p for p in wf_dir.glob("*.yml") if p != default)
    if default.exists():
        return [default, *others]
    return others


def _as_string(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    return None


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    return default


def _normalize_step(step: Any) -> dict[str, Any]:
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
        normalized: dict[str, Any] = {"type": "vars"}
        if values:
            normalized["values"] = values
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
    if shell_script_path:
        normalized_workflow["shellScriptPath"] = shell_script_path

    max_runtime_minutes = workflow.get("maxRuntimeMinutes")
    if isinstance(max_runtime_minutes, int) and max_runtime_minutes > 0:
        normalized_workflow["maxRuntimeMinutes"] = max_runtime_minutes

    source_file = _as_string(workflow.get("sourceFile"))
    if source_file:
        normalized_workflow["sourceFile"] = source_file

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
    all_workflows: list[dict[str, Any]] = []
    for wf_path in _workflow_paths(repo_name):
        if not wf_path.exists():
            continue
        try:
            data = yaml.safe_load(wf_path.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            logger.warning("Skipping malformed workflow file: %s (%s)", wf_path, exc)
            continue
        payload = _normalize_payload(data)
        for wf in payload.get("workflows", []):
            wf["sourceFile"] = wf_path.name
            all_workflows.append(wf)
    return {"workflows": all_workflows}


_SAFE_FILENAME_RE = re.compile(r"^[a-zA-Z0-9_\-]+\.yml$")


def _safe_workflow_filename(name: str | None) -> str:
    """Return a sanitized workflow filename, defaulting to workflows.yml.

    Rejects any input that contains path separators (prevents ../../ traversal)
    and enforces the *.yml extension with an allowlist character set.
    """
    if not name:
        return "workflows.yml"
    # Reject any input containing path separators — prevents ../../ traversal
    if "/" in name or "\\" in name:
        return "workflows.yml"
    if _SAFE_FILENAME_RE.match(name):
        return name
    return "workflows.yml"


def write_workflows(
    workflows_payload: dict[str, Any], repo_name: str | None = None
) -> dict[str, list[dict[str, Any]]]:
    normalized = _normalize_payload(workflows_payload)
    wf_dir = _workflow_dir(repo_name)

    # Group workflows by sourceFile; sanitize each filename (path traversal guard)
    by_file: dict[str, list[dict[str, Any]]] = {}
    for wf in normalized.get("workflows", []):
        safe_name = _safe_workflow_filename(wf.get("sourceFile"))
        by_file.setdefault(safe_name, []).append(wf)

    # Determine complete set of files to write:
    # - All groups from the incoming payload
    # - Any existing *.yml files NOT in the payload → write empty list
    #   (handles the case where all workflows were deleted from a secondary file)
    files_to_write: dict[str, list[dict[str, Any]]] = dict(by_file)
    if wf_dir.exists():
        for existing_path in wf_dir.glob("*.yml"):
            if existing_path.name not in files_to_write:
                files_to_write[existing_path.name] = []

    if not files_to_write:
        # No workflows and no existing files — write an empty workflows.yml
        default_path = wf_dir / "workflows.yml"
        ensure_directory(default_path.parent)
        default_path.write_text(
            yaml.safe_dump({"workflows": []}, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        return normalized

    for filename, workflows in files_to_write.items():
        wf_path = wf_dir / filename
        ensure_directory(wf_path.parent)
        # Strip sourceFile before writing — it is pipeline metadata, not YAML schema
        cleaned = [{k: v for k, v in w.items() if k != "sourceFile"} for w in workflows]
        wf_path.write_text(
            yaml.safe_dump({"workflows": cleaned}, sort_keys=False, allow_unicode=True),
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
