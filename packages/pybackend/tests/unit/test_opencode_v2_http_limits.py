"""Adversarial CPU and logging checks against the real local HTTP transport."""

import asyncio
import logging
import json
import time
import traceback

import pytest
import httpx

import opencode_v2_http_history as history
from opencode_v2_agent_cli import OpenCodeV2AgentCLI
from tests.unit.opencode_http_fixture import Reply, serve


def test_json_deadline_is_checked_within_a_network_chunk(tmp_path):
    async def scan():
        read = history._Read("ses_test", tmp_path)
        budget = history.JsonBudget()

        def expire():
            read.deadline = time.monotonic() - 1

        # Expire at the first cooperative yield, without scheduler timing noise.
        asyncio.get_running_loop().call_soon(expire)
        chunk = b"[" + b"0," * (history.CHUNK_BYTES // 2 - 2) + b"0] "
        with pytest.raises(history.HistoryReadError, match="total deadline"):
            await budget.feed(chunk, read.remaining)
        assert 0 < budget.structures <= 1024
        assert budget.depth == 1

    asyncio.run(scan())


@pytest.mark.parametrize("shape", ["dense", "whitespace"])
def test_cpu_bound_json_cannot_hold_export_past_deadline(tmp_path, monkeypatch, shape):
    extra = (
        b"[" + b"0," * 14_999_999 + b"0]"
        if shape == "dense"
        else b" " * 30_000_000 + b"0"
    )
    body = (
        b'{"data":{"id":"ses_test","location":{"directory":'
        + json.dumps(str(tmp_path)).encode()
        + b'},"extra":'
        + extra
        + b"}}"
    )
    monkeypatch.setattr(history, "DEADLINE_SECONDS", 0.6)
    with serve(tmp_path) as service:
        registration = tmp_path / "registration"
        service.register(registration)
        service.respond = lambda path, count: Reply(body)
        started = time.monotonic()
        with pytest.raises(history.HistoryReadError, match="complexity|deadline"):
            history.read_session("ses_test", tmp_path, registration)
        elapsed = time.monotonic() - started
    assert elapsed < 1.2
    assert len(service.requests) == 1 and len(body) < history.MAX_BYTES


@pytest.mark.parametrize("failure", [False, True])
def test_private_cursor_is_absent_from_logs_and_error_chains(tmp_path, caplog, failure):
    caplog.set_level(logging.INFO, logger="httpx")
    filters = list(logging.getLogger("httpx").filters)
    with serve(tmp_path) as service:
        registration = tmp_path / "registration"
        service.register(registration)

        def respond(path, count):
            if "/message" not in path:
                return Reply(
                    {
                        "data": {
                            "id": "ses_test",
                            "location": {"directory": str(tmp_path)},
                        }
                    }
                )
            if "cursor=" not in path:
                return Reply(
                    {"data": [{"id": "msg_one"}], "cursor": {"next": service.password}}
                )
            if failure:
                return Reply(
                    {
                        "message": "private-upstream-body private-prompt /private-foreign-path"
                    },
                    500,
                )
            return Reply({"data": [], "cursor": {"next": None}})

        service.respond = respond
        rendered = ""
        if failure:
            with pytest.raises(history.HistoryReadError) as error:
                history.read_session("ses_test", tmp_path, registration)
            rendered = "".join(traceback.format_exception(error.value))
        else:
            result = history.read_session("ses_test", tmp_path, registration)
            assert [record["id"] for record in result] == ["msg_one"]
        unrelated = httpx.get(service.url + "/unrelated", trust_env=False, timeout=2)
        assert unrelated.status_code == 401
    assert any("cursor=" in path for path in service.requests)
    combined = caplog.text + rendered
    assert not any(
        secret in combined
        for secret in [
            service.password,
            "private-upstream-body",
            "private-prompt",
            "/private-foreign-path",
            "Authorization",
        ]
    )
    assert "/unrelated" in caplog.text and "401" in caplog.text
    assert logging.getLogger("httpx").filters == filters


@pytest.mark.parametrize("size", [1_760_000, 30_000_000])
def test_large_tool_text_remains_supported_under_complexity_budget(
    tmp_path, monkeypatch, size
):
    monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path))
    # Punctuation inside a quoted string must not consume structural budget.
    text = b"x{[,:]}" * (size // 7)
    body = (
        b'{"data":[{"id":"msg_tool","type":"assistant","time":{"created":1000},'
        b'"content":[{"type":"tool","name":"bash","id":"call_tool",'
        b'"state":{"status":"completed","input":{"command":"pwd"},'
        b'"content":[{"type":"text","text":"'
        + text
        + b'"}]}}]}],"cursor":{"next":null}}'
    )
    with serve(tmp_path) as service:
        service.register(tmp_path / "opencode/service.json")
        service.respond = (
            lambda path, count: Reply(body)
            if "/message" in path
            else Reply(
                {"data": {"id": "ses_test", "location": {"directory": str(tmp_path)}}}
            )
        )
        result = OpenCodeV2AgentCLI().export_session("ses_test", tmp_path)
    assert result.success and len(service.requests) == 3
    assert [(message.content, message.call_id) for message in result.messages] == [
        ("Tool: bash\n  command: pwd", "call_tool")
    ]


@pytest.mark.parametrize(
    "extra,limit",
    [
        (b"[" * 65 + b"0" + b"]" * 65, "complexity"),
        (b"1" * 129, "token"),
    ],
)
def test_pathological_nesting_and_numbers_are_rejected_before_decode(
    tmp_path, extra, limit
):
    body = b'{"data":{},"extra":' + extra + b"}"
    with serve(tmp_path) as service:
        registration = tmp_path / "registration"
        service.register(registration)
        service.respond = lambda path, count: Reply(body)
        with pytest.raises(history.HistoryReadError, match=limit) as failure:
            history.read_session("ses_test", tmp_path, registration)
    assert len(service.requests) == 1
    assert failure.value.__cause__ is None


def test_escaped_quote_across_network_chunks_preserves_string_budget(tmp_path):
    prefix = (
        b'{"data":'
        + json.dumps(
            {"id": "ses_test", "location": {"directory": str(tmp_path)}}
        ).encode()
        + b',"extra":"'
    )
    body = (
        prefix
        + b"x" * (history.CHUNK_BYTES - len(prefix) - 1)
        + b'\\"'
        + b"[]{},:" * 100_000
        + b'"}'
    )
    with serve(tmp_path) as service:
        registration = tmp_path / "registration"
        service.register(registration)
        service.respond = (
            lambda path, count: Reply({"data": [], "cursor": {"next": None}})
            if "/message" in path
            else Reply(body)
        )
        result = history.read_session("ses_test", tmp_path, registration)
    assert result == []
    assert len(service.requests) == 3 and service.authenticated == [True] * 3
