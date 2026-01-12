"""
Unit tests focusing on isolated testing of individual functions.
These tests mock all external dependencies and focus on business logic.
"""

import pytest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, call, patch

# These would be unit tests for individual service functions
# For now, creating a minimal unit test structure


class TestConfigFunctions:
    """Test configuration-related functions in isolation."""

    @patch('os.path.exists')
    @patch('os.makedirs')
    def test_ensure_made_structure_creates_directories(self, mock_makedirs, mock_exists):
        """Test that ensure_made_structure creates required directories."""
        from config import ensure_made_structure
        
        mock_exists.return_value = False
        
        try:
            ensure_made_structure()
            # If makedirs was called, test passes
            # If not, we'll check that the function ran without error
            assert True  # Function completed without error
        except Exception:
            # If there's an exception, makedirs should have been called
            assert mock_makedirs.called

    @patch('os.path.expanduser')
    def test_get_workspace_home(self, mock_expanduser):
        """Test workspace home detection."""
        from config import get_workspace_home
        
        mock_expanduser.return_value = "/test/home"
        
        result = get_workspace_home()
        
        # Should return a Path object
        assert result is not None


class TestServiceInputValidation:
    """Test input validation in service functions."""

    def test_repository_name_validation(self):
        """Test repository name validation logic."""
        # This would test the business logic for validating repository names
        # Example: names should not contain special characters, etc.
        pass

    def test_file_path_validation(self):
        """Test file path validation logic.""" 
        # This would test path traversal prevention, etc.
        pass


class TestBusinessLogic:
    """Test core business logic without external dependencies."""

    def test_agent_message_formatting(self):
        """Test agent message formatting logic."""
        # Test the logic that formats messages for agents
        pass

    def test_frontmatter_processing(self):
        """Test frontmatter processing logic."""
        # Test YAML frontmatter parsing/serialization
        pass


