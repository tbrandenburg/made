"""Bounded, non-executing metadata discovery; never invoke Make or Task here."""

from pathlib import Path
import os
import re
import stat

import yaml
from pydantic import BaseModel, Field

from config import get_workspace_home

MAKEFILES = {"Makefile", "makefile", "GNUmakefile"}
TASKFILES = {
    f"{stem}{dist}.{extension}"
    for stem in ("Taskfile", "taskfile")
    for dist in ("", ".dist")
    for extension in ("yml", "yaml")
}
EXCLUDED = {
    "node_modules",
    "vendor",
    "dist",
    "build",
    "coverage",
    "__pycache__",
    "target",
    "venv",
    "env",
}
IDENTIFIER = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}\Z")
TASK_IDENTIFIER = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.:-]{0,199}\Z")
PARAMETER = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}\Z")
MAX_BYTES = 262144
MAKE_RESERVED = frozenset(
    "SHELL MAKESHELL COMSPEC MAKE MAKE_COMMAND MAKEFLAGS GNUMAKEFLAGS MFLAGS "
    "MAKEFILES MAKEOVERRIDES MAKELEVEL MAKE_RESTARTS MAKEFILE_LIST MAKECMDGOALS "
    "MAKE_HOST MAKE_VERSION MAKE_TERMOUT MAKE_TERMERR CURDIR GPATH VPATH".split()
)
TASK_RESERVED = frozenset(
    "CLI_ARGS CLI_ARGS_LIST CLI_FORCE CLI_SILENT CLI_VERBOSE CLI_OFFLINE "
    "CLI_ASSUME_YES TASK ALIAS TASK_EXE ROOT_TASKFILE ROOT_DIR TASKFILE "
    "TASKFILE_DIR TASK_DIR USER_WORKING_DIR FILE_PATH_SEPARATOR "
    "PATH_LIST_SEPARATOR CHECKSUM TIMESTAMP ITEM EXIT_CODE TASK_VERSION".split()
)


def validate_parameter(name: str, kind: str) -> None:
    if not PARAMETER.fullmatch(name):
        raise ValueError("Unsupported parameter name")
    if name in (MAKE_RESERVED if kind == "make" else TASK_RESERVED):
        raise ValueError(f"Reserved {kind} parameter: {name}")


class Parameter(BaseModel):
    name: str
    required: bool = False
    choices: list[str] = Field(default_factory=list)


class Target(BaseModel):
    name: str
    description: str = ""
    parameters: list[Parameter] = Field(default_factory=list)
    runnable: bool = True
    reason: str | None = None


class BuildFile(BaseModel):
    path: str
    kind: str
    targets: list[Target] = Field(default_factory=list)
    error: str | None = None


def repository_path(name: str) -> Path:
    workspace = get_workspace_home().resolve()
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise FileNotFoundError("Repository not found")
    path = workspace / name
    if path.is_symlink() or not path.is_dir() or path.resolve().parent != workspace:
        raise FileNotFoundError("Repository not found")
    return path


def _make_parameters(comments: list[str]) -> list[Parameter]:
    parameters: dict[str, Parameter] = {}
    for comment in comments:
        if not comment.startswith("made:args "):
            continue
        for token in comment.removeprefix("made:args ").split():
            name = token.rstrip("!")
            validate_parameter(name, "make")
            parameters[name] = Parameter(name=name, required=token.endswith("!"))
    return list(parameters.values())


def _make_targets(text: str) -> list[Target]:
    targets: dict[str, Target] = {}
    comments: list[str] = []
    definitions = 0
    for line in text.splitlines():
        if line.startswith("define "):
            definitions += 1
        if line == "endef":
            definitions = max(0, definitions - 1)
            continue
        if definitions or line.startswith(("include ", "-include ", "sinclude ")):
            comments = []
            continue
        if line.startswith("#"):
            comments.append(line[1:].strip())
            continue
        if not line or line[0].isspace() or ":" not in line:
            comments = []
            continue
        header, rest = line.split(":", 1)
        names = header.split()
        if not names or any(not IDENTIFIER.fullmatch(name) for name in names):
            comments = []
            continue
        if rest.startswith("=") or "=" in rest.split(";", 1)[0]:
            comments = []
            continue
        parameters = _make_parameters(comments)
        description = " ".join(c for c in comments if not c.startswith("made:args"))
        description = rest.split("##", 1)[1].strip() if "##" in rest else description
        for name in names:
            targets.setdefault(
                name,
                Target(
                    name=name,
                    description=description[:2000],
                    parameters=parameters,
                ),
            )
        comments = []
    return sorted(targets.values(), key=lambda target: target.name)


