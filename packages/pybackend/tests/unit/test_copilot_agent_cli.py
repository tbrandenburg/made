"""Unit tests for CopilotAgentCLI implementation."""

import json
import tempfile
import unittest.mock
from pathlib import Path


from copilot_agent_cli import CopilotAgentCLI
from agent_results import (
    AgentListResult,
    ExportResult,
    RunResult,
    SessionListResult,
)


class TestCopilotAgentCLI:
    """Test cases for CopilotAgentCLI."""

    def test_cli_name(self):
        """Test that cli_name property returns correct value."""
        cli = CopilotAgentCLI()
        assert cli.cli_name == "copilot"

    def test_missing_command_error(self):
        """Test missing_command_error returns correct error message."""
        cli = CopilotAgentCLI()
        error_msg = cli.missing_command_error()
        assert "copilot" in error_msg
        assert "command not found" in error_msg
        assert "Please ensure it is installed and in PATH" in error_msg

    def test_strip_ansi_codes(self):
        """Test _strip_ansi_codes removes ANSI escape sequences."""
        cli = CopilotAgentCLI()

        # Test basic color codes
        text_with_ansi = "\x1b[38;5;141m> \x1b[0mHere's a response\x1b[0m\x1b[0m"
        expected = "> Here's a response"
        assert cli._strip_ansi_codes(text_with_ansi) == expected

        # Test multiple color codes
        text_with_multiple = (
            "\x1b[38;5;10mcopilot\x1b[0m response\x1b[38;5;141m test\x1b[0m"
        )
        expected_multiple = "copilot response test"
        assert cli._strip_ansi_codes(text_with_multiple) == expected_multiple

        # Test text without ANSI codes (should be unchanged)
        plain_text = "This is plain text"
        assert cli._strip_ansi_codes(plain_text) == plain_text

        # Test empty string
        assert cli._strip_ansi_codes("") == ""

        # Test complex ANSI sequence
        complex_ansi = (
            "\x1b[38;5;141m\x1b[1m\x1b[4mBold underlined colored\x1b[0m\x1b[0m\x1b[0m"
        )
        expected_complex = "Bold underlined colored"
        assert cli._strip_ansi_codes(complex_ansi) == expected_complex

    def test_clean_response_text_strips_prefixes(self):
        """Test _clean_response_text strips prompt markers and labels."""
        cli = CopilotAgentCLI()
        text = "\x1b[38;5;141m> \x1b[0m(Assistant) Hello there"
        assert cli._clean_response_text(text) == "Hello there"
        assert cli._clean_response_text(">     (Heading) Title") == "Title"

    @unittest.mock.patch("subprocess.run")
    def test_run_agent_success(self, mock_run):
        """Test run_agent with successful subprocess execution."""
        # Mock successful copilot response
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "Test response from copilot"
        mock_run.return_value.stderr = ""

        cli = CopilotAgentCLI()
        result = cli.run_agent("test message", None, None, None, Path("."))

        assert isinstance(result, RunResult)
        assert result.success is True
        assert len(result.response_parts) == 1
        assert result.response_parts[0].text == "Test response from copilot"
        assert result.response_parts[0].part_type == "final"

    @unittest.mock.patch("subprocess.run")
    def test_run_agent_strips_ansi_codes(self, mock_run):
        """Test run_agent strips ANSI escape sequences and prompt markers."""
        # Mock copilot response with ANSI codes
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = (
            "\x1b[38;5;141m> \x1b[0mHere's a response\x1b[0m\x1b[0m"
        )
        mock_run.return_value.stderr = ""

        cli = CopilotAgentCLI()
        result = cli.run_agent("test message", None, None, None, Path("."))

        assert isinstance(result, RunResult)
        assert result.success is True
        assert len(result.response_parts) == 1
        # Verify ANSI codes and prompt markers are stripped
        assert result.response_parts[0].text == "Here's a response"
        assert "\x1b[" not in result.response_parts[0].text

        # Verify subprocess was called correctly
        mock_run.assert_called_once()
        call_args = mock_run.call_args
        assert call_args[0][0] == [
            "copilot",
            "-p",
            "test message",
            "--allow-all-tools",
            "--silent",
        ]

    @unittest.mock.patch("subprocess.run")
    def test_run_agent_resumes_only_for_matching_directory(self, mock_run):
        """Test run_agent resumes only when session matches working directory."""
        with tempfile.TemporaryDirectory() as temp_copilot_home:
            # Create mock copilot session directory
            sessions_dir = Path(temp_copilot_home) / "session-state"
            sessions_dir.mkdir()
            session_dir = sessions_dir / "test-session-123"
            session_dir.mkdir()
            (session_dir / "events.jsonl").touch()

            mock_run.return_value.returncode = 0
            mock_run.return_value.stdout = "Test response from copilot"
            mock_run.return_value.stderr = ""

            with unittest.mock.patch.object(
                CopilotAgentCLI, "_get_sessions_directory", return_value=sessions_dir
            ):
                cli = CopilotAgentCLI()

                # Test session resumption for existing session
                cli.run_agent(
                    "test message", "test-session-123", None, None, Path("/test/path")
                )
                call_args = mock_run.call_args
                assert call_args[0][0] == [
                    "copilot",
                    "-p",
                    "test message",
                    "--allow-all-tools",
                    "--silent",
                    "--resume",
                    "test-session-123",
                ]

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
                    "copilot",
                    "-p",
                    "test message",
                    "--allow-all-tools",
                    "--silent",
                ]

    @unittest.mock.patch("subprocess.run")
    def test_run_agent_command_not_found(self, mock_run):
        """Test run_agent with FileNotFoundError from subprocess."""
        mock_run.side_effect = FileNotFoundError("copilot not found")

        cli = CopilotAgentCLI()
        result = cli.run_agent("test message", None, None, None, Path("."))

        assert isinstance(result, RunResult)
        assert result.success is False
        assert "copilot" in result.error_message
        assert "command not found" in result.error_message

    def test_list_sessions_no_directory(self):
        """Test list_sessions when copilot directory doesn't exist."""
        with unittest.mock.patch.object(
            CopilotAgentCLI, "_get_sessions_directory", return_value=None
        ):
            cli = CopilotAgentCLI()
            result = cli.list_sessions(Path("."))

            assert isinstance(result, SessionListResult)
            assert result.success is False
            assert "session directory not found" in result.error_message.lower()

    def test_list_sessions_with_directory(self):
        """Test list_sessions with mocked session directory."""
        with tempfile.TemporaryDirectory() as temp_copilot_home:
            sessions_dir = Path(temp_copilot_home) / "session-state"
            sessions_dir.mkdir()

            # Create test session directory with events.jsonl
            session_dir = sessions_dir / "test-session-123"
            session_dir.mkdir()

            # Create events.jsonl with test data
            events_file = session_dir / "events.jsonl"
            events_data = [
                {
                    "type": "user.message",
                    "data": {"content": "Test message"},
                    "timestamp": 1736766000000,
                },
                {
                    "type": "assistant.message",
                    "data": {"content": "Test response"},
                    "timestamp": 1736766001000,
                },
            ]

            with open(events_file, "w") as f:
                for event in events_data:
                    f.write(json.dumps(event) + "\n")

            # Mock sessions directory to return our test directory
            with unittest.mock.patch.object(
                CopilotAgentCLI, "_get_sessions_directory", return_value=sessions_dir
            ):
                cli = CopilotAgentCLI()
                result = cli.list_sessions(Path("/test/path"))

                assert isinstance(result, SessionListResult)
                assert result.success is True
                assert len(result.sessions) == 1

                session = result.sessions[0]
                assert session.session_id == "test-session-123"
                assert "Test message" in session.title

    def test_list_agents_success(self):
        """Test list_agents returns default copilot agent."""
        cli = CopilotAgentCLI()
        result = cli.list_agents()

        assert isinstance(result, AgentListResult)
        assert result.success is True
        assert len(result.agents) == 1

        # Check copilot agent
        agent = result.agents[0]
        assert agent.name == "copilot"
        assert agent.agent_type == "Built-in"
        assert "Claude Sonnet 4.5" in agent.details[0]

    def test_export_session_no_directory(self):
        """Test export_session when copilot directory doesn't exist."""
        with unittest.mock.patch.object(
            CopilotAgentCLI, "_get_sessions_directory", return_value=None
        ):
            cli = CopilotAgentCLI()
            result = cli.export_session("test-session", Path("."))

            assert isinstance(result, ExportResult)
            assert result.success is False
            assert "session directory not found" in result.error_message.lower()

    def test_export_session_session_not_found(self):
        """Test export_session when session doesn't exist."""
        with tempfile.TemporaryDirectory() as temp_copilot_home:
            sessions_dir = Path(temp_copilot_home) / "session-state"
            sessions_dir.mkdir()

            with unittest.mock.patch.object(
                CopilotAgentCLI, "_get_sessions_directory", return_value=sessions_dir
            ):
                cli = CopilotAgentCLI()
                result = cli.export_session("nonexistent-session", Path("/test/path"))

                assert isinstance(result, ExportResult)
                assert result.success is False
                assert "not found" in result.error_message.lower()

    def test_export_session_success(self):
        """Test export_session with valid session data."""
        with tempfile.TemporaryDirectory() as temp_copilot_home:
            sessions_dir = Path(temp_copilot_home) / "session-state"
            sessions_dir.mkdir()

            # Create test session directory with events.jsonl
            session_dir = sessions_dir / "test-session-123"
            session_dir.mkdir()

            events_file = session_dir / "events.jsonl"
            events_data = [
                {
                    "type": "user.message",
                    "data": {"content": "Hello copilot"},
                    "timestamp": 1736766000000,
                },
                {
                    "type": "assistant.message",
                    "data": {"content": "Hi there!"},
                    "timestamp": 1736766001000,
                },
                {
                    "type": "tool.execution_start",
                    "data": {"toolName": "file_editor"},
                    "timestamp": 1736766002000,
                },
                {
                    "type": "tool.execution_end",
                    "data": {"toolName": "file_editor", "result": "File saved"},
                    "timestamp": 1736766003000,
                },
            ]

            with open(events_file, "w") as f:
                for event in events_data:
                    f.write(json.dumps(event) + "\n")

            with unittest.mock.patch.object(
                CopilotAgentCLI, "_get_sessions_directory", return_value=sessions_dir
            ):
                cli = CopilotAgentCLI()
                result = cli.export_session("test-session-123", Path("/test/path"))

                assert isinstance(result, ExportResult)
                assert result.success is True
                assert len(result.messages) == 4

                # Check user message
                user_msg = result.messages[0]
                assert user_msg.role == "user"
                assert user_msg.content_type == "text"
                assert user_msg.content == "Hello copilot"

                # Check assistant message
                assistant_msg = result.messages[1]
                assert assistant_msg.role == "assistant"
                assert assistant_msg.content_type == "text"
                assert assistant_msg.content == "Hi there!"

                # Check tool messages
                tool_start = result.messages[2]
                assert tool_start.role == "assistant"
                assert tool_start.content_type == "tool"
                assert "Tool started: file_editor" in tool_start.content

                tool_end = result.messages[3]
                assert tool_end.role == "assistant"
                assert tool_end.content_type == "tool"
                assert "Tool completed: file_editor" in tool_end.content

    def test_parse_events_jsonl_empty_file(self):
        """Test _parse_events_jsonl with empty events file."""
        cli = CopilotAgentCLI()

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            events_file = Path(f.name)

        messages = cli._parse_events_jsonl(events_file)
        assert len(messages) == 0

        # Clean up
        events_file.unlink()

    def test_parse_events_jsonl_malformed_json(self):
        """Test _parse_events_jsonl with malformed JSON lines."""
        cli = CopilotAgentCLI()

        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
            f.write('{"valid": "json"}\n')
            f.write("invalid json line\n")  # Malformed JSON
            f.write(
                '{"type": "user.message", "data": {"content": "Valid after error"}}\n'
            )
            events_file = Path(f.name)

        messages = cli._parse_events_jsonl(events_file)

        # Should skip malformed line but process valid ones
        assert len(messages) == 1
        assert messages[0].content == "Valid after error"

        # Clean up
        events_file.unlink()

    def test_get_directory_key(self):
        """Test _get_directory_key method."""
        cli = CopilotAgentCLI()

        test_path = Path("/test/path")
        key = cli._get_directory_key(test_path)

        # Should return resolved absolute path as string
        assert isinstance(key, str)
        assert key == str(test_path.resolve())

    def test_to_milliseconds(self):
        """Test _to_milliseconds method."""
        cli = CopilotAgentCLI()

        # Valid conversions
        assert cli._to_milliseconds(1000) == 1000
        assert cli._to_milliseconds("1000") == 1000
        assert cli._to_milliseconds(1000.5) == 1000

        # Invalid conversions
        assert cli._to_milliseconds(None) is None
        assert cli._to_milliseconds("invalid") is None
        assert cli._to_milliseconds([]) is None

    def test_session_matches_directory(self):
        """Test _session_matches_directory method."""
        cli = CopilotAgentCLI()

        with tempfile.TemporaryDirectory() as temp_copilot_home:
            sessions_dir = Path(temp_copilot_home) / "session-state"
            sessions_dir.mkdir()

            # Create existing session directory
            existing_session = sessions_dir / "existing-session"
            existing_session.mkdir()

            with unittest.mock.patch.object(
                CopilotAgentCLI, "_get_sessions_directory", return_value=sessions_dir
            ):
                # Should return True for existing session
                assert (
                    cli._session_matches_directory(
                        "existing-session", Path("/any/path")
                    )
                    is True
                )

                # Should return False for non-existing session
                assert (
                    cli._session_matches_directory(
                        "nonexistent-session", Path("/any/path")
                    )
                    is False
                )

    def test_get_sessions_directory_environment_variable(self):
        """Test _get_sessions_directory with environment variable."""
        cli = CopilotAgentCLI()

        with tempfile.TemporaryDirectory() as temp_dir:
            custom_path = Path(temp_dir) / "custom-copilot"
            custom_path.mkdir()

            with unittest.mock.patch.dict(
                "os.environ", {"COPILOT_SESSION_PATH": str(custom_path)}
            ):
                result = cli._get_sessions_directory()
                assert result == custom_path

    @unittest.mock.patch("pathlib.Path.home")
    def test_get_sessions_directory_default_location(self, mock_home):
        """Test _get_sessions_directory with default location."""
        cli = CopilotAgentCLI()

        with tempfile.TemporaryDirectory() as temp_home:
            mock_home.return_value = Path(temp_home)

            # Create default copilot session directory
            copilot_dir = Path(temp_home) / ".copilot" / "session-state"
            copilot_dir.mkdir(parents=True)

            # Clear environment variable
            with unittest.mock.patch.dict("os.environ", {}, clear=True):
                result = cli._get_sessions_directory()
                assert result == copilot_dir

    @unittest.mock.patch("pathlib.Path.home")
    def test_get_sessions_directory_not_found(self, mock_home):
        """Test _get_sessions_directory when directory doesn't exist."""
        cli = CopilotAgentCLI()

        with tempfile.TemporaryDirectory() as temp_home:
            mock_home.return_value = Path(temp_home)

            # Clear environment variable and don't create directory
            with unittest.mock.patch.dict("os.environ", {}, clear=True):
                result = cli._get_sessions_directory()
                assert result is None
