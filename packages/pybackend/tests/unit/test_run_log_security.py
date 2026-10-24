"""Real filesystem swaps must not redirect pinned run-log operations."""

from contextlib import contextmanager
import json
import time

import pytest

import build_task_service
import cron_service
import run_log_service
from build_task_service import RunRequest, list_runs, read_run, start_run
from tests.unit.test_build_task_service import finish, write

pytest_plugins = ["tests.unit.test_build_task_service"]


def swap_after_open(repo, monkeypatch, module):
    original = run_log_service.scoped_log_directory
    outside = repo.parent / "outside"
    (outside / "logs").mkdir(parents=True)
    saved = repo / ".flowsh-pinned"

    @contextmanager
    def swapped(root, create=False):
        with original(root, create=create) as directory:
            if root == repo and not saved.exists():
                (repo / ".flowsh").rename(saved)
                (repo / ".flowsh").symlink_to(outside, target_is_directory=True)
            yield directory

    monkeypatch.setattr(module, "scoped_log_directory", swapped)
    return outside, saved


def restore(repo, saved):
    (repo / ".flowsh").unlink()
    saved.rename(repo / ".flowsh")


def test_swapped_parent_cannot_redirect_start_sidecar_or_completion(repo, monkeypatch):
    write(repo, "Makefile", "hello:\n\t@sleep .15; echo PINNED_OUTPUT\n")
    outside, saved = swap_after_open(repo, monkeypatch, build_task_service)
    run = start_run("sample", RunRequest(file="Makefile", target="hello"))
    record = saved / "logs" / f"build-task-{run['runId']}.json"
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if json.loads(record.read_text())["status"] == "succeeded":
            break
        time.sleep(0.02)
    persisted = json.loads(record.read_text())
    assert persisted["status"] == "succeeded" and persisted["exitCode"] == 0
    assert persisted["finishedAt"] and persisted["durationMs"] >= 100
    assert "PINNED_OUTPUT" in (saved / "logs" / run["logName"]).read_text()
    assert "MADE finish" in (saved / "logs" / run["logName"]).read_text()
    assert list((outside / "logs").iterdir()) == []
    restore(repo, saved)


@pytest.mark.parametrize(
    "operation", ["detail", "runs", "shared-tail", "shared-list", "bounded-tail"]
)
def test_swapped_parent_does_not_read_outside_logs_or_metadata(
    repo, monkeypatch, operation
):
    write(repo, "Makefile", "hello:\n\t@echo INSIDE_OUTPUT\n")
    run = finish(start_run("sample", RunRequest(file="Makefile", target="hello")))
    module = (
        cron_service
        if operation.startswith("shared")
        else (run_log_service if operation == "bounded-tail" else build_task_service)
    )
    outside, saved = swap_after_open(repo, monkeypatch, module)
    write(outside, "logs/flowsh-outside.log", "OUTSIDE_SECRET")
    write(outside, "logs/" + run["logName"], "OUTSIDE_SECRET")
    fake = {**run, "target": "OUTSIDE_SECRET"}
    write(outside, f"logs/build-task-{run['runId']}.json", json.dumps(fake))
    before = {p.name: p.read_bytes() for p in (outside / "logs").iterdir()}
    if operation == "detail":
        result = read_run("sample", run["runId"])
        assert "INSIDE_OUTPUT" in result["tail"]
        assert result["target"] == "hello"
    elif operation == "runs":
        result = list_runs("sample")
        assert result["runs"][0]["target"] == "hello"
        assert len(result["runs"]) == 1
    elif operation == "shared-tail":
        result = cron_service.read_workflow_log_tail("sample", run["logName"])
        assert "INSIDE_OUTPUT" in result["tail"]
        assert result["location"] == "sample"
    elif operation == "shared-list":
        result = cron_service.list_workflow_logs()
        assert len(result) == 1
        assert result[0]["name"] == run["logName"]
    else:
        result = run_log_service.bounded_tail(repo / ".flowsh/logs" / run["logName"])
        assert "INSIDE_OUTPUT" in result
        assert "MADE finish" in result
    assert "OUTSIDE_SECRET" not in str(result)
    assert {p.name: p.read_bytes() for p in (outside / "logs").iterdir()} == before
    restore(repo, saved)


@pytest.mark.parametrize("failure", [False, True])
def test_missing_active_log_does_not_lose_actual_process_result(repo, failure):
    write(
        repo,
        "Makefile",
        f"hello:\n\t@sleep .15; echo DONE; exit {7 if failure else 0}\n",
    )
    run = start_run("sample", RunRequest(file="Makefile", target="hello"))
    (repo / ".flowsh/logs" / run["logName"]).unlink()
    result = finish(run)
    assert result["status"] == ("failed" if failure else "succeeded")
    assert (result["exitCode"] != 0) if failure else (result["exitCode"] == 0)
    assert result["finishedAt"] and result["durationMs"] >= 100
    assert "Output unavailable" in result["tail"]
    assert list_runs("sample")["runs"][0]["status"] == result["status"]
    record = repo / ".flowsh/logs" / f"build-task-{run['runId']}.json"
    assert json.loads(record.read_text())["exitCode"] == result["exitCode"]


def test_each_directory_component_refuses_symlink_before_open(repo):
    outside = repo.parent / "outside"
    outside.mkdir()
    (repo / ".flowsh").mkdir()
    (repo / ".flowsh/logs").symlink_to(outside, target_is_directory=True)
    with pytest.raises(FileNotFoundError, match="Unsafe log directory"):
        with run_log_service.scoped_log_directory(repo, create=True):
            pytest.fail("Symlinked component was accepted")
    assert list(outside.iterdir()) == []
    assert not (outside / ".gitignore").exists()
