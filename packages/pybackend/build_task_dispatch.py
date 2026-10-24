"""Revalidate selections and construct argv; no shell parsing or client executables."""

from pathlib import Path
import shutil

from pydantic import BaseModel, ConfigDict, Field

from build_task_discovery import (
    discover_build_tasks,
    repository_path,
    validate_parameter,
)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    file: str = Field(max_length=1000)
    target: str = Field(max_length=200)
    parameters: dict[str, str] = Field(default_factory=dict, max_length=50)


def _arguments(target: dict, values: dict[str, str], kind: str) -> list[str]:
    for name in {*values, *(parameter["name"] for parameter in target["parameters"])}:
        validate_parameter(name, kind)
    allowed = {parameter["name"] for parameter in target["parameters"]}
    if values.keys() - allowed:
        raise ValueError("Unrecognized parameter")
    arguments = []
    for parameter in target["parameters"]:
        value = values.get(parameter["name"], "")
        if parameter["required"] and not value.strip():
            raise ValueError(f"Required parameter: {parameter['name']}")
        if len(value) > 4096 or any(
            character in value for character in ("\x00", "\n", "\r")
        ):
            raise ValueError(
                "Parameter value is too long or contains control characters"
            )
        if value and parameter["choices"] and value not in parameter["choices"]:
            raise ValueError(f"Invalid choice for {parameter['name']}")
        if parameter["name"] in values:
            # Make recursively expands command-line variables, even without a shell.
            literal = value.replace("$", "$$") if kind == "make" else value
            arguments.append(f"{parameter['name']}={literal}")
    return arguments


def prepare_run(name: str, request: RunRequest) -> tuple[Path, dict, list[str]]:
    root = repository_path(name)
    relative = Path(request.file)
    if (
        relative.is_absolute()
        or ".." in relative.parts
        or "\\" in request.file
        or relative.as_posix() != request.file
    ):
        raise ValueError("Select a canonical repository-relative build file")
    files = discover_build_tasks(name)["files"]
    entry = next((file for file in files if file["path"] == request.file), None)
    if entry is None:
        raise FileNotFoundError("Build file not found; refresh discovery")
    target = next(
        (target for target in entry["targets"] if target["name"] == request.target),
        None,
    )
    if target is None:
        raise FileNotFoundError("Target not found; refresh discovery")
    if not target["runnable"]:
        raise ValueError(target["reason"])
    arguments = _arguments(target, request.parameters, entry["kind"])
    path = root / relative
    if not path.is_file() or path.resolve() != path:
        raise FileNotFoundError("Unsafe or missing build file")
    executable = shutil.which("make" if entry["kind"] == "make" else "task")
    if executable is None:
        raise ValueError(
            f"Missing executable: {'GNU Make (make)' if entry['kind'] == 'make' else 'go-task (task)'}. Install it on the backend PATH, then retry."
        )
    flag = "-f" if entry["kind"] == "make" else "--taskfile"
    return path, entry, [executable, flag, path.name, request.target, *arguments]
