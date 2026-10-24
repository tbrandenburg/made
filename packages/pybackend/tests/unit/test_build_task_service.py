"""Real Make/Task executions and API contracts; no launcher/network mocks."""

import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from build_task_discovery import discover_build_tasks
from build_task_routes import router
from build_task_service import RunRequest, list_runs, read_run, start_run
from cron_service import list_workflow_logs, read_workflow_log_tail
from run_log_service import bounded_tail


def write(root: Path, name: str, content: str) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    return path


@pytest.fixture
def repo(tmp_path, monkeypatch):
    for key in tuple(os.environ):
        if key.startswith("GIT_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", "/dev/null")
    workspace = tmp_path / "workspace"
    root = workspace / "sample"
    root.mkdir(parents=True)
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(workspace))
    monkeypatch.setenv("MADE_HOME", str(tmp_path / "home"))
    return root


def finish(run: dict) -> dict:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        result = read_run(run["repository"], run["runId"])
        if result["status"] != "running":
            return result
        time.sleep(0.02)
    pytest.fail(f"Run did not finish: {run['runId']}")


def test_static_discovery_is_bounded_grouped_and_never_executes(repo):
    write(
        repo,
        "Makefile",
        """SIDE := $(shell touch discovery-executed)
.PHONY: hello
# Say hello
# made:args WHO! NAME
hello other: ## Greeting
\t@echo ignored:recipe
%.o: %.c
.SPECIAL:
$(DYNAMIC):
VALUE := not-a-target
include missing.mk
""",
    )
    write(
        repo,
        "services/Taskfile.dist.yaml",
        """version: '3'
vars:
  DYNAMIC: {sh: touch discovery-executed}
tasks:
  hello:
    requires:
      vars: [WHO, {name: ENV, enum: [staging, production]}]
    cmds: [echo hi]
  ns:build: {cmds: [echo build]}
  hidden: {internal: true, cmds: [echo hidden]}
  interactive: {interactive: true, cmds: [echo no]}
""",
    )
    for directory in (
        "node_modules",
        ".git",
        ".venv",
        "dist",
        ".worktrees",
        "a/b/c/d/e",
    ):
        write(repo, f"{directory}/Makefile", "excluded:\n")
    outside = write(repo.parent, "outside/Makefile", "escape:\n")
    (repo / "linked").symlink_to(outside.parent, target_is_directory=True)
    write(repo, "broken/Taskfile.yml", "tasks: [invalid")
    result = discover_build_tasks("sample")
    assert [file["path"] for file in result["files"]] == [
        "Makefile",
        "broken/Taskfile.yml",
        "services/Taskfile.dist.yaml",
    ]
    make, broken, task = result["files"]
    assert [target["name"] for target in make["targets"]] == ["hello", "other"]
    assert make["targets"][0]["parameters"] == [
        {"name": "WHO", "required": True, "choices": []},
        {"name": "NAME", "required": False, "choices": []},
    ]
    assert broken["error"] and not broken["targets"]
    assert [target["name"] for target in task["targets"]] == [
        "hello",
        "interactive",
        "ns:build",
    ]
    assert task["targets"][0]["parameters"][1]["choices"] == ["staging", "production"]
    assert not task["targets"][1]["runnable"]
    assert not list(repo.rglob("discovery-executed"))


def test_internal_includes_do_not_expose_helpers_and_make_definitions_are_not_rules(
    repo,
):
    write(
        repo,
        "Taskfile.yml",
        "version: '3'\nincludes:\n  helper: {taskfile: helpers, internal: true}\ntasks:\n  public: {cmds: [echo visible]}\n",
    )
    write(
        repo,
        "helpers/Taskfile.yml",
        "version: '3'\ntasks:\n  implementation: {cmds: [echo private]}\n",
    )
    write(repo, "Makefile", "define RULE\nfake:\nendef\ninclude not:a:rule\nreal:\n")
    result = discover_build_tasks("sample")
    assert [file["path"] for file in result["files"]] == ["Makefile", "Taskfile.yml"]
    assert [target["name"] for target in result["files"][0]["targets"]] == ["real"]
    assert [target["name"] for target in result["files"][1]["targets"]] == ["public"]