def _task_parameters(task: dict) -> list[Parameter]:
    requires = task.get("requires") or {}
    if not isinstance(requires, dict) or not isinstance(requires.get("vars", []), list):
        raise ValueError("requires.vars must be a list")
    parameters: dict[str, Parameter] = {}
    if len(requires.get("vars", [])) > 50:
        raise ValueError("Too many required variables")
    for item in requires.get("vars", []):
        name = item.get("name") if isinstance(item, dict) else item
        if not isinstance(name, str) or not PARAMETER.fullmatch(name):
            raise ValueError("Unsupported required variable name")
        validate_parameter(name, "task")
        choices = item.get("enum", []) if isinstance(item, dict) else []
        if (
            not isinstance(choices, list)
            or len(choices) > 100
            or any(not isinstance(c, (str, int, float, bool)) for c in choices)
        ):
            raise ValueError(
                "Dynamic variable enums are not supported; use a literal enum"
            )
        parameters[name] = Parameter(
            name=name, required=True, choices=[str(c) for c in choices]
        )
    return list(parameters.values())


def _task_targets(text: str) -> tuple[list[Target], list[str]]:
    # Even a small number of chained merge aliases can expand exponentially.
    for token in yaml.scan(text):
        if isinstance(token, yaml.tokens.AliasToken):
            raise ValueError("YAML aliases and merge keys are not supported")
        if isinstance(token, yaml.tokens.ScalarToken) and token.value == "<<":
            raise ValueError("YAML aliases and merge keys are not supported")
    data = yaml.safe_load(text)
    if not isinstance(data, dict) or not isinstance(data.get("tasks", {}), dict):
        raise ValueError("Taskfile must contain a tasks mapping")
    if len(data.get("tasks", {})) > 500:
        raise ValueError("Too many tasks")
    targets = []
    for name, definition in data.get("tasks", {}).items():
        if not isinstance(name, str) or not TASK_IDENTIFIER.fullmatch(name):
            continue
        task = definition if isinstance(definition, dict) else {}
        if task.get("internal") is True:
            continue
        description = task.get("desc") or task.get("summary") or ""
        if not isinstance(description, str):
            raise ValueError("Task description must be a string")
        reason = (
            "Interactive tasks require a terminal and are not supported"
            if task.get("interactive") or task.get("prompt")
            else None
        )
        targets.append(
            Target(
                name=name,
                description=description[:2000],
                parameters=_task_parameters(task),
                runnable=reason is None,
                reason=reason,
            )
        )
    includes = data.get("includes") or {}
    internal = (
        [
            definition["taskfile"]
            for definition in includes.values()
            if isinstance(definition, dict)
            and definition.get("internal") is True
            and isinstance(definition.get("taskfile"), str)
        ]
        if isinstance(includes, dict)
        else []
    )
    return sorted(targets, key=lambda target: target.name), internal


def _parse_error(error: Exception) -> str:
    if isinstance(error, yaml.YAMLError):
        mark = getattr(error, "problem_mark", None)
        return f"Invalid YAML near line {mark.line + 1}" if mark else "Invalid YAML"
    if isinstance(error, UnicodeError):
        return "Build file must be UTF-8"
    if isinstance(error, ValueError):
        return str(error)
    return "Cannot read build file or its nesting exceeds the discovery limit"


def _parse_file(path: Path, root: Path) -> tuple[BuildFile, set[Path]]:
    entry = BuildFile(
        path=path.relative_to(root).as_posix(),
        kind="make" if path.name in MAKEFILES else "task",
    )
    internal_files: set[Path] = set()
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError("Not a regular build file")
            content = stream.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise ValueError("File exceeds discovery size limit (256 KiB)")
        text = content.decode("utf-8")
        if entry.kind == "make":
            entry.targets = _make_targets(text)
        if entry.kind == "task":
            entry.targets, internal = _task_targets(text)
            for include in internal:
                candidate = (path.parent / include).resolve()
                if candidate.is_relative_to(root):
                    internal_files.update(
                        (candidate / name for name in TASKFILES)
                        if candidate.is_dir()
                        else [candidate]
                    )
        if len(entry.targets) > 500:
            raise ValueError("File exceeds target limit (500)")
    except (OSError, ValueError, yaml.YAMLError, RecursionError) as error:
        entry.targets = []
        entry.error = _parse_error(error)
    return entry, internal_files


def discover_build_tasks(name: str) -> dict:
    root = repository_path(name)
    files: list[BuildFile] = []
    internal_files: set[Path] = set()
    warnings: list[str] = []
    visited = 0
    for directory, folders, filenames in os.walk(root, followlinks=False):
        visited += 1
        parent = Path(directory)
        depth = len(parent.relative_to(root).parts)
        folders[:] = sorted(
            folder
            for folder in folders
            if depth < 4
            and not folder.startswith(".")
            and folder not in EXCLUDED
            and not (parent / folder).is_symlink()
        )
        if visited > 2000 or len(files) >= 200:
            warnings.append(
                "Discovery scan limit reached (2000 directories / 200 files)"
            )
            break
        for filename in sorted(set(filenames) & (MAKEFILES | TASKFILES)):
            if len(files) >= 200:
                warnings.append("Discovery file limit reached (200 files)")
                break
            path = parent / filename
            if path.is_symlink() or not path.is_file():
                continue
            entry, internal = _parse_file(path, root)
            internal_files.update(internal)
            files.append(entry)
    return {
        "files": [
            entry.model_dump()
            for entry in sorted(files, key=lambda file: file.path)
            if root / entry.path not in internal_files
        ],
        "warnings": warnings,
    }
