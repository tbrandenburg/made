import pytest

from agent_service import (
    _format_timestamp,
    _format_timestamp_optional,
    _resolve_part_timestamp,
    _resolve_message_timestamp,
    _to_milliseconds,
)


class TestTimestampHelpers:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("1000", 1000),
            (1000.5, 1000),
            (None, None),
            ("bad", None),
        ],
    )
    def test_to_milliseconds(self, raw, expected):
        assert _to_milliseconds(raw) == expected

    def test_format_timestamp(self):
        assert _format_timestamp(0) == "1970-01-01T00:00:00.000Z"
        assert _format_timestamp_optional(None) is None

    def test_resolve_message_timestamp(self):
        message = {"time": {"created": 1234, "completed": 2000}}
        assert _resolve_message_timestamp(message) == 1234
        assert _resolve_message_timestamp({}) is None

    def test_resolve_part_timestamp(self):
        part = {"time": {"start": 5000}}
        assert _resolve_part_timestamp(part, None) == 5000
        part_no_time = {"timestamp": 3000}
        assert _resolve_part_timestamp(part_no_time, 1000) == 3000
        assert _resolve_part_timestamp({}, 1000) == 1000


class TestExportChatHistory:
    SAMPLE_EXPORT = {
        "messages": [
            {
                "info": {
                    "id": "msg_1",
                    "role": "user",
                    "time": {"created": 1000},
                },
                "parts": [
                    {
                        "id": "prt_user_1",
                        "type": "text",
                        "text": "Hello",
                        "time": {"start": 1000},
                    },
                ],
            },
            {
                "info": {
                    "id": "msg_2",
                    "role": "assistant",
                    "time": {"created": 2000},
                },
                "parts": [
                    {
                        "id": "prt_text_1",
                        "type": "text",
                        "text": "Hi",
                        "timestamp": 2000,
                    },
                    {
                        "id": "prt_tool_use",
                        "type": "tool_use",
                        "tool": "search",
                        "callID": "call_search_1",
                        "time": {"end": 2500},
                    },
                    {
                        "id": "prt_tool_1",
                        "type": "tool",
                        "tool": "todowrite",
                        "state": {"time": {"start": 3000, "end": 3100}},
                    },
                ],
            },
            {
                "info": {"id": "msg_3", "role": "system", "time": {"created": 3000}},
                "parts": [{"type": "text", "text": "Ignored"}],
            },
        ]
    }