def test_task_enums_interactive_and_missing_task_are_rejected_without_runs(
    repo, monkeypatch
):
    write(
        repo,
        "Taskfile.yml",
        "version: '3'\ntasks:\n  choose:\n    requires:\n      vars: [{name: ENV, enum: [staging, production]}]\n    cmds: [echo hi]\n  prompt: {interactive: true, cmds: [echo no]}\n",
    )
    with pytest.raises(ValueError, match="Invalid choice"):
        start_run(
            "sample",
            RunRequest(file="Taskfile.yml", target="choose", parameters={"ENV": "bad"}),
        )
    with pytest.raises(ValueError, match="terminal"):
        start_run("sample", RunRequest(file="Taskfile.yml", target="prompt"))
    monkeypatch.setenv("PATH", str(repo / "missing"))
    with pytest.raises(ValueError, match="go-task"):
        start_run(
            "sample",
            RunRequest(
                file="Taskfile.yml", target="choose", parameters={"ENV": "staging"}
            ),
        )
    assert list_runs("sample")["runs"] == []
    assert not (repo / ".flowsh").exists()


def test_discovery_size_and_yaml_graph_limits_are_isolated(repo):
    write(repo, "Makefile", "hello:\n")
    write(repo, "oversized/Makefile", "x" * 262145)
    write(
        repo,
        "aliases/Taskfile.yml",
        "anchor: &a []\ntasks: {}\nrefs: [" + ",".join(["*a"] * 51) + "]",
    )
    result = discover_build_tasks("sample")
    assert result["files"][0]["targets"][0]["name"] == "hello"
    assert result["files"][1]["error"] and result["files"][2]["error"]
    assert result["files"][1]["targets"] == [] and result["files"][2]["targets"] == []


def test_symlinked_output_directory_never_writes_outside_repository(repo):
    write(repo, "Makefile", "hello:\n\t@echo hi\n")
    outside = repo.parent / "outside-logs"
    outside.mkdir()
    (repo / ".flowsh").symlink_to(outside, target_is_directory=True)
    with pytest.raises(FileNotFoundError, match="Unsafe log"):
        start_run("sample", RunRequest(file="Makefile", target="hello"))
    assert list(outside.iterdir()) == []
    assert list_workflow_logs() == []


def test_nonregular_build_and_run_files_do_not_block(repo):
    os.mkfifo(repo / "Makefile")
    assert discover_build_tasks("sample")["files"] == []
    directory = repo / ".flowsh/logs"
    directory.mkdir(parents=True)
    run_id = "a" * 32
    os.mkfifo(directory / f"build-task-{run_id}.json")
    with pytest.raises(FileNotFoundError, match="unavailable"):
        read_run("sample", run_id)
    assert list_runs("sample")["runs"] == []


def test_concurrent_readers_never_mark_owned_finishing_runs_unknown(repo):
    write(repo, "Makefile", "hello:\n\t@sleep .05; echo SHORT_RUN\n")
    runs = [
        start_run("sample", RunRequest(file="Makefile", target="hello"))
        for _ in range(12)
    ]
    with ThreadPoolExecutor(max_workers=4) as readers:
        results = list(readers.map(finish, runs))
    assert {result["status"] for result in results} == {"succeeded"}
    assert {result["exitCode"] for result in results} == {0}
    assert len({result["runId"] for result in results}) == 12
    assert sum("SHORT_RUN" in result["tail"] for result in results) == 12


