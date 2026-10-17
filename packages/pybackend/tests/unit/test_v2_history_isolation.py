"""Real V2 HTTP adapter, history service, and four route-family isolation."""

import json
from urllib.parse import urlsplit

from fastapi.testclient import TestClient
import pytest

import agent_service
from app import app
from tests.unit.opencode_http_fixture import Reply, serve


@pytest.fixture
def history_store(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    repository = workspace / "repository"
    repository.mkdir(parents=True)
    made = tmp_path / "home" / ".made"
    for name in ("knowledge", "constitutions", "tasks"):
        (made / name).mkdir(parents=True)
    foreign = tmp_path / "private foreign directory"
    monkeypatch.setenv("OPENCODE_DB", str(tmp_path / "absent.db"))
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    monkeypatch.setenv("MADE_WORKSPACE_HOME", str(workspace))
    monkeypatch.setenv("MADE_HOME", str(made.parent))
    (made / "settings.json").write_text(json.dumps({"agentCli": "opencode-v2"}))
    with serve(repository) as service:
        service.register(tmp_path / "opencode/service.json")

        def respond(path, count):
            parts = urlsplit(path).path.split("/")
            session = parts[3]
            if session == "ses_absent":
                return Reply(
                    {
                        "_tag": "SessionNotFoundError",
                        "sessionID": session,
                        "message": "Session not found",
                    },
                    404,
                )
            if session == "ses_endpoint":
                return Reply({"message": "Session not found"}, 404)
            if parts[-1] != "message":
                return Reply(
                    {
                        "data": {
                            "id": session,
                            "location": {
                                "directory": str(
                                    foreign if session == "ses_foreign" else repository
                                )
                            },
                        }
                    }
                )
            records = (
                []
                if session == "ses_empty"
                else [
                    {
                        "id": "msg_user",
                        "type": "user",
                        "text": "local question",
                        "time": {"created": 1000},
                    },
                    {
                        "id": "msg_answer",
                        "type": "assistant",
                        "content": [{"type": "text", "text": "local answer"}],
                        "time": {"created": 2000},
                    },
                ]
            )
            return Reply({"data": records, "cursor": {"previous": None, "next": None}})

        service.respond = respond
        yield repository, foreign, service


def test_service_preserves_snapshot_even_with_newer_start_and_missing(history_store):
    repository, foreign, service = history_store
    cli = agent_service.get_agent_cli(repository)
    mismatch = cli.export_session("ses_foreign", repository)
    assert not mismatch.success and mismatch.messages == []
    assert mismatch.error_code == "session_directory_mismatch"
    with pytest.raises(agent_service.SessionDirectoryMismatchError) as failure:
        agent_service.export_chat_history("ses_foreign", channel="repository")
    assert str(foreign) not in str(failure.value)
    history = agent_service.export_chat_history(
        "ses_local", start_timestamp=999999, channel="repository"
    )
    assert [message["content"] for message in history["messages"]] == [
        "local question",
        "local answer",
    ]
    assert history["historyMode"] == "snapshot"
    for session in ["ses_empty", "ses_absent"]:
        result = agent_service.export_chat_history(session, channel="repository")
        assert result["messages"] == [] and result["historyMode"] == "snapshot"
    with pytest.raises(RuntimeError, match="endpoint"):
        agent_service.export_chat_history("ses_endpoint", channel="repository")
    assert not any("ses_foreign/message" in path for path in service.requests)


@pytest.mark.parametrize(
    "route",
    [
        "repositories/repository",
        "knowledge/notes/item.md",
        "constitutions/policy.md",
        "tasks/daily.md",
    ],
)
def test_history_routes_return_safe_409_without_foreign_content(history_store, route):
    _, foreign, service = history_store
    response = TestClient(app).get(
        f"/api/{route}/agent/history", params={"session_id": "ses_foreign"}
    )
    assert response.status_code == 409
    assert response.json() == {
        "detail": {
            "code": "session_directory_mismatch",
            "message": "This session belongs to a different directory and cannot be loaded here. Start a new session, or ask an operator to verify its intended location before recovery.",
        }
    }
    assert str(foreign) not in response.text
    assert service.requests == ["/api/session/ses_foreign"]


def test_same_id_timestamp_revisions_return_complete_snapshot(history_store):
    _, _, service = history_store
    for text in ["original", "longer revised answer", "same-size", "x"]:

        def respond(path, count):
            if "/message" not in path:
                return Reply(
                    {
                        "data": {
                            "id": "ses_local",
                            "location": {"directory": str(service.directory)},
                        }
                    }
                )
            return Reply(
                {
                    "data": [
                        {
                            "id": "msg_z",
                            "type": "user",
                            "text": "repeat",
                            "time": {"created": 2000},
                        },
                        {
                            "id": "msg_a",
                            "type": "user",
                            "text": "repeat",
                            "time": {"created": 1000},
                        },
                        {
                            "id": "msg_answer",
                            "type": "assistant",
                            "time": {"created": 3000},
                            "content": [{"type": "text", "text": text}],
                        },
                    ],
                    "cursor": {"next": None},
                }
            )

        service.respond = respond
        result = agent_service.export_chat_history(
            "ses_local", start_timestamp=99999, channel="repository"
        )
        assert result["historyMode"] == "snapshot"
        assert [message["messageId"] for message in result["messages"]] == [
            "msg_z",
            "msg_a",
            "msg_answer:0",
        ]
        assert [message["content"] for message in result["messages"]] == [
            "repeat",
            "repeat",
            text,
        ]
        assert result["messages"][2]["timestamp"] == "1970-01-01T00:00:03.000Z"
