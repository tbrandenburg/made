from __future__ import annotations

import re
import stat
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class WorkflowParseError(ValueError):
    """Raised when workflow payload cannot be validated."""


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

    @field_validator("run")
    @classmethod
    def validate_run(cls, value: str) -> str:
        if value.strip() == "":
            raise ValueError("must not be empty")
        return value


class AgentStep(BaseStep):
    type: Literal["agent"]
    prompt: str
    agent: str | None = None

    @field_validator("prompt", "agent")
    @classmethod
    def validate_strings(cls, value: str | None) -> str | None:
        if value is not None and value.strip() == "":
            raise ValueError("must not be empty")
        return value


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

    @field_validator("name")
    @classmethod
    def validate_non_empty(cls, value: str) -> str:
        if value.strip() == "":
            raise ValueError("must not be empty")
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

    @field_validator("workflows")
    @classmethod
    def validate_workflows(cls, value: list[Workflow]) -> list[Workflow]:
        if not value:
            raise ValueError("must contain at least one workflow")

        ids = [workflow.id for workflow in value]
        duplicate_ids = sorted(
            {workflow_id for workflow_id in ids if ids.count(workflow_id) > 1}
        )
        if duplicate_ids:
            raise ValueError(f"duplicate workflow ids: {', '.join(duplicate_ids)}")

        return value


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
    script_name = Path(workflow.shell_script_path).name
    lines: list[str] = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "",
        f"SCRIPT_NAME={bash_quote(script_name)}",
        'WORKFLOW_NAME="${SCRIPT_NAME%.sh}"',
        "WORKFLOW_SLUG=$(printf '%s' \"$WORKFLOW_NAME\" \\",
        "  | tr '[:upper:]' '[:lower:]' \\",
        "  | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')",
        "LOG_TIMESTAMP=\"$(date -u +'%Y%m%dT%H%M%SZ')\"",
        'LOG_BASENAME="flowsh-${WORKFLOW_SLUG}-${LOG_TIMESTAMP}-$$.log"',
        "",
        section("Argument handling"),
        "DRY_RUN=false",
        'if [[ $# -eq 1 && "$1" == "--dry-run" ]]; then',
        "  DRY_RUN=true",
        "elif [[ $# -gt 0 ]]; then",
        '  printf "Usage: %s [--dry-run]\\n" "$0" >&2',
        "  exit 2",
        "fi",
        "",
        section("Log file setup - local by default, override with FLOWSH_LOG_DIR"),
        'LOG_DIR="${FLOWSH_LOG_DIR:-.flowsh/logs}"',
        'mkdir -p "$LOG_DIR"',
        'LOG_FILE="${LOG_DIR}/${LOG_BASENAME}"',
        "",
        section("log() — ISO-8601 UTC timestamps, INFO/ERROR, stderr + log file"),
        "log() {",
        '  local level="$1"; shift',
        "  local message",
        "  message=\"$(date -u +'%Y-%m-%dT%H:%M:%SZ') [${level}] $*\"",
        "  printf '%s\\n' \"$message\" >&2",
        '  printf \'%s\\n\' "$message" >> "$LOG_FILE" 2>/dev/null || true',
        "}",
        "",
        section("catch() — centralized step failure hook"),
        "catch() {",
        '  local step_name="$1"',
        '  local exit_code="$2"',
        '  log ERROR "Step failed: ${step_name} (exit=${exit_code})"',
        "}",
        "",
        section("run_step() — dry-run and failure handling; streams output via tee"),
        "run_step() {",
        '  local step_name="$1"',
        "",
        '  if [[ "$DRY_RUN" == true ]]; then',
        '    log INFO "[DRY-RUN] would run: ${step_name}"',
        "    return 0",
        "  fi",
        "",
        '  log INFO "Running step: ${step_name}"',
        "",
        "  set +e",
        '  if ( : >> "$LOG_FILE" ) 2>/dev/null; then',
        '    "$step_name" 2>&1 | tee -a "$LOG_FILE"',
        "    local status=${PIPESTATUS[0]}",
        "  else",
        '    "$step_name"',
        "    local status=$?",
        "  fi",
        "  set -e",
        "",
        "  if [[ $status -ne 0 ]]; then",
        '    catch "$step_name" "$status"',
        "  fi",
        '  return "$status"',
        "}",
        "",
        section("run_stateful_step() — dry-run and failure handling without subshells"),
        "run_stateful_step() {",
        '  local step_name="$1"',
        "",
        '  if [[ "$DRY_RUN" == true ]]; then',
        '    log INFO "[DRY-RUN] would run: ${step_name}"',
        "    return 0",
        "  fi",
        "",
        '  log INFO "Running step: ${step_name}"',
        "",
        "  set +e",
        '  "$step_name"',
        "  local status=$?",
        "  set -e",
        "",
        "  if [[ $status -ne 0 ]]; then",
        '    catch "$step_name" "$status"',
        "  fi",
        '  return "$status"',
        "}",
        "",
        section("run_agent() — prompt handling and OpenCode CLI invocation"),
        "run_agent() {",
        '  local prompt="$1"',
        '  local agent="${2:-}"',
        "",
        "  local cmd=(opencode run --format json)",
        '  if [[ -n "$agent" ]]; then',
        '    cmd+=(--agent "$agent")',
        "  fi",
        "",
        '  if [[ "$DRY_RUN" == true ]]; then',
        '    log INFO "[DRY-RUN] would run: $(printf \'%q \' "${cmd[@]}") (with prompt)"',
        "    return 0",
        "  fi",
        "",
        '  printf \'%s\' "$prompt" | "${cmd[@]}"',
        "}",
        "",
        section(f"Starting workflow: {workflow.name}"),
        f"log INFO {bash_quote(f'Starting workflow: {workflow.name}')}",
        "",
    ]

    for index, step in enumerate(workflow.steps, start=1):
        lines.extend(render_step(index, step))

    lines.extend(
        [
            section(f"Workflow finished: {workflow.name}"),
            f"log INFO {bash_quote(f'Workflow finished: {workflow.name}')}",
            "",
        ]
    )

    return "\n".join(lines) + "\n"


