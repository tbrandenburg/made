"""Route/job handoff and safe failure rendering (not early-ack E2E evidence)."""

from urllib.parse import parse_qs, quote, urlsplit
from types import SimpleNamespace
from http.cookies import SimpleCookie

from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient
import pytest

import agent_service as agents
from agent_results import RunResult
import lite_router
import lite_submission_service as jobs


@pytest.fixture
def client(tmp_path, monkeypatch):
    (tmp_path / "repository").mkdir()
    (tmp_path / 'repo &"<tag>').mkdir()
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
    app = FastAPI()
    app.include_router(lite_router.router)
    with TestClient(app) as connection:
        yield connection


@pytest.mark.parametrize("session", ["", "ses_+&=?#/%"])
def test_success_redirect_selects_explicit_encoded_session(
    client, session, monkeypatch
):
    calls = []

    def run(message, selected, agent, model, cwd, **kwargs):
        calls.append((message, selected, agent, model))
        return RunResult(True, selected or "ses_new", [])

    # Invocation-contract fixture: real admission, runner, route and template.
    monkeypatch.setattr(
        agents, "get_agent_cli", lambda cwd: SimpleNamespace(run_agent=run)
    )
    accepted = client.post(
        "/lite/repo/repository/chat",
        data={
            "message": "once",
            "session_id": session,
            "agent": " build ",
            "model": "chosen",
        },
        follow_redirects=False,
    )
    assert accepted.status_code == 303
    assert "session_id" not in accepted.headers["location"]
    success = client.get(accepted.headers["location"], follow_redirects=False)
    assert success.status_code == 303
    assert parse_qs(urlsplit(success.headers["location"]).query) == {
        "session_id": [session or "ses_new"]
    }
    cookie = SimpleCookie()
    cookie.load(success.headers["set-cookie"])
    assert cookie["lite_session_repository"].value == (session or "ses_new")
    assert "HttpOnly" in success.headers["set-cookie"]
    assert calls == [("once", session or None, "build", "chosen")]
    assert agents._processing_channels == {}


def test_pending_unknown_and_refresh_limit_are_honest_and_repo_bound(client):
    repository = 'repo &"<tag>'
    job, owner = jobs.accept_submission(repository, None)
    url = f"/lite/repo/{quote(repository, safe='')}/wait/{job.id}"
    pending = client.get(url)
    assert pending.status_code == 200 and "Accepted / queued" in pending.text
    assert 'http-equiv="refresh"' in pending.text and "<tag>" not in pending.text
    limited = client.get(url + "?attempt=60")
    assert limited.status_code == 200 and 'http-equiv="refresh"' not in limited.text
    assert "Execution has not been cancelled or confirmed successful" in limited.text
    assert "Cancel / go back" not in limited.text
    assert agents._processing_owners[repository] is owner
    unknown = client.get(f"/lite/repo/repository/wait/{job.id}")
    assert unknown.status_code == 410 and "Unknown or expired request" in unknown.text
    assert (
        'http-equiv="refresh"' not in unknown.text and "will not resend" in unknown.text
    )
    agents.release_agent_message(owner)


@pytest.mark.parametrize("fault", ["setup", "schedule", "run"])
def test_safe_failures_release_admission_and_do_not_redirect_to_empty_history(
    client, monkeypatch, caplog, fault
):
    secret = "private-prompt token=synthetic-secret"

    def fail(*args, **kwargs):
        raise RuntimeError(secret)

    if fault == "setup":
        monkeypatch.setattr(agents, "_get_working_directory", fail)
    elif fault == "schedule":
        monkeypatch.setattr(BackgroundTasks, "add_task", fail)
    else:
        monkeypatch.setattr(
            agents, "get_agent_cli", lambda cwd: SimpleNamespace(run_agent=fail)
        )
    accepted = client.post(
        "/lite/repo/repository/chat", data={"message": secret}, follow_redirects=False
    )
    if fault == "schedule":
        assert accepted.status_code == 503 and "Could not schedule" in accepted.text
        job = next(iter(jobs._submissions.values()))
        failure = client.get(f"/lite/repo/repository/wait/{job.id}")
    else:
        assert accepted.status_code == 303
        failure = client.get(accepted.headers["location"], follow_redirects=False)
    assert failure.status_code == 503 and "Request failed" in failure.text
    assert "location" not in failure.headers and "No messages yet." not in failure.text
    assert "Check your session history before submitting again" in failure.text
    assert secret not in failure.text and secret not in caplog.text
    assert agents._processing_owners == agents._processing_channels == {}


@pytest.mark.parametrize(
    "data", [{"message": "   "}, {"message": "text", "session_id": "ses_\nheader"}]
)
def test_invalid_submission_is_not_accepted(client, data):
    response = client.post("/lite/repo/repository/chat", data=data)
    assert response.status_code == 422 and "valid session ID" in response.text
    assert jobs._submissions == {} and agents._processing_owners == {}


def test_parent_directory_is_not_admitted_as_a_repository(client):
    response = client.post("/lite/repo/%2E%2E/chat", data={"message": "never sent"})
    assert response.status_code == 422 and "Invalid repository" in response.text
    assert jobs._submissions == {} and agents._processing_owners == {}
