import json
import subprocess
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

from agent_service import (
    _format_timestamp,
    _format_timestamp_optional,
    _resolve_part_timestamp,
    _resolve_message_timestamp,
    _to_milliseconds,
    export_chat_history,
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
                    {"id": "prt_text_1", "type": "text", "text": "Hi", "timestamp": 2000},
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

    @patch("agent_service.subprocess.run")
    def test_export_chat_history_success(self, mock_run):
        def _fake_run(cmd, stdout=None, stderr=None, text=None, cwd=None):
            if stdout is not None:
                stdout.write(json.dumps(self.SAMPLE_EXPORT))
                stdout.flush()
            mock_result = Mock()
            mock_result.returncode = 0
            mock_result.stderr = ""
            return mock_result

        mock_run.side_effect = _fake_run

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

    @patch("agent_service.subprocess.run")
    def test_export_chat_history_with_start_filter(self, mock_run):
        def _fake_run(cmd, stdout=None, stderr=None, text=None, cwd=None):
            if stdout is not None:
                stdout.write(json.dumps(self.SAMPLE_EXPORT))
                stdout.flush()
            mock_result = Mock()
            mock_result.returncode = 0
            mock_result.stderr = ""
            return mock_result

        mock_run.side_effect = _fake_run

        result = export_chat_history("ses_123", start_timestamp=2000)

        assert [msg["content"] for msg in result["messages"]] == ["Hi", "search", "todowrite"]

    def test_export_chat_history_missing_session(self):
        with pytest.raises(ValueError):
            export_chat_history("")

    @patch("agent_service.subprocess.run")
    def test_export_chat_history_missing_opencode(self, mock_run):
        mock_run.side_effect = FileNotFoundError()

        with pytest.raises(FileNotFoundError):
            export_chat_history("ses_123")

    @patch("agent_service.subprocess.run")
    def test_export_chat_history_failure(self, mock_run):
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stderr = "Failed"
        mock_run.return_value = mock_result

        with pytest.raises(RuntimeError):
            export_chat_history("ses_123")

    @patch("agent_service.subprocess.run")
    def test_export_chat_history_bad_json(self, mock_run):
        def _fake_run(cmd, stdout=None, stderr=None, text=None, cwd=None):
            if stdout is not None:
                stdout.write("not json")
                stdout.flush()
            mock_result = Mock()
            mock_result.returncode = 0
            mock_result.stderr = ""
            return mock_result

        mock_run.side_effect = _fake_run

        with pytest.raises(ValueError):
            export_chat_history("ses_123")

    @patch("agent_service.subprocess.run")
    def test_export_chat_history_rejects_non_json_prefix_or_suffix(self, mock_run):
        payload = json.dumps(self.SAMPLE_EXPORT)

        def _fake_run(cmd, stdout=None, stderr=None, text=None, cwd=None):
            if stdout is not None:
                stdout.write(f"intro text\n{payload}\ntrailing stats")
                stdout.flush()
            mock_result = Mock()
            mock_result.returncode = 0
            mock_result.stderr = ""
            return mock_result

        mock_run.side_effect = _fake_run

        with pytest.raises(ValueError):
            export_chat_history("ses_123")

    @patch("agent_service.subprocess.run")
    def test_export_chat_history_rejects_multiple_json_blocks(self, mock_run):
        first_payload = json.dumps(self.SAMPLE_EXPORT)
        second_payload = json.dumps({"messages": []})

        def _fake_run(cmd, stdout=None, stderr=None, text=None, cwd=None):
            if stdout is not None:
                stdout.write(
                    f"INFO log before\n{first_payload}\nnoise-between\n{second_payload}"
                )
                stdout.flush()
            mock_result = Mock()
            mock_result.returncode = 0
            mock_result.stderr = ""
            return mock_result

        mock_run.side_effect = _fake_run

        with pytest.raises(ValueError):
            export_chat_history("ses_123")

    @patch("agent_service.subprocess.run")
    @patch("agent_service._get_working_directory")
    def test_export_chat_history_uses_channel_working_directory(
        self, mock_get_working_directory, mock_run
    ):
        mock_get_working_directory.return_value = Path("/tmp/workspace/sample")
        def _fake_run(cmd, stdout=None, stderr=None, text=None, cwd=None):
            if stdout is not None:
                stdout.write(json.dumps(self.SAMPLE_EXPORT))
                stdout.flush()
            mock_result = Mock()
            mock_result.returncode = 0
            mock_result.stderr = ""
            return mock_result

        mock_run.side_effect = _fake_run

        export_chat_history("ses_123", channel="sample")

        mock_get_working_directory.assert_called_once_with("sample")
        mock_run.assert_called_once_with(
            ["opencode", "export", "ses_123"],
            stdout=mock_run.call_args.kwargs["stdout"],
            stderr=subprocess.PIPE,
            text=True,
            cwd=Path("/tmp/workspace/sample"),
        )
