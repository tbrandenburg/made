import subprocess
import threading
from pathlib import Path

import pytest

import agent_service as agents
from agent_results import RunResult


class FakeCLI:
    """Records every invocation; each run blocks until released or cancelled."""

    def __init__(self, spawn: bool = False):
        self.calls: list[str] = []
        self.started = threading.Semaphore(0)
        self.release = threading.Event()
        self.spawn = spawn
        self.processes: list[subprocess.Popen[str]] = []

    def run_agent(
        self, message, session, agent, model, cwd, *, cancel_event, on_process
    ):
        self.calls.append(message)
        if self.spawn:
            process = subprocess.Popen(["sleep", "30"], text=True)
            self.processes.append(process)
            on_process(process)
        self.started.release()
        while not (self.release.is_set() or cancel_event.is_set()):
            cancel_event.wait(0.01)
        return RunResult(success=True, session_id="ses_1", response_parts=[])

    def missing_command_error(self):
        return "missing"


@pytest.fixture
def cli(monkeypatch, tmp_path):
    fake = FakeCLI()
    monkeypatch.setattr(agents, "get_agent_cli", lambda *_a, **_k: fake)
    monkeypatch.setattr(agents, "_get_working_directory", lambda _c: Path(tmp_path))
    monkeypatch.setattr(agents, "_SESSIONS_PATH", tmp_path / "sessions.json")
    monkeypatch.setattr(agents, "_conversation_sessions", {})
    monkeypatch.setattr(agents, "_active_runs", {})
    return fake


def send_in_thread(message: str, results: list):
    thread = threading.Thread(
        target=lambda: results.append(
            agents.send_agent_message("repo", message, "ses_1")
        )
    )
    thread.start()
    return thread


def test_overlapping_messages_both_reach_the_cli_without_busy_error(cli):
    results: list = []
    first = send_in_thread("one", results)
    assert cli.started.acquire(timeout=5)
    second = send_in_thread("two", results)
    assert cli.started.acquire(timeout=5)

    assert agents.get_channel_status("ses_1") == {"running": True}
    cli.release.set()
    first.join(5)
    second.join(5)

    assert sorted(cli.calls) == ["one", "two"]
    assert [r["outcome"] for r in results] == ["succeeded", "succeeded"]
    assert agents.get_channel_status("ses_1") == {"running": False}
    assert agents._active_runs == {}


def test_cancel_terminates_every_live_process_and_reports_cancelled(cli, monkeypatch):
    cli.spawn = True
    results: list = []
    threads = [send_in_thread(m, results) for m in ("one", "two")]
    assert cli.started.acquire(timeout=5) and cli.started.acquire(timeout=5)

    assert agents.cancel_agent_message("ses_1") is True
    for thread in threads:
        thread.join(5)

    assert [r["outcome"] for r in results] == ["cancelled", "cancelled"]
    assert all(p.wait(timeout=5) != 0 for p in cli.processes)
    assert agents.get_channel_status("ses_1") == {"running": False}


def test_cancel_without_active_run_returns_false(cli):
    assert agents.cancel_agent_message("ses_1") is False


def test_send_after_cancel_runs_normally(cli):
    results: list = []
    thread = send_in_thread("one", results)
    assert cli.started.acquire(timeout=5)
    assert agents.cancel_agent_message("ses_1") is True
    thread.join(5)

    cli.release.set()
    after = agents.send_agent_message("repo", "two", "ses_1")

    assert results[0]["outcome"] == "cancelled"
    assert after["outcome"] == "succeeded"
    assert cli.calls == ["one", "two"]


def test_cli_failure_is_reported_and_run_is_cleaned_up(cli, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("explode")

    monkeypatch.setattr(cli, "run_agent", boom)
    result = agents.send_agent_message("repo", "x", "ses_1")

    assert result["outcome"] == "failed"
    assert "explode" in result["response"]
    assert agents._active_runs == {}


def test_conversation_sessions_survive_reload(cli, tmp_path):
    cli.release.set()
    agents.send_agent_message("repo", "x", None)
    assert agents._conversation_sessions == {"repo": "ses_1"}

    agents._conversation_sessions.clear()
    agents._load_conversation_sessions()

    assert agents._conversation_sessions == {"repo": "ses_1"}
