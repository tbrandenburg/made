"""Exercise production HTTP transport and conversion against owned real servers."""

import asyncio
import json
from pathlib import Path
import socket
import time
import traceback
from urllib.parse import parse_qs, urlsplit

import pytest

from opencode_v2_agent_cli import OpenCodeV2AgentCLI
import opencode_v2_http_history as history
from tests.unit.opencode_http_fixture import Reply, serve


def metadata(directory: Path, session: str = "ses_test", **extra: object) -> Reply:
    return Reply(
        {
            "data": {
                "id": session,
                "location": {"directory": str(directory.resolve())},
                **extra,
            }
        }
    )


def page(records: list[dict[str, object]], cursor: object = None) -> Reply:
    return Reply({"data": records, "cursor": {"previous": None, "next": cursor}})


def user(identifier: str = "msg_user", text: str = "question") -> dict[str, object]:
    return {
        "id": identifier,
        "type": "user",
        "text": text,
        "time": {"created": 1700000000123},
    }


def test_three_pages_full_terminal_conversion_without_database(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENCODE_DB", str(tmp_path / "absent.db"))
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    records = [user(f"msg_{n:03}", f"question {n}") for n in range(149)] + [
        {
            "id": "msg_answer",
            "type": "assistant",
            "time": {"created": 1700000001123},
            "content": [
                {"type": "text", "text": "answer", "partID": "prt_text"},
                {"type": "reasoning", "text": ""},
                {
                    "type": "reasoning",
                    "text": "thinking",
                    "time": {"created": 1700000001023},
                },
                {
                    "type": "tool",
                    "name": "read",
                    "id": "fallback",
                    "callID": "primary",
                    "callId": "secondary",
                    "partId": "prt_tool",
                    "state": {"input": {"filePath": "README.md"}},
                },
                {
                    "type": "tool",
                    "tool": "bash",
                    "callId": "alias",
                    "id": "fallback2",
                    "state": {"input": {"command": "pwd"}},
                },
                {
                    "type": "tool",
                    "name": "write",
                    "id": "fallback3",
                    "state": {"input": {"limit": 3}},
                },
                {"type": "future", "payload": "ignored"},
            ],
        }
    ]
    with serve(tmp_path) as service:
        service.register(tmp_path / "opencode/service.json")

        def respond(path, _count):
            if "/message" not in path:
                return metadata(tmp_path)
            query = parse_qs(urlsplit(path).query)
            position = {None: 0, "opaque one": 50, "opaque two": 100}[
                query.get("cursor", [None])[0]
            ]
            return page(
                records[position : position + 50],
                {0: "opaque one", 50: "opaque two", 100: None}[position],
            )

        service.respond = respond
        result = OpenCodeV2AgentCLI().export_session("ses_test", tmp_path)
    assert result.success and result.history_mode == "snapshot"
    assert [m.message_id for m in result.messages[:149]] == [
        f"msg_{n:03}" for n in range(149)
    ]
    assert [
        (m.message_id, m.content_type, m.content, m.timestamp, m.part_id, m.call_id)
        for m in result.messages[149:]
    ] == [
        ("msg_answer:0", "text", "answer", 1700000001123, "prt_text", None),
        ("msg_answer:2", "reasoning", "thinking", 1700000001023, None, None),
        (
            "msg_answer:3",
            "tool_use",
            "Tool: read\n  filePath: README.md",
            1700000001123,
            "prt_tool",
            "primary",
        ),
        (
            "msg_answer:4",
            "tool_use",
            "Tool: bash\n  command: pwd",
            1700000001123,
            None,
            "alias",
        ),
        (
            "msg_answer:5",
            "tool_use",
            "Tool: write\n  limit: 3",
            1700000001123,
            None,
            "fallback3",
        ),
    ]
    assert result.messages[0].timestamp == 1700000000123
    assert service.requests == [
        "/api/session/ses_test",
        "/api/session/ses_test/message?limit=50&order=asc",
        "/api/session/ses_test/message?limit=50&cursor=opaque+one",
        "/api/session/ses_test/message?limit=50&cursor=opaque+two",
        "/api/session/ses_test",
    ]
    assert service.authenticated == [True] * 5 and not (tmp_path / "absent.db").exists()


@pytest.mark.parametrize("change", ["foreign", "child", "after-foreign", "after-child"])
def test_ownership_before_content_and_after_read(tmp_path, change):
    with serve(tmp_path) as service:
        service.register(tmp_path / "registration")

        def respond(path, count):
            if "/message" in path:
                return page([user()])
            changed = not change.startswith("after") or count == 3
            return metadata(
                tmp_path / "private" if changed and "foreign" in change else tmp_path,
                **({"parentID": "ses_parent"} if changed and "child" in change else {}),
            )

        service.respond = respond
        with pytest.raises(history.SessionDirectoryMismatch) as failure:
            history.read_session("ses_test", tmp_path, tmp_path / "registration")
    assert "private" not in str(failure.value)
    assert len(service.requests) == (3 if change.startswith("after") else 1)


@pytest.mark.parametrize("status", [401, 403, 500])
def test_service_errors_bounded_and_sanitized(tmp_path, status):
    with serve(tmp_path) as service:
        service.register(tmp_path / "registration")
        service.respond = lambda path, count: Reply(
            {"message": "private prompt synthetic-history-password /foreign/path"},
            status,
        )
        with pytest.raises(history.HistoryReadError) as failure:
            history.read_session("ses_test", tmp_path, tmp_path / "registration")
    rendered = "".join(traceback.format_exception(failure.value))
    assert len(service.requests) == 2
    assert not any(
        secret in rendered
        for secret in [
            service.password,
            "private prompt",
            "/foreign/path",
            "Authorization",
        ]
    )


@pytest.mark.parametrize(
    "body,missing",
    [
        (
            {
                "_tag": "SessionNotFoundError",
                "sessionID": "ses_test",
                "message": "Session not found",
            },
            True,
        ),
        (b"", False),
        ({"message": "Session not found"}, False),
        (
            {
                "_tag": "SessionNotFoundError",
                "sessionID": "ses_other",
                "message": "missing",
            },
            False,
        ),
    ],
)
def test_only_verified_missing_metadata_is_missing(
    tmp_path, monkeypatch, body, missing
):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    with serve(tmp_path) as service:
        service.register(tmp_path / "opencode/service.json")
        service.respond = lambda path, count: Reply(body, 404)
        result = OpenCodeV2AgentCLI().export_session("ses_test", tmp_path)
    assert not result.success and result.messages == [] and len(service.requests) == 1
    assert (result.error_code == "session_not_found") is missing
    assert result.history_mode == "snapshot"


@pytest.mark.parametrize(
    "reply",
    [
        Reply(b"not JSON"),
        Reply({}),
        Reply({"data": [], "cursor": {}}),
        Reply({"data": [{"id": ""}], "cursor": {"next": None}}),
        Reply({"data": [], "cursor": {"next": 42}}),
        Reply({"data": [], "cursor": {"next": None, "previous": 42}}),
        Reply({}, 404),
        Reply({}, 302, {"Location": "http://127.0.0.1:1/leak"}),
        Reply(b"compressed", headers={"Content-Encoding": "gzip"}),
    ],
)
def test_malformed_or_failed_page_never_succeeds(tmp_path, reply):
    with serve(tmp_path) as service:
        service.register(tmp_path / "registration")
        service.respond = (
            lambda path, count: reply if "/message" in path else metadata(tmp_path)
        )
        with pytest.raises(history.HistoryReadError) as failure:
            history.read_session("ses_test", tmp_path, tmp_path / "registration")
    assert len(service.requests) == 2
    assert failure.value.__cause__ is None


@pytest.mark.parametrize("failure", ["overlap", "repeated", "invalidated", "later500"])
def test_pagination_failure_restarts_from_first_page_and_exhausts_once(
    tmp_path, failure
):
    with serve(tmp_path) as service:
        service.register(tmp_path / "registration")

        def respond(path, count):
            if "/message" not in path:
                return metadata(tmp_path)
            if "cursor=" not in path:
                return page([user("msg_1")], "opaque")
            if failure == "overlap":
                return page([user("msg_1")])
            if failure == "repeated":
                return page([user("msg_2")], "opaque")
            if failure == "invalidated":
                return Reply({"_tag": "InvalidCursorError", "message": "invalid"}, 400)
            return Reply({}, 500)

        service.respond = respond
        with pytest.raises(history.HistoryReadError):
            history.read_session("ses_test", tmp_path, tmp_path / "registration")
    assert len(service.requests) == 6
    assert service.requests[:3] == service.requests[3:]


@pytest.mark.parametrize("stage", ["metadata", "page2", "final", "connection"])
def test_registration_rotation_restarts_entire_read_including_final_recheck(
    tmp_path, stage
):
    registration = tmp_path / "registration"
    with serve(tmp_path) as old, serve(tmp_path, "rotated-password") as new:
        old.register(registration)

        def respond(path, count):
            failure = {"metadata": 1, "page2": 3, "final": 3, "connection": 1}[stage]
            if count == failure:
                new.register(registration)
                return Reply({}, 401, disconnect=stage == "connection")
            if "/message" not in path:
                return metadata(tmp_path)
            return page([user("msg_old")], "old-cursor" if stage == "page2" else None)

        old.respond = respond
        new.respond = (
            lambda path, count: page([user("msg_new", "fresh")])
            if "/message" in path
            else metadata(tmp_path)
        )
        result = history.read_session("ses_test", tmp_path, registration)
    assert [record["id"] for record in result] == ["msg_new"]
    assert new.requests == [
        "/api/session/ses_test",
        "/api/session/ses_test/message?limit=50&order=asc",
        "/api/session/ses_test",
    ]
    assert len(old.requests) == (1 if stage in {"metadata", "connection"} else 3)
    assert new.authenticated == [True] * 3


def test_shared_retry_budget_overlap_then_final_auth_failure(tmp_path):
    registration = tmp_path / "registration"
    with serve(tmp_path) as service:
        service.register(registration)

        def respond(path, count):
            if count == 6:
                return Reply({}, 403)
            if "/message" not in path:
                return metadata(tmp_path)
            return page([user()], "cursor" if count == 2 else None)

        service.respond = respond
        with pytest.raises(history.HistoryReadError):
            history.read_session("ses_test", tmp_path, registration)
    assert len(service.requests) == 6
    assert service.requests[3] == "/api/session/ses_test"


@pytest.mark.parametrize(
    "bound,value", [("MAX_BYTES", 100), ("MAX_PAGES", 1), ("MAX_RECORDS", 1)]
)
def test_operation_bounds_fail_closed(tmp_path, monkeypatch, bound, value):
    monkeypatch.setattr(history, bound, value)
    with serve(tmp_path) as service:
        service.register(tmp_path / "registration")
        service.respond = (
            lambda path, count: page([user("msg_a"), user("msg_b")], "next")
            if "/message" in path
            else metadata(tmp_path)
        )
        with pytest.raises(history.HistoryReadError, match="limit"):
            history.read_session("ses_test", tmp_path, tmp_path / "registration")
    assert 1 <= len(service.requests) <= 2
    assert not service.requests[-1].endswith("cursor=next")


@pytest.mark.parametrize("mode", ["headers", "trickle", "read-timeout"])
def test_total_deadline_cancels_blocked_stream(tmp_path, monkeypatch, mode):
    monkeypatch.setattr(
        history, "DEADLINE_SECONDS", 0.18 if mode != "read-timeout" else 2
    )
    if mode == "read-timeout":
        monkeypatch.setattr(history, "READ_SECONDS", 0.05)
    with serve(tmp_path) as service:
        service.register(tmp_path / "registration")
        service.respond = lambda path, count: Reply(
            {"private": "prompt"},
            delay=0.5 if mode != "trickle" else 0,
            trickle=0.05 if mode == "trickle" else 0,
        )
        start = time.monotonic()
        with pytest.raises(history.HistoryReadError):
            history.read_session("ses_test", tmp_path, tmp_path / "registration")
        elapsed = time.monotonic() - start
    assert elapsed < 0.8
    assert 1 <= len(service.requests) <= 2


def test_connection_refused_is_sanitized_without_sql(tmp_path):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    registration = tmp_path / "registration"
    registration.write_text(
        json.dumps({"url": f"http://127.0.0.1:{port}", "password": "private-password"})
    )
    with pytest.raises(history.HistoryReadError) as failure:
        history.read_session("ses_test", tmp_path, registration)
    rendered = "".join(traceback.format_exception(failure.value))
    assert "private-password" not in rendered and str(registration) not in rendered
    assert "127.0.0.1" not in rendered and failure.value.__cause__ is None


@pytest.mark.parametrize(
    "url",
    [
        "http://@127.0.0.1:10",
        "http://:p@127.0.0.1:10",
        "http://127.0.0.1",
        "http://localhost:10",
        "http://localhost.evil:10",
        "http://127.0.0.1:0",
        "http://127.0.0.1:65536",
        "http://127.0.0.1:abc",
        "http://127.0.0.1:10/api",
        "http://127.0.0.1:10?",
        "http://127.0.0.1:10#",
        "http://192.0.2.1:10",
        "https://127.0.0.1:10",
        "http://127.0.0.1:10\n",
    ],
)
def test_invalid_registration_never_attaches_credentials(tmp_path, url):
    path = tmp_path / "registration"
    path.write_text(json.dumps({"url": url, "password": "private-password"}))
    with pytest.raises(history.HistoryReadError, match="registration") as failure:
        history.read_session("ses_test", tmp_path, path)
    assert "private-password" not in str(failure.value)
    assert url not in str(failure.value) and failure.value.__cause__ is None


def test_proxy_environment_and_redirect_never_receive_credentials(
    tmp_path, monkeypatch
):
    with serve(tmp_path) as service, serve(tmp_path) as sink:
        for variable in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ]:
            monkeypatch.setenv(variable, sink.url)
        monkeypatch.setenv("NO_PROXY", "")
        service.register(tmp_path / "registration")
        assert (
            history.read_session("ses_test", tmp_path, tmp_path / "registration") == []
        )
        service.respond = lambda path, count: Reply(
            {}, 302, {"Location": sink.url + "/leak"}
        )
        with pytest.raises(history.HistoryReadError):
            history.read_session("ses_test", tmp_path, tmp_path / "registration")
    assert sink.requests == [] and len(service.requests) == 4
    assert service.authenticated == [True] * 4


