from __future__ import annotations

import re
import stat
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class WorkflowParseError(ValueError):
    pass


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BaseStep(StrictModel):
    name: str | None = None

    @field_validator("name")
    @classmethod
    def validate_optional_string(cls, value: str | None) -> str | None:
        if value is not None and value.strip() == "":
            raise ValueError("must not be empty")
        return value


class BashStep(BaseStep):
    type: Literal["bash"]
    run: str


class AgentStep(BaseStep):
    type: Literal["agent"]
    prompt: str
    agent: str | None = None


class VarsStep(BaseStep):
    type: Literal["vars"]
    values: dict[str, str]

    @field_validator("values")
    @classmethod
    def validate_values(cls, value: dict[str, str]) -> dict[str, str]:
        if not value:
            raise ValueError("must contain at least one variable")
        for name, command in value.items():
            if not re.fullmatch(r"[A-Z_][A-Z0-9_]*", name):
                raise ValueError(f"invalid variable name: {name}")
            if command.strip() == "":
                raise ValueError(f"empty command for variable: {name}")
        return value


Step = Annotated[VarsStep | BashStep | AgentStep, Field(discriminator="type")]


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

    @field_validator("steps")
    @classmethod
    def validate_steps(cls, value: list[Step]) -> list[Step]:
        if not value:
            raise ValueError("must contain at least one step")
        return value

    @field_validator("shell_script_path")
    @classmethod
    def validate_shell_script_path(cls, value: str) -> str:
        if not re.fullmatch(r"\.harness/[A-Za-z0-9._/-]+\.sh", value):
            raise ValueError("must be a relative .harness/*.sh path")
        if ".." in Path(value).parts:
            raise ValueError("must not contain '..'")
        return value


class WorkflowFile(StrictModel):
    workflows: list[Workflow]


def parse_workflow_payload(payload: dict) -> WorkflowFile:
    try:
        return WorkflowFile.model_validate(payload)
    except ValidationError as error:
        raise WorkflowParseError(str(error)) from error


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


def render_harness(workflow: Workflow) -> str:
    lines = ["#!/usr/bin/env bash", "set -euo pipefail", ""]
    for index, step in enumerate(workflow.steps, start=1):
        lines.extend(render_step(index, step))
    return "\n".join(lines) + "\n"


def render_step(index: int, step: Step) -> list[str]:
    function_name = f"step_{index}"
    lines = [f"{function_name}() {{"]
    if isinstance(step, VarsStep):
        for name, command in step.values.items():
            lines.append(f"  {name}=$({command})")
        lines += ["}", f"{function_name}", ""]
        return lines
    if isinstance(step, BashStep):
        lines.extend(f"  {line}" if line else "" for line in step.run.splitlines())
        lines += ["}", f"{function_name}", ""]
        return lines
    lines.append("  local cmd=(opencode run --format json)")
    if step.agent:
        lines.append(f"  cmd+=(--agent {bash_quote(step.agent)})")
    lines.append(f"  printf '%s' {bash_quote(step.prompt)} | \"${{cmd[@]}}\"")
    lines += ["}", f"{function_name}", ""]
    return lines


def bash_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"