def test_make_real_output_exit_status_overlap_and_private_persistence(repo, caplog):
    subprocess.run(["git", "init", "-q", str(repo)], check=True, timeout=10)
    write(
        repo,
        "Makefile",
        "hello:\n\t@echo MAKE_OK; echo MAKE_STDERR >&2\nfails:\n\t@echo MAKE_ERROR >&2; exit 7\nlong:\n\t@sleep .3; echo DONE\n",
    )
    with caplog.at_level(logging.INFO, logger="made.pybackend.build_tasks"):
        first = start_run("sample", RunRequest(file="Makefile", target="long"))
        second = start_run("sample", RunRequest(file="Makefile", target="hello"))
        failed = finish(
            start_run("sample", RunRequest(file="Makefile", target="fails"))
        )
        success = finish(second)
        long = finish(first)
    assert first["runId"] != second["runId"] and first["pid"] != second["pid"]
    assert failed["status"] == "failed" and failed["exitCode"] != 0
    assert "MAKE_ERROR" in failed["tail"]
    assert success["status"] == "succeeded" and success["exitCode"] == 0
    assert "MAKE_OK" in success["tail"] and "MAKE_STDERR" in success["tail"]
    assert "MADE start" in success["tail"] and "status=succeeded" in success["tail"]
    assert long["durationMs"] >= 250 and long["finishedAt"]
    assert len(list_runs("sample")["runs"]) == 3
    assert "MAKE_OK" not in caplog.text and "exitCode=0" in caplog.text
    for path in (repo / ".flowsh/logs").iterdir():
        assert path.stat().st_mode & 0o777 == 0o600
    assert read_run("sample", second["runId"])["exitCode"] == 0
    ignored = subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "check-ignore",
            ".flowsh/logs/" + second["logName"],
            f".flowsh/logs/build-task-{second['runId']}.json",
        ],
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    )
    assert len(ignored.stdout.splitlines()) == 2


def test_nested_make_argv_values_are_single_literal_arguments(repo):
    write(repo, "nested/Makefile", "# made:args WHO!\nhello:\n\t@python3 print.py\n")
    write(
        repo,
        "nested/print.py",
        "import os\nprint('WHO=' + os.environ['WHO'])\nprint('CWD=' + os.getcwd())\n",
    )
    value = (
        "Ada Lovelace; touch NEVER_EXECUTED & | ' quotes $(shell touch MAKE_EXPANSION)"
    )
    result = finish(
        start_run(
            "sample",
            RunRequest(
                file="nested/Makefile", target="hello", parameters={"WHO": value}
            ),
        )
    )
    assert result["exitCode"] == 0 and f"WHO={value}" in result["tail"]
    assert f"CWD={repo / 'nested'}" in result["tail"]
    assert not (repo / "nested/NEVER_EXECUTED").exists()
    assert not (repo / "nested/MAKE_EXPANSION").exists()


def test_task_real_nested_namespaced_enums_failures_and_stdin(repo):
    assert shutil.which("task"), "Install go-task on PATH to verify real Task execution"
    write(
        repo,
        "services/api/Taskfile.yml",
        """version: '3'
tasks:
  ns:hello:
    requires:
      vars: [WHO, {name: ENV, enum: [staging, production]}]
    cmds:
      - python3 print.py
  fails:
    cmds: ["sh -c 'echo TASK_ERROR >&2; exit 9'"]
  input:
    cmds: ["python3 -c 'import sys; print(repr(sys.stdin.read()))'"]
""",
    )
    write(
        repo,
        "services/api/print.py",
        "import os\nprint('TASK_NAME=' + os.environ['WHO'])\nprint(os.getcwd())\n",
    )
    # Task variables are exported explicitly by the authored task, not implicitly.
    path = repo / "services/api/Taskfile.yml"
    path.write_text(
        path.read_text().replace(
            "    cmds:\n      - python3",
            "    env:\n      WHO: '{{.WHO}}'\n    cmds:\n      - python3",
        )
    )
    result = finish(
        start_run(
            "sample",
            RunRequest(
                file="services/api/Taskfile.yml",
                target="ns:hello",
                parameters={"WHO": "Ada Lovelace; echo literal", "ENV": "staging"},
            ),
        )
    )
    failed = finish(
        start_run(
            "sample", RunRequest(file="services/api/Taskfile.yml", target="fails")
        )
    )
    closed = finish(
        start_run(
            "sample", RunRequest(file="services/api/Taskfile.yml", target="input")
        )
    )
    assert (
        result["status"] == "succeeded"
        and "TASK_NAME=Ada Lovelace; echo literal" in result["tail"]
    )
    assert (
        str(repo / "services/api") in result["tail"]
        and "target=ns:hello" in result["tail"]
    )
    assert (
        failed["status"] == "failed"
        and failed["exitCode"] != 0
        and "TASK_ERROR" in failed["tail"]
    )
    assert closed["status"] == "succeeded" and "''" in closed["tail"]


