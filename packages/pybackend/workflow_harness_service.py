"""Generates executable bash harness scripts from workflow payloads.

Parsing and rendering are delegated to the ``flowsh-cli`` library
(``flowsh_cli.models.parse_workflows`` / ``flowsh_cli.render.render_harness``),
which is the upstream source of truth for the workflow schema and script body.

made keeps its own:
- public function signature (``generate_workflow_harnesses``) and exception
  types (``WorkflowParseError`` / ``WorkflowVerificationError``) so
  ``app.py``'s error handling keeps working unmodified.
- file writer (writes under ``output_root / workflow.shellScriptPath``,
  sets the executable bit).
- harness verification (``bash -n`` then ``--dry-run``).
- stricter ``shellScriptPath`` validation: flowsh-cli treats the field as
  optional/unvalidated, so made enforces a ``.harness/*.sh`` relative path
  with no ``..`` traversal as an explicit, additional guard.
"""

from __future__ import annotations

import re
import shutil
import stat
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import yaml
from flowsh_cli.models import Workflow
from flowsh_cli.models import WorkflowParseError as FlowshWorkflowParseError
from flowsh_cli.models import parse_workflows as flowsh_parse_workflows
from flowsh_cli.render import render_harness as flowsh_render_harness

SHELL_SCRIPT_PATH_RE = re.compile(r"\.harness/[A-Za-z0-9._/-]+\.sh")


class WorkflowParseError(ValueError):
    """Raised when workflow payload cannot be validated."""


class WorkflowVerificationError(ValueError):
    """Raised when generated harness scripts fail verification checks."""


@dataclass
class WorkflowFile:
    """Thin made-owned container mirroring the pre-swap parse result shape."""

    workflows: list[Workflow]


def _validate_shell_script_path(workflow: Workflow) -> str:
    """Enforce made's own shellScriptPath guard on top of flowsh-cli's model.

    flowsh-cli's own ``Workflow.shellScriptPath`` is optional/unvalidated, so
    this check must live in made and run for every workflow after parsing.
    """
    value = workflow.shellScriptPath
    if not value or not SHELL_SCRIPT_PATH_RE.fullmatch(value):
        raise WorkflowParseError(
            f"workflow {workflow.id}: shellScriptPath must be a relative .harness/*.sh path"
        )
    if ".." in Path(value).parts:
        raise WorkflowParseError(
            f"workflow {workflow.id}: shellScriptPath must not contain '..'"
        )
    return value


def parse_workflow_payload(payload: dict) -> WorkflowFile:
    """Validate `payload` via flowsh-cli's parser, then apply made's own guards.

    flowsh_cli.models.parse_workflows takes a file Path (not an in-memory
    dict) so the payload is written to a temp YAML file first and cleaned up
    afterward.
    """
    tmp_dir = tempfile.mkdtemp(prefix="made-workflow-")
    try:
        tmp_path = Path(tmp_dir) / "workflows.yml"
        tmp_path.write_text(yaml.safe_dump(payload), encoding="utf-8")
        try:
            workflows = flowsh_parse_workflows(tmp_path)
        except FlowshWorkflowParseError as error:
            raise WorkflowParseError(str(error)) from error
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    for workflow in workflows:
        _validate_shell_script_path(workflow)

    return WorkflowFile(workflows=workflows)


def generate_workflow_harnesses(payload: dict, output_root: Path) -> list[str]:
    workflow_file = parse_workflow_payload(payload)
    written: list[str] = []

    for workflow in workflow_file.workflows:
        shell_script_path = workflow.shellScriptPath
        output_path = output_root / shell_script_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(render_harness(workflow), encoding="utf-8")
        mode = output_path.stat().st_mode
        output_path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        _verify_harness_script(output_path)
        written.append(shell_script_path)

    return written


def _verify_harness_script(script_path: Path) -> None:
    verify_process = subprocess.run(
        ["bash", "-n", str(script_path)],
        capture_output=True,
        text=True,
    )
    if verify_process.returncode != 0:
        stderr = (verify_process.stderr or verify_process.stdout or "").strip()
        raise WorkflowVerificationError(
            f"bash verify run failed for {script_path}: {stderr}"
        )

    dry_run_process = subprocess.run(
        [str(script_path), "--dry-run"],
        capture_output=True,
        text=True,
    )
    if dry_run_process.returncode != 0:
        stderr = (dry_run_process.stderr or dry_run_process.stdout or "").strip()
        raise WorkflowVerificationError(
            f"script dry run failed for {script_path}: {stderr}"
        )


def render_harness(workflow: Workflow) -> str:
    """Delegates to flowsh-cli's renderer, the new source of truth for the script body."""
    return flowsh_render_harness(workflow)
