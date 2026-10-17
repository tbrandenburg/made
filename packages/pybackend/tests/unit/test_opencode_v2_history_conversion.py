"""Strict projected-record conversion, using the production formatter."""

import time

import pytest

from opencode_v2_agent_cli import OpenCodeV2AgentCLI
from opencode_v2_history_conversion import convert_history
from opencode_v2_http_history import HistoryReadError


def test_non_display_events_do_not_require_invented_chat_fields():
    records = [
        {"id": "msg_system", "type": "system"},
        {"id": "msg_future", "type": "future-event"},
        {
            "id": "msg_user1",
            "type": "user",
            "text": "repeat",
            "time": {"created": 1700000000123},
        },
        {
            "id": "msg_user2",
            "type": "user",
            "text": "repeat",
            "time": {"created": 1700000000123},
        },
    ]
    result = convert_history(records, OpenCodeV2AgentCLI._format_tool)
    assert [message.message_id for message in result] == ["msg_user1", "msg_user2"]
    assert [message.content for message in result] == ["repeat", "repeat"]
    assert [message.to_frontend_format()["timestamp"] for message in result] == [
        "2023-11-14T22:13:20.123Z"
    ] * 2


@pytest.mark.parametrize(
    "part",
    [
        {"type": "tool", "id": "fallback", "callID": "", "name": "read", "state": {}},
        {"type": "tool", "id": "call", "name": "read", "state": []},
        {"type": "tool", "id": "call", "state": {}},
        {"type": "text", "text": "answer", "time": {"created": float("nan")}},
        {"type": "text", "text": "answer", "time": {"created": float("inf")}},
        {"type": "text", "text": "answer", "time": {"created": 10**30}},
        {"type": "text", "text": "answer", "partID": False},
        {"text": "answer"},
    ],
)
def test_malformed_display_blocks_fail_sanitized_without_partial_result(part):
    records = [
        {
            "id": "msg_answer",
            "type": "assistant",
            "time": {"created": 1000},
            "content": [{"type": "text", "text": "private transcript"}, part],
        }
    ]
    with pytest.raises(HistoryReadError) as failure:
        convert_history(records, OpenCodeV2AgentCLI._format_tool)
    assert "private transcript" not in str(failure.value)
    assert failure.value.__cause__ is None


def test_conversion_deadline_is_not_refreshed_by_each_block():
    with pytest.raises(HistoryReadError, match="deadline") as failure:
        convert_history([], OpenCodeV2AgentCLI._format_tool, time.monotonic() - 1)
    assert "OpenCode" in str(failure.value)
    assert failure.value.__cause__ is None
