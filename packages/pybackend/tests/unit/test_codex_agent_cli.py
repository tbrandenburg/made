"""Unit tests for CodexAgentCLI implementation."""

import json
import tempfile
import unittest.mock
from pathlib import Path

from codex_agent_cli import CodexAgentCLI
from agent_results import (
    AgentListResult,
    ExportResult,
    RunResult,
    SessionListResult,
)


class TestCodexAgentCLI:
    """Test cases for CodexAgentCLI."""

    def test_cli_name(self):
        """Test that cli_name property returns correct value."""
        cli = CodexAgentCLI()
        assert cli.cli_name == "codex"

    def test_missing_command_error(self):
        """Test missing_command_error returns correct error message."""
        cli = CodexAgentCLI()
        error_msg = cli.missing_command_error()
        assert "codex" in error_msg
        assert "command not found" in error_msg
        assert "Please ensure it is installed and in PATH" in error_msg

    def test_parse_codex_output_success(self):
        """Test parsing of codex JSON event stream."""
        cli = CodexAgentCLI()
        mock_stdout = """{"type": "thread.started", "thread_id": "session-123"}
{"type": "item.completed", "item": {"text": "Hello from codex"}, "timestamp": 1736766000000}
{"type": "turn.completed", "usage": {"tokens": 150}}"""

        session_id, response_parts = cli._parse_codex_output(mock_stdout)

        assert session_id == "session-123"
        assert len(response_parts) == 1
        assert response_parts[0].text == "Hello from codex"
        assert response_parts[0].timestamp == 1736766000000
        assert response_parts[0].part_type == "final"

    def test_parse_codex_output_malformed(self):
        """Test parsing of malformed JSON in codex output."""
        cli = CodexAgentCLI()
        mock_stdout = """{"type": "thread.started", "thread_id": "session-123"}
invalid json line here
{"type": "item.completed", "item": {"text": "Valid response"}}"""

        session_id, response_parts = cli._parse_codex_output(mock_stdout)

        assert session_id == "session-123"
        assert len(response_parts) == 1
        assert response_parts[0].text == "Valid response"

    def test_parse_codex_output_empty(self):
        """Test parsing of empty codex output."""
        cli = CodexAgentCLI()
        mock_stdout = ""

        session_id, response_parts = cli._parse_codex_output(mock_stdout)

        assert session_id is None
        assert len(response_parts) == 0

    @unittest.mock.patch("subprocess.run")
    def test_run_agent_command_structure(self, mock_run):
        """Test run_agent builds correct command structure."""
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = (
            '{"type": "item.completed", "item": {"text": "Test response"}}'
        )
        mock_run.return_value.stderr = ""

        cli = CodexAgentCLI()
        result = cli.run_agent("test message", None, None, None, Path("."))

        assert isinstance(result, RunResult)
        assert result.success is True
        assert len(result.response_parts) == 1
        assert result.response_parts[0].text == "Test response"

        # Verify subprocess was called correctly
        mock_run.assert_called_once()
        call_args = mock_run.call_args
        assert call_args[0][0] == [
            "codex",
            "exec",
            "--json",
            # No message argument - passed via stdin
        ]
        # Verify stdin usage
        assert call_args[1]["input"] == "test message"

    @unittest.mock.patch("subprocess.run")
    def test_run_agent_with_session_resume(self, mock_run):
        """Test run_agent with session resumption."""
        with tempfile.TemporaryDirectory() as temp_codex_home:
            # Create mock codex session directory structure
            sessions_dir = Path(temp_codex_home) / "sessions"
            year_dir = sessions_dir / "2024"
            month_dir = year_dir / "01"
            day_dir = month_dir / "31"
            day_dir.mkdir(parents=True)
            session_file = day_dir / "rollout-session-123.jsonl"
            session_file.touch()

            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = (
                '{"type": "item.completed", "item": {"text": "Test response"}}'
            )
            mock_run.return_value.stderr = ""

            with unittest.mock.patch.object(
                CodexAgentCLI,
                "_get_codex_sessions_directory",
                return_value=sessions_dir,
            ):
                cli = CodexAgentCLI()

                # Test session resumption for existing session
                cli.run_agent(
                    "test message", "session-123", None, None, Path("/test/path")
                )
                call_args = mock_run.call_args
                assert call_args[0][0] == [
                    "codex",
                    "exec",
                    "resume",
                    "session-123",
                    "--json",
                    # No message argument - passed via stdin
                ]
                assert call_args[1]["input"] == "test message"

                mock_run.reset_mock()
                # Test no resumption for non-existing session
                cli.run_agent(
                    "test message",
                    "nonexistent-session",
                    None,
                    None,
                    Path("/test/path"),
                )
                call_args = mock_run.call_args
                assert call_args[0][0] == [
                    "codex",
                    "exec",
                    "--json",
                    # No message argument - passed via stdin
                ]
                assert call_args[1]["input"] == "test message"

    @unittest.mock.patch("subprocess.run")
    def test_run_agent_command_not_found(self, mock_run):
        """Test run_agent with FileNotFoundError from subprocess."""
        mock_run.side_effect = FileNotFoundError("codex not found")

        cli = CodexAgentCLI()
        result = cli.run_agent("test message", None, None, None, Path("."))

        assert isinstance(result, RunResult)
        assert result.success is False
        assert "codex" in result.error_message
        assert "command not found" in result.error_message

    @unittest.mock.patch("subprocess.run")
    def test_run_agent_error_response(self, mock_run):
        """Test run_agent with error from subprocess."""
        mock_run.return_value.returncode = 1
        mock_run.return_value.stdout = ""
        mock_run.return_value.stderr = "Codex command failed"

        cli = CodexAgentCLI()
        result = cli.run_agent("test message", None, None, None, Path("."))

        assert isinstance(result, RunResult)
        assert result.success is False
        assert "Codex command failed" in result.error_message

    def test_list_sessions_no_directory(self):
        """Test list_sessions when codex directory doesn't exist."""
        with unittest.mock.patch.object(
            CodexAgentCLI, "_get_codex_sessions_directory", return_value=None
        ):
            cli = CodexAgentCLI()
            result = cli.list_sessions(Path("."))

            assert isinstance(result, SessionListResult)
            assert result.success is False
            assert "session directory not found" in result.error_message.lower()

    def test_list_sessions_date_structure(self):
        """Test list_sessions with date-based directory structure."""
        with tempfile.TemporaryDirectory() as temp_codex_home:
            sessions_dir = Path(temp_codex_home) / "sessions"

            # Create date-based directory structure with session files
            year_dir = sessions_dir / "2024"
            month_dir = year_dir / "01"
            day_dir = month_dir / "31"
            day_dir.mkdir(parents=True)

            # Create session files with test content
            session_file1 = day_dir / "rollout-session-123.jsonl"
            session_content = """{"type": "item.completed", "item": {"text": "First message content"}}
{"type": "response_item", "content": {"parts": [{"type": "text", "text": "Response content"}]}}"""
            session_file1.write_text(session_content, encoding="utf-8")

            session_file2 = day_dir / "rollout-session-456.jsonl"
            session_file2.write_text(
                '{"type": "item.completed", "item": {"text": "Second session"}}',
                encoding="utf-8",
            )

            with unittest.mock.patch.object(
                CodexAgentCLI,
                "_get_codex_sessions_directory",
                return_value=sessions_dir,
            ):
                cli = CodexAgentCLI()
                result = cli.list_sessions(Path("."))

                assert isinstance(result, SessionListResult)
                assert result.success is True
                assert len(result.sessions) == 2

                # Check session IDs are extracted from filenames
                session_ids = {s.session_id for s in result.sessions}
                assert "rollout-session-123" in session_ids
                assert "rollout-session-456" in session_ids

    def test_export_session_not_found(self):
        """Test export_session with non-existent session."""
        with unittest.mock.patch.object(
            CodexAgentCLI,
            "_get_codex_sessions_directory",
            return_value=Path("/fake/sessions"),
        ):
            cli = CodexAgentCLI()
            result = cli.export_session("nonexistent-session", Path("."))

            assert isinstance(result, ExportResult)
            assert result.success is False
            assert (
                result.error_message is not None
            )  # Just check it has an error message

    def test_export_session_success(self):
        """Test export_session with valid session."""
        with tempfile.TemporaryDirectory() as temp_codex_home:
            sessions_dir = Path(temp_codex_home) / "sessions"
            year_dir = sessions_dir / "2024"
            month_dir = year_dir / "01"
            day_dir = month_dir / "31"
            day_dir.mkdir(parents=True)

            # Create session file with test content
            session_file = day_dir / "rollout-test-session.jsonl"
            session_content = """{"type": "response_item", "content": {"role": "user", "parts": [{"type": "text", "text": "User message"}]}, "timestamp": 1736766000000}
{"type": "item.completed", "item": {"text": "Assistant response"}, "timestamp": 1736766001000}"""
            session_file.write_text(session_content, encoding="utf-8")

            with unittest.mock.patch.object(
                CodexAgentCLI,
                "_get_codex_sessions_directory",
                return_value=sessions_dir,
            ):
                cli = CodexAgentCLI()
                result = cli.export_session("test-session", Path("."))

                assert isinstance(result, ExportResult)
                assert result.success is True
                assert len(result.messages) >= 1
                assert result.session_id == "test-session"

    def test_list_agents(self):
        """Test list_agents returns codex agent info."""
        cli = CodexAgentCLI()
        result = cli.list_agents()

        assert isinstance(result, AgentListResult)
        assert result.success is True
        assert len(result.agents) == 1
        assert result.agents[0].name == "codex"
        assert result.agents[0].agent_type == "Built-in"
        assert "Codex Cloud" in result.agents[0].details[0]

    def test_session_matches_directory_no_sessions_dir(self):
        """Test _session_matches_directory when sessions directory doesn't exist."""
        with unittest.mock.patch.object(
            CodexAgentCLI, "_get_codex_sessions_directory", return_value=None
        ):
            cli = CodexAgentCLI()
            result = cli._session_matches_directory("test-session", Path("."))
            assert result is False

    def test_parse_session_jsonl_malformed(self):
        """Test _parse_session_jsonl with malformed JSON."""
        with tempfile.TemporaryDirectory() as temp_dir:
            session_file = Path(temp_dir) / "test-session.jsonl"
            session_content = """{"type": "item.completed", "item": {"text": "Valid line"}}
invalid json line here
{"type": "response_item", "content": {"parts": [{"type": "text", "text": "Another valid line"}]}}"""
            session_file.write_text(session_content, encoding="utf-8")

            cli = CodexAgentCLI()
            messages = cli._parse_session_jsonl(session_file)

            # Should parse valid lines and skip malformed ones
            assert len(messages) >= 1

    def test_to_milliseconds_edge_cases(self):
        """Test _to_milliseconds with various input types."""
        cli = CodexAgentCLI()

        # Valid cases
        assert cli._to_milliseconds(1736766000000) == 1736766000000
        assert cli._to_milliseconds("1736766000000") == 1736766000000
        assert cli._to_milliseconds(1736766000000.5) == 1736766000000

        # Invalid cases
        assert cli._to_milliseconds(None) is None
        assert cli._to_milliseconds("invalid") is None
        assert cli._to_milliseconds([]) is None

    def test_get_codex_sessions_directory_env_var(self):
        """Test _get_codex_sessions_directory with environment variable."""
        with tempfile.TemporaryDirectory() as temp_dir:
            with unittest.mock.patch.dict(
                "os.environ", {"CODEX_SESSION_PATH": temp_dir}
            ):
                cli = CodexAgentCLI()
                result = cli._get_codex_sessions_directory()
                assert result == Path(temp_dir)

    def test_get_codex_sessions_directory_default(self):
        """Test _get_codex_sessions_directory with default location."""
        with unittest.mock.patch.dict("os.environ", {}, clear=True):
            with tempfile.TemporaryDirectory() as temp_home:
                codex_sessions = Path(temp_home) / ".codex" / "sessions"
                codex_sessions.mkdir(parents=True)

                with unittest.mock.patch(
                    "pathlib.Path.home", return_value=Path(temp_home)
                ):
                    cli = CodexAgentCLI()
                    result = cli._get_codex_sessions_directory()
                    assert result == codex_sessions

    def test_empty_json_output(self):
        """Test handling of empty JSON output from codex CLI."""
        cli = CodexAgentCLI()
        session_id, response_parts = cli._parse_codex_output("")

        assert session_id is None
        assert len(response_parts) == 0

    def test_malformed_session_files(self):
        """Test handling of malformed session files."""
        with tempfile.TemporaryDirectory() as temp_dir:
            session_file = Path(temp_dir) / "malformed.jsonl"
            session_file.write_text(
                "not json at all\n{invalid json}\n", encoding="utf-8"
            )

            cli = CodexAgentCLI()
            messages = cli._parse_session_jsonl(session_file)

            # Should handle gracefully and return empty list
            assert messages == []

    def test_run_agent_with_cancel_event_set(self):
        """Test run_agent when cancel event is already set."""
        from threading import Event

        cancel_event = Event()
        cancel_event.set()  # Pre-set the cancel event

        cli = CodexAgentCLI()
        result = cli.run_agent(
            "test message", None, None, None, Path("."), cancel_event=cancel_event
        )

        assert isinstance(result, RunResult)
        assert result.success is False
        assert "cancelled" in result.error_message

    def test_run_agent_exception_handling(self):
        """Test run_agent with unexpected exception."""
        with unittest.mock.patch(
            "subprocess.run", side_effect=Exception("Unexpected error")
        ):
            cli = CodexAgentCLI()
            result = cli.run_agent("test message", None, None, None, Path("."))

            assert isinstance(result, RunResult)
            assert result.success is False
            assert "Unexpected error" in result.error_message

    def test_export_session_no_sessions_directory(self):
        """Test export_session when sessions directory doesn't exist."""
        with unittest.mock.patch.object(
            CodexAgentCLI, "_get_codex_sessions_directory", return_value=None
        ):
            cli = CodexAgentCLI()
            result = cli.export_session("test-session", Path("."))

            assert isinstance(result, ExportResult)
            assert result.success is False
            assert "directory not found" in result.error_message

    def test_export_session_exception_handling(self):
        """Test export_session with exception during processing."""
        with unittest.mock.patch.object(
            CodexAgentCLI,
            "_get_codex_sessions_directory",
            side_effect=Exception("Directory error"),
        ):
            cli = CodexAgentCLI()
            result = cli.export_session("test-session", Path("."))

            assert isinstance(result, ExportResult)
            assert result.success is False
            assert "error" in result.error_message.lower()

    def test_parse_session_jsonl_nonexistent_file(self):
        """Test _parse_session_jsonl with non-existent file."""
        cli = CodexAgentCLI()
        messages = cli._parse_session_jsonl(Path("/nonexistent/file.jsonl"))

        # Should handle gracefully and return empty list
        assert messages == []

    def test_list_agents_exception_handling(self):
        """Test list_agents with FileNotFoundError exception."""
        with unittest.mock.patch.object(
            CodexAgentCLI,
            "missing_command_error",
            side_effect=FileNotFoundError("codex not found"),
        ):
            cli = CodexAgentCLI()
            result = cli.list_agents()

            # Should not raise exception but handle gracefully
            assert isinstance(result, AgentListResult)
