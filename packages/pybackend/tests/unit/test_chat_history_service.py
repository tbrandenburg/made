from pathlib import Path
from unittest.mock import patch

import pytest

from agent_cli import (
    ExportMessage,
    ExportResult,
    _format_timestamp,
    _format_timestamp_optional,
    _resolve_part_timestamp,
    _resolve_message_timestamp,
    _to_milliseconds,
)
from agent_service import export_chat_history


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
    @patch("agent_service.AGENT_CLI.export_session")
    def test_export_chat_history_success(self, mock_export):
        mock_export.return_value = ExportResult(
            session_id="ses_123",
            messages=[
                ExportMessage(
                    message_id="msg_1",
                    role="user",
                    type="text",
                    content="Hello",
                    timestamp="1970-01-01T00:00:01.000Z",
                    part_id="prt_user_1",
                ),
                ExportMessage(
                    message_id="msg_2",
                    role="assistant",
                    type="text",
                    content="Hi",
                    timestamp="1970-01-01T00:00:02.000Z",
                    part_id="prt_text_1",
                ),
                ExportMessage(
                    message_id="msg_2",
                    role="assistant",
                    type="tool_use",
                    content="search",
                    timestamp="1970-01-01T00:00:02.500Z",
                    part_id="prt_tool_use",
                    call_id="call_search_1",
                ),
                ExportMessage(
                    message_id="msg_2",
                    role="assistant",
                    type="tool",
                    content="todowrite",
                    timestamp="1970-01-01T00:00:03.100Z",
                    part_id="prt_tool_1",
                ),
            ],
        )

        result = export_chat_history("ses_123")

        assert result["sessionId"] == "ses_123"
        assert result["messages"] == [
            {
                "messageId": "msg_1",
                "role": "user",
                "type": "text",
                "content": "Hello",
                "timestamp": "1970-01-01T00:00:01.000Z",
                "partId": "prt_user_1",
            },
            {
                "messageId": "msg_2",
                "role": "assistant",
                "type": "text",
                "content": "Hi",
                "timestamp": "1970-01-01T00:00:02.000Z",
                "partId": "prt_text_1",
            },
            {
                "messageId": "msg_2",
                "role": "assistant",
                "type": "tool_use",
                "content": "search",
                "timestamp": "1970-01-01T00:00:02.500Z",
                "partId": "prt_tool_use",
                "callId": "call_search_1",
            },
            {
                "messageId": "msg_2",
                "role": "assistant",
                "type": "tool",
                "content": "todowrite",
                "timestamp": "1970-01-01T00:00:03.100Z",
                "partId": "prt_tool_1",
            },
        ]

    @patch("agent_service.AGENT_CLI.export_session")
    def test_export_chat_history_with_start_filter(self, mock_export):
        mock_export.return_value = ExportResult(
            session_id="ses_123",
            messages=[
                ExportMessage(
                    message_id="msg_2",
                    role="assistant",
                    type="text",
                    content="Hi",
                    timestamp="1970-01-01T00:00:02.000Z",
                    part_id="prt_text_1",
                ),
                ExportMessage(
                    message_id="msg_2",
                    role="assistant",
                    type="tool_use",
                    content="search",
                    timestamp="1970-01-01T00:00:02.500Z",
                    part_id="prt_tool_use",
                    call_id="call_search_1",
                ),
                ExportMessage(
                    message_id="msg_2",
                    role="assistant",
                    type="tool",
                    content="todowrite",
                    timestamp="1970-01-01T00:00:03.100Z",
                    part_id="prt_tool_1",
                ),
            ],
        )

        result = export_chat_history("ses_123", start_timestamp=2000)

        assert [msg["content"] for msg in result["messages"]] == ["Hi", "search", "todowrite"]

    def test_export_chat_history_missing_session(self):
        with pytest.raises(ValueError):
            export_chat_history("")

    @patch("agent_service.AGENT_CLI.export_session")
    def test_export_chat_history_missing_opencode(self, mock_export):
        mock_export.side_effect = FileNotFoundError()

        with pytest.raises(FileNotFoundError):
            export_chat_history("ses_123")

    @patch("agent_service.AGENT_CLI.export_session")
    def test_export_chat_history_failure(self, mock_export):
        mock_export.side_effect = RuntimeError("Failed")

        with pytest.raises(RuntimeError):
            export_chat_history("ses_123")

    @patch("agent_service.AGENT_CLI.export_session")
    def test_export_chat_history_bad_json(self, mock_export):
        mock_export.side_effect = ValueError("Invalid export data returned by opencode")

        with pytest.raises(ValueError):
            export_chat_history("ses_123")

    @patch("agent_service.AGENT_CLI.export_session")
    def test_export_chat_history_rejects_non_json_prefix_or_suffix(self, mock_export):
        mock_export.side_effect = ValueError("Invalid export data returned by opencode")

        with pytest.raises(ValueError):
            export_chat_history("ses_123")

    @patch("agent_service.AGENT_CLI.export_session")
    def test_export_chat_history_rejects_multiple_json_blocks(self, mock_export):
        mock_export.side_effect = ValueError("Invalid export data returned by opencode")

        with pytest.raises(ValueError):
            export_chat_history("ses_123")

    @patch("agent_service.AGENT_CLI.export_session")
    @patch("agent_service._get_working_directory")
    def test_export_chat_history_uses_channel_working_directory(
        self, mock_get_working_directory, mock_export
    ):
        mock_get_working_directory.return_value = Path("/tmp/workspace/sample")
        mock_export.return_value = ExportResult(session_id="ses_123", messages=[])

        export_chat_history("ses_123", channel="sample")

        mock_get_working_directory.assert_called_once_with("sample")
        mock_export.assert_called_once()
        args, kwargs = mock_export.call_args
        assert args[0] == "ses_123"
        assert args[1] == Path("/tmp/workspace/sample")
        assert "stdout" in kwargs
