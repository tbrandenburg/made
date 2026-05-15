from __future__ import annotations

import re
import stat
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class WorkflowParseError(ValueError):
    """Raised when workflows cannot be validated."""


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BaseStep(StrictModel):
    name: str | None = None


class BashStep(BaseStep):
    type: Literal["bash"]
    run: str


class AgentStep(BaseStep):
    type: Literal["agent"]
    prompt: str
    agent: str | None = None


Step = Annotated[BashStep | AgentStep, Field(discriminator="type")]


class Workflow(StrictModel):
    id: str
    name: str
    enabled: bool
    schedule: str | None = None
    steps: list[Step]
    shell_script_path: str = Field(alias="shellScriptPath")

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        if not re.fullmatch(r"wf_[A-Za-z0-9_-]+", value):
            raise ValueError("must match ^wf_[A-Za-z0-9_-]+$")
        return value


class WorkflowFile(StrictModel):
    workflows: list[Workflow]


def parse_workflow_payload(payload: dict) -> WorkflowFile:
    try:
        return WorkflowFile.model_validate(payload)
    except ValidationError as error:
        raise WorkflowParseError(str(error)) from error


def render_harness(workflow: Workflow) -> str:
    lines = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "",
        f"echo {bash_quote(f'Starting workflow: {workflow.name}')}",
        "",
    ]
    for index, step in enumerate(workflow.steps, start=1):
        lines.append(f"# Step {index}: {step.name or step.type}")
        if isinstance(step, BashStep):
            lines.extend(step.run.splitlines())
        else:
            lines.extend(render_agent_step(step))
        lines.append("")

    lines.append(f"echo {bash_quote(f'Workflow finished: {workflow.name}')}")
    lines.append("")
    return "\n".join(lines)


def render_agent_step(step: AgentStep) -> list[str]:
    lines = ["cmd=(opencode run --format json)"]
    if step.agent:
        lines.append(f"cmd+=(--agent {bash_quote(step.agent)})")
    lines.append(f"printf '%s' {bash_quote(step.prompt)} | \"${{cmd[@]}}\"")
    return lines


def generate_workflow_harnesses(payload: dict, output_root: Path) -> list[str]:
    workflow_file = parse_workflow_payload(payload)
    written: list[str] = []
    for workflow in workflow_file.workflows:
        output_path = output_root / workflow.shell_script_path
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(render_harness(workflow), encoding="utf-8")
        mode = output_path.stat().st_mode
        output_path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        written.append(workflow.shell_script_path)
    return written


def bash_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"
