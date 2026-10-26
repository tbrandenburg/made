"""Shared admission, ownership and bounded tracking, with explicit fault injection."""

from dataclasses import asdict
import subprocess
import sys
from threading import Event, Thread
from types import SimpleNamespace

import pytest

import agent_service as agents
from agent_results import RunResult
import lite_submission_service as jobs


@pytest.fixture(autouse=True)
def isolated_state(tmp_path, monkeypatch):
    (tmp_path / "repository").mkdir()
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(tmp_path))
    monkeypatch.setenv("MADE_HOME", str(tmp_path))
    monkeypatch.setattr(agents, "_REGISTRY_PATH", tmp_path / "registry.json")
    for name in (
        "_processing_channels",
        "_processing_owners",
        "_process_registry",
        "_active_processes",
        "_cancel_events",
        "_conversation_sessions",
    ):
        monkeypatch.setattr(agents, name, {})
    monkeypatch.setattr(agents, "_cancelled_channels", set())
    monkeypatch.setattr(jobs, "_submissions", {})


@pytest.mark.parametrize("session", [None, "ses_existing"])
def test_queued_owner_survives_poll_and_blocks_lite_and_legacy(session):
    job, owner = jobs.accept_submission("repository", session)
    assert agents.get_channel_status(owner.key) == {"running": True}
    assert owner.key not in agents._active_processes
    with pytest.raises(agents.ChannelBusyError):
        jobs.accept_submission("repository", session)
    with pytest.raises(agents.ChannelBusyError):
        agents.send_agent_message("repository", "duplicate", session)
    assert jobs.get_submission("repository", job.id).state == "queued"
    assert agents._processing_owners[owner.key] is owner
    agents.release_agent_message(owner)


def test_cancelled_queued_worker_cannot_run_or_release_new_owner():
    job, old = jobs.accept_submission("repository", None)
    assert agents.cancel_agent_message("repository") is True
    newer, owner = jobs.accept_submission("repository", None)
    jobs.run_submission(job, old, "never dispatched", None, None, None)
    assert jobs.get_submission("repository", job.id).error == "cancelled"
    assert agents._processing_owners["repository"] is owner
    agents.release_agent_message(old)
    assert agents.get_channel_status("repository") == {"running": True}
    assert jobs.get_submission("repository", newer.id).state == "queued"
    agents.release_agent_message(owner)


@pytest.mark.parametrize("fault", ["setup", "cli", "missing", "result", "no_session"])
def test_execution_faults_release_without_poll_and_redact(fault, monkeypatch, caplog):
    secret = "private prompt token=synthetic-secret"

    def fail(*args, **kwargs):
        raise (FileNotFoundError if fault == "missing" else RuntimeError)(secret)

    cli = SimpleNamespace(
        run_agent=fail
        if fault in {"cli", "missing"}
        else lambda *a, **k: RunResult(fault == "no_session", None, [], secret),
        missing_command_error=lambda: secret,
    )
    monkeypatch.setattr(agents, "get_agent_cli", lambda cwd: cli)
    if fault == "setup":
        monkeypatch.setattr(agents, "_get_working_directory", fail)
    job, owner = jobs.accept_submission("repository", None)
    jobs.run_submission(job, owner, secret, None, None, None)
    completed = jobs._submissions[job.id]
    assert completed.state == "failed" and completed.error == "execution"
    assert agents._processing_owners == agents._processing_channels == {}
    assert secret not in str(asdict(completed)) and secret not in caplog.text
    successor = agents.reserve_agent_message("repository")
    assert successor is not owner
    agents.release_agent_message(successor)