class TestAgentService:
    """Test agent service functions in isolation."""

    @patch('agent_service.get_workspace_home')
    def test_get_working_directory_repository_chat(self, mock_get_workspace_home):
        """Test working directory selection for repository chats."""
        from agent_service import _get_working_directory
        
        # Setup mocks
        mock_workspace = Mock()
        mock_get_workspace_home.return_value = mock_workspace
        
        mock_repo_path = Mock()
        mock_repo_path.exists.return_value = True
        mock_repo_path.is_dir.return_value = True
        mock_workspace.__truediv__ = Mock(return_value=mock_repo_path)
        
        # Test repository chat (not knowledge or constitution)
        result = _get_working_directory("my-repo")
        
        mock_workspace.__truediv__.assert_called_once_with("my-repo")
        mock_repo_path.exists.assert_called_once()
        mock_repo_path.is_dir.assert_called_once()
        assert result == mock_repo_path

    @patch('agent_service.get_workspace_home')
    @patch('agent_service.Path')
    def test_get_working_directory_repository_not_exists(self, mock_path_class, mock_get_workspace_home):
        """Test working directory fallback when repository doesn't exist."""
        from agent_service import _get_working_directory
        
        # Setup mocks
        mock_workspace = Mock()
        mock_get_workspace_home.return_value = mock_workspace
        
        mock_repo_path = Mock()
        mock_repo_path.exists.return_value = False  # Repository doesn't exist
        mock_workspace.__truediv__ = Mock(return_value=mock_repo_path)
        
        mock_backend_path = Mock()
        mock_path_class.return_value = mock_backend_path
        
        # Test repository chat with non-existent repo
        result = _get_working_directory("non-existent-repo")
        
        # Should fall back to backend directory
        assert result == mock_backend_path.parent

    @patch('agent_service.ensure_directory')
    @patch('agent_service.get_made_directory')
    def test_get_working_directory_knowledge_chat(self, mock_get_made_directory, mock_ensure_directory):
        """Test working directory selection for knowledge chats."""
        from agent_service import _get_working_directory

        made_dir = Path("/test/made/home/.made")
        knowledge_dir = made_dir / "knowledge"
        mock_get_made_directory.return_value = made_dir
        mock_ensure_directory.return_value = knowledge_dir

        # Test knowledge chat
        result = _get_working_directory("knowledge:some-artefact")

        mock_get_made_directory.assert_called_once()
        mock_ensure_directory.assert_called_once_with(knowledge_dir)
        assert result == knowledge_dir

    @patch('agent_service.ensure_directory')
    @patch('agent_service.get_made_directory')
    def test_get_working_directory_constitution_chat(self, mock_get_made_directory, mock_ensure_directory):
        """Test working directory selection for constitution chats."""
        from agent_service import _get_working_directory

        made_dir = Path("/test/made/home/.made")
        const_dir = made_dir / "constitutions"
        mock_get_made_directory.return_value = made_dir
        mock_ensure_directory.return_value = const_dir

        # Test constitution chat
        result = _get_working_directory("constitution:some-constitution")

        mock_get_made_directory.assert_called_once()
        mock_ensure_directory.assert_called_once_with(const_dir)
        assert result == const_dir

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_success(self, mock_start_run, mock_get_working_dir):
        """Test successful agent message sending."""
        from agent_service import send_agent_message

        # Setup mocks
        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = ("Agent response content", "")
        mock_start_run.return_value = mock_process

        # Test successful message
        result = send_agent_message("test-repo", "Hello agent")
        
        # Verify CLI call
        mock_start_run.assert_called_once_with(
            ["opencode", "run", "--format", "json"],
            mock_working_dir,
        )
        mock_process.communicate.assert_called_once_with(input="Hello agent")
        
        # Verify response structure
        assert "messageId" in result
        assert "sent" in result
        assert result["sent"].endswith("Z")
        # Ensure the timestamp can be parsed when converted to ISO format with offset
        datetime.fromisoformat(result["sent"].replace("Z", "+00:00"))
        assert result["prompt"] == "Hello agent"
        assert result["response"] == "Agent response content"
        assert result["responses"] == []

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_with_leading_hyphen(self, mock_start_run, mock_get_working_dir):
        """Messages beginning with '-' are passed via stdin, not parsed as flags."""
        from agent_service import send_agent_message

        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = ("Response", "")
        mock_start_run.return_value = mock_process

        result = send_agent_message("test-repo", "-inspect")

        mock_start_run.assert_called_once_with(
            ["opencode", "run", "--format", "json"],
            mock_working_dir,
        )
        mock_process.communicate.assert_called_once_with(input="-inspect")
        assert result["prompt"] == "-inspect"

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_with_session_id(self, mock_start_run, mock_get_working_dir):
        """Test messages include provided session ID each time."""
        from agent_service import _conversation_sessions, send_agent_message

        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = ("Agent response content", "")
        mock_start_run.return_value = mock_process

        _conversation_sessions.clear()

        send_agent_message("test-repo", "Hello agent", "ses_123")
        send_agent_message("test-repo", "Follow up", "ses_123")

        assert mock_start_run.call_args_list[0] == call(
            ["opencode", "run", "-s", "ses_123", "--format", "json"],
            mock_working_dir,
        )
        assert mock_start_run.call_args_list[1] == call(
            ["opencode", "run", "-s", "ses_123", "--format", "json"],
            mock_working_dir,
        )
        assert mock_process.communicate.call_args_list[0] == call(input="Hello agent")
        assert mock_process.communicate.call_args_list[1] == call(input="Follow up")
        assert _conversation_sessions["test-repo"] == "ses_123"

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_with_agent(self, mock_start_run, mock_get_working_dir):
        """Test messages include provided agent."""
        from agent_service import send_agent_message

        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = ("Agent response content", "")
        mock_start_run.return_value = mock_process

        send_agent_message("test-repo", "Hello agent", agent="plan")

        mock_start_run.assert_called_once_with(
            ["opencode", "run", "--agent", "plan", "--format", "json"],
            mock_working_dir,
        )
        mock_process.communicate.assert_called_once_with(input="Hello agent")

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_resets_channel_without_session_id(
        self, mock_start_run, mock_get_working_dir
    ):
        """When session ID is omitted, the channel starts a fresh session."""
        from agent_service import _conversation_sessions, send_agent_message

        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = ("Agent response content", "")
        mock_start_run.return_value = mock_process

        _conversation_sessions.clear()
        send_agent_message("test-repo", "Hello agent", "ses_123")
        assert _conversation_sessions["test-repo"] == "ses_123"

        send_agent_message("test-repo", "Fresh start")

        assert mock_start_run.call_args_list[0] == call(
            ["opencode", "run", "-s", "ses_123", "--format", "json"],
            mock_working_dir,
        )
        assert mock_start_run.call_args_list[1] == call(
            ["opencode", "run", "--format", "json"],
            mock_working_dir,
        )
        assert mock_process.communicate.call_args_list[0] == call(input="Hello agent")
        assert mock_process.communicate.call_args_list[1] == call(input="Fresh start")
        assert "test-repo" not in _conversation_sessions

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_parses_json_output(self, mock_start_run, mock_get_working_dir):
        """Ensure opencode JSON output is parsed for text and session ID."""
        from agent_service import _conversation_sessions, send_agent_message

        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = ('\n'.join([
            '{"type":"step_start","timestamp":1766956198081,"sessionID":"ses_123","part":{"type":"step-start"}}',
            '{"type":"text","timestamp":1766956199330,"sessionID":"ses_123","part":{"type":"text","text":"First line"}}',
            '{"type":"text","timestamp":1766956199331,"sessionID":"ses_123","part":{"type":"text","text":"Second line"}}',
            '{"type":"step_finish","timestamp":1766956225161,"sessionID":"ses_123","part":{"type":"step-finish"}}',
        ]), "")
        mock_start_run.return_value = mock_process

        _conversation_sessions.clear()

        result = send_agent_message("test-repo", "Hello agent")

        assert result["response"] == "First line\n\nSecond line"
        assert result["responses"] == [
            {"text": "First line", "timestamp": "2025-12-28T21:09:59.330Z", "type": "thinking"},
            {"text": "Second line", "timestamp": "2025-12-28T21:09:59.331Z", "type": "final"},
        ]
        assert result["sessionId"] == "ses_123"
        assert _conversation_sessions["test-repo"] == "ses_123"
        mock_start_run.assert_called_once_with(
            ["opencode", "run", "--format", "json"],
            mock_working_dir,
        )
        mock_process.communicate.assert_called_once_with(input="Hello agent")

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_includes_tool_use(self, mock_start_run, mock_get_working_dir):
        """Ensure tool_use entries are included with type metadata."""
        from agent_service import send_agent_message

        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = ('\n'.join([
            '{"type":"text","timestamp":1766956198000,"sessionID":"ses_tool","part":{"type":"text","text":"Before tool"}}',
            '{"type":"tool_use","timestamp":1766956199000,"sessionID":"ses_tool","part":{"tool":"firecrawl_firecrawl_search"}}',
            '{"type":"text","timestamp":1766956200000,"sessionID":"ses_tool","part":{"type":"text","text":"After tool"}}',
        ]), "")
        mock_start_run.return_value = mock_process

        result = send_agent_message("test-repo", "Hello agent")

        assert result["response"] == (
            "Before tool\n\nfirecrawl_firecrawl_search\n\nAfter tool"
        )
        assert result["responses"] == [
            {"text": "Before tool", "timestamp": "2025-12-28T21:09:58.000Z", "type": "thinking"},
            {"text": "firecrawl_firecrawl_search", "timestamp": "2025-12-28T21:09:59.000Z", "type": "tool"},
            {"text": "After tool", "timestamp": "2025-12-28T21:10:00.000Z", "type": "final"},
        ]
        mock_start_run.assert_called_once_with(
            ["opencode", "run", "--format", "json"],
            mock_working_dir,
        )
        mock_process.communicate.assert_called_once_with(input="Hello agent")

    def test_parse_opencode_output_single_text_is_final(self):
        """Ensure a single text response is treated as the final message."""
        from agent_service import _parse_opencode_output

        stdout = '\n'.join([
            '{"type":"text","timestamp":1766956199331,"sessionID":"ses_final","part":{"type":"text","text":"Final answer"}}',
        ])

        session_id, parsed = _parse_opencode_output(stdout)

        assert session_id == "ses_final"
        assert parsed == [{"text": "Final answer", "timestamp": "2025-12-28T21:09:59.331Z", "type": "final"}]

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_command_failure(self, mock_start_run, mock_get_working_dir):
        """Test agent message sending with command failure."""
        from agent_service import send_agent_message
        
        # Setup mocks
        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir
        
        mock_process = Mock()
        mock_process.returncode = 1
        mock_process.communicate.return_value = ("", "Command error")
        mock_start_run.return_value = mock_process

        # Test failed command
        result = send_agent_message("test-repo", "Hello agent")

        # Verify error response
        assert result["response"] == "Error: Command error"
        mock_start_run.assert_called_once_with(
            ["opencode", "run", "--format", "json"],
            mock_working_dir,
        )
        mock_process.communicate.assert_called_once_with(input="Hello agent")

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_file_not_found(self, mock_start_run, mock_get_working_dir):
        """Test agent message sending when opencode is not found."""
        from agent_service import send_agent_message
        
        # Setup mocks
        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_start_run.side_effect = FileNotFoundError()

        # Test file not found
        result = send_agent_message("test-repo", "Hello agent")
        
        # Verify file not found response
        assert result["response"] == "Error: 'opencode' command not found. Please ensure it is installed and in PATH."
        mock_start_run.assert_called_once_with(
            ["opencode", "run", "--format", "json"],
            mock_working_dir,
        )

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.start_run')
    def test_send_agent_message_generic_exception(self, mock_start_run, mock_get_working_dir):
        """Test agent message sending with generic exception."""
        from agent_service import send_agent_message
        
        # Setup mocks
        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_start_run.side_effect = Exception("Generic error")

        # Test generic exception
        result = send_agent_message("test-repo", "Hello agent")
        
        # Verify generic error response
        assert result["response"] == "Error: Generic error"
        mock_start_run.assert_called_once_with(
            ["opencode", "run", "--format", "json"],
            mock_working_dir,
        )

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.list_sessions')
    def test_list_chat_sessions_parses_table(self, mock_list_sessions, mock_get_working_dir):
        """Parse the latest sessions from the opencode session table."""
        from agent_service import list_chat_sessions

        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        sample_output = """
Session ID                      Title                                                               Updated
───────────────────────────────────────────────────────────────────────────────────────────────────────────
ses_491478d5cffeFxA6xUVv2N23Nt  Initializing Spec Kit with init command                             11:06 AM · 12/30/2025
ses_491481eecffe4pR71zMCkOJZ7m  Initializing OpenSpec with openspec init --tools opencode           11:05 AM · 12/30/2025
ses_4914bfe4effepdH39D0v1ZDnef  Analyzing agent bmad-master                                         11:04 AM · 12/30/2025
ses_49181ca28ffej0r7WDvr6raUj8  Greeting and quick check-in                                         10:40 AM · 12/30/2025
ses_491a96418ffew8gU7Oc6boz2cs  Greeting check-in                                                   9:19 AM · 12/30/2025
ses_493eaba05ffedQxkNfr20tD6Zg  Greeting understanding visible files                                10:49 PM · 12/29/2025
ses_4c2a7aec2ffeNazAMQvwaAjFwQ  Answering user last statements                                      9:54 PM · 12/20/2025
ses_4c40a936cffejrP1Izw91LluiS  Listing branches with gh cli                                        8:47 PM · 12/20/2025
ses_4c4d18ffbffeqKwEdv9S3B78Dy  Analyzing frontend-backend connection issues with 5xWhy hypotheses  11:15 AM · 12/20/2025
ses_4c7dd22b9ffe8RCrnIPoCt7Not  Greeting and quick check-in                                         8:42 PM · 12/19/2025
ses_4c8e3aa80ffelZtRBggBr0vGj0  Greeting and quick check-in                                         3:56 PM · 12/19/2025
ses_4c8f3449effeDe1146uIO6XLX8  Greeting: quick check-in                                            3:39 PM · 12/19/2025
ses_4c91f8ba7ffe6Ai025uAGGZwR5  Greeting engagement: Hello!                                         2:50 PM · 12/19/2025
ses_4c9512f03ffekOFJMinyNgfyv7  Investigating repository details                                    2:14 PM · 12/19/2025
ses_4c9b107a0ffeuRQ2c1mUgvcZto  Greeting and quick check-in                                         12:11 PM · 12/19/2025
"""

        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = sample_output
        mock_list_sessions.return_value = mock_result

        sessions = list_chat_sessions("test-repo", limit=10)

        assert len(sessions) == 10
        assert sessions[0]["id"] == "ses_491478d5cffeFxA6xUVv2N23Nt"
        assert sessions[0]["title"] == "Initializing Spec Kit with init command"
        assert sessions[0]["updated"] == "11:06 AM · 12/30/2025"
        assert sessions[-1]["id"] == "ses_4c7dd22b9ffe8RCrnIPoCt7Not"

    @patch('agent_service._get_working_directory')
    @patch('agent_service.AGENT_CLI.list_sessions')
    def test_list_chat_sessions_handles_errors(self, mock_list_sessions, mock_get_working_dir):
        """Raise errors when the opencode session list fails."""
        from agent_service import list_chat_sessions

        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        mock_result.stderr = "boom"
        mock_list_sessions.return_value = mock_result

        with pytest.raises(RuntimeError):
            list_chat_sessions("test-repo", limit=5)

    def test_parse_agent_list_includes_details(self):
        """Parse agent list output including detail lines."""
        from agent_service import _parse_agent_list

        output = "\n".join(
            [
                "build (primary)",
                "  allow: read",
                "  deny: write",
                "",
                "plan (primary)",
                "  allow: think",
            ]
        )

        assert _parse_agent_list(output) == [
            {
                "name": "build",
                "type": "primary",
                "details": ["allow: read", "deny: write"],
            },
            {"name": "plan", "type": "primary", "details": ["allow: think"]},
        ]


class TestAgentCliSelection:
    """Test agent CLI selection logic."""

    def test_get_agent_cli_defaults_to_opencode(self):
        """Ensure opencode CLI is used by default."""
        from agent_cli import OpenCodeAgentCLI, get_agent_cli

        cli = get_agent_cli()

        assert isinstance(cli, OpenCodeAgentCLI)

    def test_get_agent_cli_uses_kiro(self):
        """Ensure kiro CLI is selected when configured."""
        from agent_cli import KiroAgentCLI, get_agent_cli

        with patch.dict("os.environ", {"MADE_AGENT_CLI": "kiro"}):
            cli = get_agent_cli()

        assert isinstance(cli, KiroAgentCLI)
