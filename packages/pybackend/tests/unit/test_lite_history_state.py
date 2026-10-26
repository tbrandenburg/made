"""Lite route history state, retry selection, and safe exception handling."""

import logging
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

import lite_router


@pytest.fixture
def history_route(tmp_path, monkeypatch):
    (tmp_path / "repository").mkdir()
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(tmp_path))
    # Isolate route-boundary exception handling from external agent services.
    exporter = Mock(return_value={"messages": []})
    monkeypatch.setattr(lite_router, "export_chat_history", exporter)
    monkeypatch.setattr(lite_router, "list_agents", lambda name: [])
    monkeypatch.setattr(
        lite_router,
        "list_chat_sessions",
        lambda name: [{"id": "ses_selected", "title": "Selected session"}],
    )
    app = FastAPI()
    app.include_router(lite_router.router)
    with TestClient(app) as client:
        yield client, exporter


@pytest.mark.parametrize(
    "messages",
    [[], [{"role": "assistant", "content": "Recovered answer"}]],
    ids=["empty", "populated"],
)
def test_successful_history_is_not_an_error(history_route, messages):
    client, exporter = history_route
    exporter.return_value = {"messages": messages}

    response = client.get("/lite/repo/repository?session_id=ses_selected")

    assert response.status_code == 200
    assert response.context["history_error"] is False
    assert response.context["messages"] == messages
    assert response.context["current_session_id"] == "ses_selected"
    assert client.cookies["lite_session_repository"] == "ses_selected"
    if messages:
        assert "Recovered answer" in response.text
        assert "No messages yet." not in response.text
    else:
        assert "No messages yet." in response.text
        assert "Recovered answer" not in response.text
    exporter.assert_called_once_with("ses_selected", channel="repository")


def test_no_selected_session_has_no_history_error(history_route):
    client, exporter = history_route

    response = client.get("/lite/repo/repository")

    assert response.context["history_error"] is False
    assert response.context["messages"] == []
    assert response.context["current_session_id"] == ""
    assert "lite_session_repository" not in client.cookies
    exporter.assert_not_called()


@pytest.mark.parametrize("failure", [RuntimeError, FileNotFoundError, TimeoutError])
def test_history_failure_keeps_selection_and_logs_no_sensitive_details(
    history_route, caplog, failure
):
    client, exporter = history_route
    secret = "https://user:password@example.invalid/?token=secret\nprivate message body"
    exporter.side_effect = failure(secret)
    client.cookies.set(
        "lite_session_repository", "ses_previous", domain="testserver.local"
    )

    with caplog.at_level(logging.WARNING, logger="lite_router"):
        response = client.get("/lite/repo/repository?session_id=ses_selected")

    assert response.status_code == 200
    assert response.context["history_error"] is True
    assert response.context["messages"] == []
    assert response.context["current_session_id"] == "ses_selected"
    assert client.cookies["lite_session_repository"] == "ses_selected"
    assert "HttpOnly" in response.headers["set-cookie"]
    assert response.context["history_retry_url"] == (
        "/lite/repo/repository?session_id=ses_selected"
    )
    for detail in ("user:password", "token=secret", "private message body"):
        assert detail not in response.text
        assert detail not in caplog.text
    records = [record for record in caplog.records if record.name == "lite_router"]
    assert len(records) == 1
    assert records[0].getMessage() == "Unable to load Lite chat history"
    assert records[0].exc_info is None
    assert records[0].args == ()
    assert secret not in caplog.text
    exporter.assert_called_once_with("ses_selected", channel="repository")


def test_cookie_selected_session_retry_is_relative_and_percent_encoded(history_route):
    client, exporter = history_route
    session = "ses_+&=?#/%"
    client.cookies.set("lite_session_repository", session, domain="testserver.local")
    exporter.side_effect = RuntimeError("synthetic failure")

    response = client.get("/lite/repo/repository")

    retry = response.context["history_retry_url"]
    assert retry == "/lite/repo/repository?session_id=ses_%2B%26%3D%3F%23%2F%25"
    parts = urlsplit(retry)
    assert parts.scheme == "" and parts.netloc == "" and parts.fragment == ""
    assert parse_qs(parts.query) == {"session_id": [session]}
    assert response.context["current_session_id"] == session
    assert response.context["history_error"] is True
    exporter.assert_called_once_with(session, channel="repository")


@pytest.mark.parametrize(
    "messages",
    [[], [{"role": "assistant", "content": "Recovered answer"}]],
    ids=["empty", "populated"],
)
def test_retry_recovers_without_losing_the_selected_session(history_route, messages):
    client, exporter = history_route
    exporter.side_effect = [RuntimeError("synthetic failure"), {"messages": messages}]
    failed = client.get("/lite/repo/repository?session_id=ses_selected")

    recovered = client.get(failed.context["history_retry_url"])

    assert failed.context["history_error"] is True
    assert recovered.status_code == 200
    assert recovered.context["history_error"] is False
    assert recovered.context["messages"] == messages
    assert recovered.context["current_session_id"] == "ses_selected"
    assert client.cookies["lite_session_repository"] == "ses_selected"
    assert exporter.call_count == 2
    assert exporter.call_args_list[0] == exporter.call_args_list[1]
