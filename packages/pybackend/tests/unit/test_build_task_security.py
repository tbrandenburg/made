"""Regression coverage for bounded YAML and reserved tool-control parameters."""

import json
import subprocess
import sys

import pytest

from build_task_discovery import discover_build_tasks
from build_task_dispatch import _arguments
from build_task_service import RunRequest, start_run
from tests.unit.test_build_task_service import write

pytest_plugins = ["tests.unit.test_build_task_service"]


@pytest.mark.parametrize(
    "document",
    [
        "base: &a {desc: hi}\ntasks: {hello: *a}\n",
        "tasks: {hello: {<<: {desc: hi}}}\n",
        "a0: &a0 {desc: hi}\n"
        + "".join(f"a{i}: &a{i} {{<<: [*a{i - 1}, *a{i - 1}]}}\n" for i in range(1, 25))
        + "tasks: {}\n",
    ],
)
def test_yaml_aliases_and_merges_are_rejected_before_expansion(repo, document):
    write(repo, "Taskfile.yml", document)
    write(repo, "Makefile", "healthy:\n")
    # A separate real process bounds the regression if unsafe merge loading returns.
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import json; from build_task_discovery import discover_build_tasks; "
            "print(json.dumps(discover_build_tasks('sample')))",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=3,
    )
    files = json.loads(result.stdout)["files"]
    assert files[0]["targets"][0]["name"] == "healthy"
    assert files[1]["error"] == "YAML aliases and merge keys are not supported"
    assert files[1]["targets"] == []


MAKE_NAMES = (
    "SHELL MAKESHELL COMSPEC MAKE MAKE_COMMAND MAKEFLAGS GNUMAKEFLAGS MFLAGS "
    "MAKEFILES MAKEOVERRIDES MAKELEVEL MAKE_RESTARTS MAKEFILE_LIST MAKECMDGOALS "
    "MAKE_HOST MAKE_VERSION MAKE_TERMOUT MAKE_TERMERR CURDIR GPATH VPATH"
).split()
TASK_NAMES = (
    "CLI_ARGS CLI_ARGS_LIST CLI_FORCE CLI_SILENT CLI_VERBOSE CLI_OFFLINE "
    "CLI_ASSUME_YES TASK ALIAS TASK_EXE ROOT_TASKFILE ROOT_DIR TASKFILE "
    "TASKFILE_DIR TASK_DIR USER_WORKING_DIR FILE_PATH_SEPARATOR "
    "PATH_LIST_SEPARATOR CHECKSUM TIMESTAMP ITEM EXIT_CODE TASK_VERSION"
).split()


@pytest.mark.parametrize(
    "kind,name", [("make", n) for n in MAKE_NAMES] + [("task", n) for n in TASK_NAMES]
)
def test_reserved_parameters_fail_discovery_and_defensive_dispatch(repo, kind, name):
    filename = "Makefile" if kind == "make" else "Taskfile.yml"
    content = (
        f"# made:args {name}!\nhello:\n\t@touch NOT_EXECUTED\n"
        if kind == "make"
        else f"version: '3'\ntasks:\n  hello:\n    requires:\n      vars: [{name}]\n    cmds: [touch NOT_EXECUTED]\n"
    )
    write(repo, filename, content)
    entry = discover_build_tasks("sample")["files"][0]
    assert entry["error"] == f"Reserved {kind} parameter: {name}"
    assert entry["targets"] == []
    target = {"parameters": [{"name": name, "required": True, "choices": []}]}
    with pytest.raises(ValueError, match=f"Reserved {kind} parameter"):
        _arguments(target, {name: "n"}, kind)
    with pytest.raises(FileNotFoundError, match="Target not found"):
        start_run(
            "sample", RunRequest(file=filename, target="hello", parameters={name: "n"})
        )
    assert not (repo / "NOT_EXECUTED").exists()
    assert not (repo / ".flowsh").exists()


def test_shell_and_makeflags_attacks_cannot_select_executable_or_skip_recipe(repo):
    executable = write(repo, "attacker", "#!/bin/sh\ntouch EXECUTABLE_SELECTED\n")
    executable.chmod(0o700)
    for name, value in (("SHELL", str(executable)), ("MAKEFLAGS", "n")):
        write(repo, "Makefile", f"# made:args {name}\nhello:\n\t@touch RECIPE_RAN\n")
        with pytest.raises(FileNotFoundError, match="Target not found"):
            start_run(
                "sample",
                RunRequest(file="Makefile", target="hello", parameters={name: value}),
            )
    assert not (repo / "EXECUTABLE_SELECTED").exists()
    assert not (repo / "RECIPE_RAN").exists()
    assert not (repo / ".flowsh").exists()


def test_parameter_argv_preserves_literal_dollars_and_metacharacters():
    target = {"parameters": [{"name": "VALUE", "required": True, "choices": []}]}
    value = "space ; & | ' \" $(shell touch BAD) $HOME $$"
    assert _arguments(target, {"VALUE": value}, "make") == [
        "VALUE=space ; & | ' \" $$(shell touch BAD) $$HOME $$$$"
    ]
    assert _arguments(target, {"VALUE": value}, "task") == [f"VALUE={value}"]