@pytest.mark.parametrize(
    "payload,status",
    [
        ({"file": "../Makefile", "target": "hello"}, 400),
        ({"file": "/tmp/Makefile", "target": "hello"}, 400),
        ({"file": "Makefile", "target": "-f"}, 404),
        ({"file": "Makefile", "target": "absent"}, 404),
        (
            {"file": "Makefile", "target": "hello", "parameters": {"UNDECLARED": "x"}},
            400,
        ),
        ({"file": "Makefile", "target": "hello", "parameters": {"WHO": ""}}, 400),
        ({"file": "Makefile", "target": "hello", "parameters": {"WHO": "x\x00"}}, 400),
        ({"file": "Makefile", "target": "hello", "parameters": {"WHO": 4}}, 400),
    ],
)
def test_api_rejects_invalid_requests_without_execution(repo, payload, status):
    write(repo, "Makefile", "# made:args WHO!\nhello:\n\t@touch SHOULD_NOT_EXIST\n")
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post(
            "/api/repositories/sample/build-tasks/runs", json=payload
        )
    assert response.status_code == status and response.json()["detail"]
    assert not (repo / "SHOULD_NOT_EXIST").exists() and not (repo / ".flowsh").exists()


def test_missing_tools_revalidation_and_symlink_rejection(repo, monkeypatch):
    path = write(repo, "Makefile", "hello:\n\t@echo hi\n")
    discovered = discover_build_tasks("sample")
    monkeypatch.setenv("PATH", str(repo / "empty-path"))
    with pytest.raises(ValueError, match="GNU Make"):
        start_run("sample", RunRequest(file="Makefile", target="hello"))
    assert discovered["files"][0]["targets"][0]["name"] == "hello"
    path.unlink()
    path.symlink_to(
        write(repo.parent, "outside/Makefile", "hello:\n\t@touch escaped\n")
    )
    with pytest.raises(FileNotFoundError):
        start_run("sample", RunRequest(file="Makefile", target="hello"))
    assert discover_build_tasks("sample")["files"] == []
    path.unlink()
    write(repo, "Makefile", "different:\n")
    with pytest.raises(FileNotFoundError, match="Target"):
        start_run("sample", RunRequest(file="Makefile", target="hello"))


def test_unknown_restart_state_and_real_process_persistence(repo):
    write(repo, "Makefile", "hello:\n\t@echo persisted\n")
    result = finish(start_run("sample", RunRequest(file="Makefile", target="hello")))
    code = (
        "from build_task_service import read_run; import json; print(json.dumps(read_run('sample', '"
        + result["runId"]
        + "')))"
    )
    restarted = subprocess.run(
        [os.sys.executable, "-c", code],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    assert json.loads(restarted.stdout)["status"] == "succeeded"
    record = repo / ".flowsh/logs" / f"build-task-{result['runId']}.json"
    data = json.loads(record.read_text())
    data.update(status="running", exitCode=None, finishedAt=None)
    record.write_text(json.dumps(data))
    unknown = read_run("sample", result["runId"])
    assert unknown["status"] == "unknown" and unknown["exitCode"] is None


def test_scoped_shared_log_listing_bounded_tail_and_linked_worktree(repo):
    write(repo, ".git", "gitdir: /irrelevant/worktree\n")
    write(repo, "Makefile", "hello:\n\t@echo BUILD_OUTPUT\n")
    result = finish(start_run("sample", RunRequest(file="Makefile", target="hello")))
    workflow = write(repo, ".flowsh/logs/flowsh-example.log", "workflow output\n")
    logs = list_workflow_logs()
    assert {entry["type"] for entry in logs} == {"flowsh", "build-task"}
    assert "BUILD_OUTPUT" in read_workflow_log_tail("sample", result["logName"])["tail"]
    assert read_workflow_log_tail("sample", workflow.name)["tail"] == "workflow output"
    giant = write(repo, ".flowsh/logs/flowsh-giant.log", "x" * 2000000 + "\nLAST\n")
    tail = bounded_tail(giant, 20)
    assert len(tail) <= 65536 and tail.endswith("LAST")
    (giant.parent / "flowsh-escape.log").symlink_to(
        write(repo.parent, "secret", "not readable")
    )
    with pytest.raises(OSError):
        read_workflow_log_tail("sample", "flowsh-escape.log")
    assert "flowsh-escape.log" not in {entry["name"] for entry in list_workflow_logs()}
    with pytest.raises(FileNotFoundError):
        read_workflow_log_tail("sample", "../secret")