def render_step(index: int, step: Step) -> list[str]:
    function_name = step_function_name(index, step.name)
    title = step.name or default_step_title(index, step)
    lines = [section(f"Step {index} ({step.type}): {title}"), f"{function_name}() {{"]

    if isinstance(step, VarsStep):
        for name, command in step.values.items():
            lines.append(f"  {name}=$({command})")
    elif isinstance(step, BashStep):
        for command_line in step.run.strip().splitlines():
            lines.append(f"  {command_line}" if command_line.strip() else "")
    elif isinstance(step, AgentStep):
        delimiter = heredoc_delimiter("PROMPT", step.prompt)
        lines.extend(
            [
                "  local prompt",
                f"  prompt=$(cat <<'{delimiter}'",
                *step.prompt.splitlines(),
                delimiter,
                "  )",
            ]
        )
        if step.agent:
            lines.append(f"  local agent={bash_quote(step.agent)}")
            lines.append('  run_agent "$prompt" "$agent"')
        else:
            lines.append('  run_agent "$prompt"')

    runner = "run_stateful_step" if isinstance(step, VarsStep) else "run_step"
    lines.extend(["}", f"{runner} {function_name}", ""])
    return lines


def default_step_title(index: int, step: Step) -> str:
    if isinstance(step, VarsStep):
        return ", ".join(step.values.keys())
    if isinstance(step, BashStep):
        return truncate_one_line(step.run)
    if isinstance(step, AgentStep):
        return truncate_one_line(step.prompt)
    return f"step {index}"


def truncate_one_line(text: str, limit: int = 80) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1] + "…"


def step_function_name(index: int, name: str | None) -> str:
    source = name or f"step_{index}"
    slug = re.sub(r"[^A-Za-z0-9_]+", "_", source).strip("_")
    if not slug:
        slug = f"step_{index}"
    if slug[0].isdigit():
        slug = f"step_{slug}"
    if not slug.startswith("step_"):
        slug = f"step_{slug}"
    return slug.lower()


def heredoc_delimiter(base: str, text: str) -> str:
    delimiter = f"{base}_EOF"
    counter = 1
    while delimiter in text:
        counter += 1
        delimiter = f"{base}_EOF_{counter}"
    return delimiter


def bash_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def section(title: str) -> str:
    return "\n".join(
        [
            "# ---------------------------------------------------------------------------",
            f"# {title}",
            "# ---------------------------------------------------------------------------",
        ]
    )