@pytest.mark.parametrize(
    "record",
    [
        {"id": "msg_bad", "type": "user", "time": {"created": 1}},
        {"id": "msg_bad", "type": "user", "text": "hi", "time": {"created": "bad"}},
        {"id": "msg_bad", "type": "assistant", "time": {"created": 1}, "content": [42]},
        {
            "id": "msg_bad",
            "type": "assistant",
            "time": {"created": 1},
            "content": [{"type": "text", "text": 42}],
        },
        {
            "id": "msg_bad",
            "role": "user",
            "time": {"created": 1},
            "text": "wrong v1 shape",
        },
    ],
)
def test_malformed_required_conversion_fields_fail_not_drop(
    tmp_path, monkeypatch, record
):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    with serve(tmp_path) as service:
        service.register(tmp_path / "opencode/service.json")
        service.respond = (
            lambda path, count: page([user(), record])
            if "/message" in path
            else metadata(tmp_path)
        )
        result = OpenCodeV2AgentCLI().export_session("ses_test", tmp_path)
    assert not result.success and result.messages == []
    assert (
        "wrong v1 shape" not in result.error_message
        and result.history_mode == "snapshot"
    )


def test_public_id_prefix_schema_and_sync_adapter_in_async_host(tmp_path):
    registration = tmp_path / "registration"
    with serve(tmp_path) as service:
        service.register(registration)

        async def caller():
            return history.read_session("ses.with.dots", tmp_path, registration)

        result = asyncio.run(caller())
    assert result == []
    assert service.requests == [
        "/api/session/ses.with.dots",
        "/api/session/ses.with.dots/message?limit=50&order=asc",
        "/api/session/ses.with.dots",
    ]