def test_running_owner_cancellation_and_duplicate_consumption(monkeypatch):
    entered, release = Event(), Event()
    received = []

    def run(message, session, agent, model, cwd, *, cancel_event, on_process):
        received.append((message, session, agent, model))
        process = subprocess.Popen([sys.executable, "-c", "pass"])
        on_process(process)
        process.wait(timeout=5)
        entered.set()
        assert release.wait(5)
        return RunResult(True, "ses_done", [])

    monkeypatch.setattr(
        agents, "get_agent_cli", lambda cwd: SimpleNamespace(run_agent=run)
    )
    job, owner = jobs.accept_submission("repository", "ses_existing")
    thread = Thread(
        target=jobs.run_submission,
        args=(job, owner, "once", "ses_existing", "build", "model"),
    )
    thread.start()
    try:
        assert entered.wait(5)
        assert jobs.get_submission("repository", job.id).state == "running"
        assert agents._active_processes["ses_existing"].poll() == 0
        assert agents.get_channel_status("ses_existing") == {"running": True}
        with pytest.raises(agents.ChannelBusyError):
            agents.send_agent_message(
                "repository", "twice", "ses_existing", reservation=owner
            )
        assert agents.cancel_agent_message("ses_existing") is True
        with pytest.raises(agents.ChannelBusyError):
            agents.reserve_agent_message("repository", "ses_existing")
        assert owner.cancel.is_set()
    finally:
        release.set()
        thread.join(5)
    assert not thread.is_alive()
    assert received == [("once", "ses_existing", "build", "model")]
    assert jobs._submissions[job.id].error == "cancelled"
    assert agents._processing_owners == agents._processing_channels == {}


def test_capacity_retention_and_repository_binding_without_reader(monkeypatch):
    monkeypatch.setattr(jobs, "MAX_PENDING", 2)
    monkeypatch.setattr(jobs, "MAX_RECORDS", 3)
    first, owner = jobs.accept_submission("repository", None)
    second, another = jobs.accept_submission("other", None)
    with pytest.raises(jobs.SubmissionCapacityError):
        jobs.accept_submission("third", None)
    assert "third" not in agents._processing_owners
    assert jobs.get_submission("other", first.id) is None
    jobs.fail_scheduling(first, owner)
    for index in range(5):
        job, reservation = jobs.accept_submission(f"repo-{index}", None)
        jobs.fail_scheduling(job, reservation)
        assert len(jobs._submissions) <= 3
    assert first.id not in jobs._submissions
    assert jobs._submissions[second.id].state == "queued"
    future = max(job.completed or 0 for job in jobs._submissions.values()) + 901
    monkeypatch.setattr(jobs, "monotonic", lambda: future)
    jobs.fail_scheduling(second, another)
    assert list(jobs._submissions) == [second.id]
    assert agents._processing_owners == {}


def test_sync_outcome_is_explicit_and_completed_job_has_no_prompt(monkeypatch):
    monkeypatch.setattr(
        agents,
        "get_agent_cli",
        lambda cwd: SimpleNamespace(
            run_agent=lambda *a, **k: RunResult(True, "ses_new", [])
        ),
    )
    result = agents.send_agent_message("repository", "legacy")
    assert result["outcome"] == "succeeded" and result["processing"] is True
    assert result["sessionId"] == "ses_new"
    job, owner = jobs.accept_submission("repository", None)
    jobs.run_submission(job, owner, "private-prompt", None, None, None)
    assert jobs._submissions[job.id].session_id == "ses_new"
    assert "private-prompt" not in str(asdict(jobs._submissions[job.id]))
    completed = jobs._submissions[job.id]
    assert completed.accepted <= completed.started <= completed.completed
    assert agents._processing_channels == {}


@pytest.mark.parametrize("boundary", ["reservation", "record", "worker"])
def test_boundary_fault_injection_never_leaves_admission(boundary, monkeypatch):
    def fail(*args):
        raise RuntimeError("synthetic boundary failure")

    if boundary != "worker":
        target, name = (
            (agents, "_dump_processing_state")
            if boundary == "reservation"
            else (jobs, "uuid4")
        )
        monkeypatch.setattr(target, name, fail)
        with pytest.raises(RuntimeError, match="synthetic boundary failure"):
            jobs.accept_submission("repository", None)
        assert jobs._submissions == {}
    else:
        job, owner = jobs.accept_submission("repository", None)
        monkeypatch.setattr(jobs, "send_agent_message", fail)
        jobs.run_submission(job, owner, "private input", None, None, None)
        assert jobs._submissions[job.id].state == "failed"
        assert jobs._submissions[job.id].error == "execution"
    assert agents._processing_owners == agents._processing_channels == {}
