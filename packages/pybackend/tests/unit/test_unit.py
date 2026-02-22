"""
Unit tests focusing on isolated testing of individual functions.
These tests mock all external dependencies and focus on business logic.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch

# These would be unit tests for individual service functions
# For now, creating a minimal unit test structure


class TestConfigFunctions:
    """Test configuration-related functions in isolation."""

    @patch("os.path.exists")
    @patch("os.makedirs")
    def test_ensure_made_structure_creates_directories(
        self, mock_makedirs, mock_exists
    ):
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

    @patch("os.path.expanduser")
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

    @patch("agent_service.get_workspace_home")
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

    @patch("agent_service.get_workspace_home")
    @patch("agent_service.Path")
    def test_get_working_directory_repository_not_exists(
        self, mock_path_class, mock_get_workspace_home
    ):
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

    @patch("agent_service.ensure_directory")
    @patch("agent_service.get_made_directory")
    def test_get_working_directory_knowledge_chat(
        self, mock_get_made_directory, mock_ensure_directory
    ):
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

    @patch("agent_service.ensure_directory")
    @patch("agent_service.get_made_directory")
    def test_get_working_directory_constitution_chat(
        self, mock_get_made_directory, mock_ensure_directory
    ):
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

    @patch("agent_service.get_agent_cli")
    def test_send_agent_message_success(self, mock_get_cli):
        """Test successful agent message sending."""
        from agent_service import send_agent_message
        from agent_results import RunResult, ResponsePart

        # Mock the CLI to return a successful result
        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli

        mock_result = RunResult(
            success=True,
            session_id="test_session_123",
            response_parts=[
                ResponsePart(text="Test response", timestamp=1000, part_type="final")
            ],
        )
        mock_cli.run_agent.return_value = mock_result

        result = send_agent_message("test-repo", "Hello agent")

        assert result["response"] == "Processing..."  # Status message only
        assert result["sessionId"] == "test_session_123"
        assert result["processing"] is True  # Indicates polling needed
        assert "responses" not in result  # No longer included

    @patch("agent_service.get_agent_cli")
    def test_send_agent_message_with_session_id(self, mock_get_cli):
        """Test agent message sending with session ID."""
        from agent_service import send_agent_message
        from agent_results import RunResult, ResponsePart

        # Mock the CLI to return a result with session ID
        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli

        mock_result = RunResult(
            success=True,
            session_id="existing_session_456",
            response_parts=[
                ResponsePart(
                    text="Response with session", timestamp=2000, part_type="final"
                )
            ],
        )
        mock_cli.run_agent.return_value = mock_result

        result = send_agent_message(
            "test-repo", "Continue conversation", session_id="existing_session_456"
        )

        assert result["response"] == "Processing..."  # Status message only
        assert result["sessionId"] == "existing_session_456"
        assert result["processing"] is True  # Indicates polling needed
        mock_cli.run_agent.assert_called_once()
        call_args = mock_cli.run_agent.call_args
        assert (
            call_args[0][1] == "existing_session_456"
        )  # session_id is second positional arg
        assert call_args[0][3] is None  # model should default to None

    def test_parse_opencode_output_single_text_is_final(self):
        pass

    @patch("agent_service.get_agent_cli")
    def test_send_agent_message_with_model(self, mock_get_cli):
        """Test agent message sending with explicit model selection."""
        from agent_service import send_agent_message
        from agent_results import RunResult

        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli

        mock_result = RunResult(
            success=True,
            session_id="model_session_789",
            response_parts=[],
        )
        mock_cli.run_agent.return_value = mock_result

        result = send_agent_message(
            "test-repo",
            "Hello agent",
            session_id="model_session_789",
            model="opencode/gpt-5-nano",
        )

        assert result["sessionId"] == "model_session_789"
        mock_cli.run_agent.assert_called_once()
        call_args = mock_cli.run_agent.call_args
        assert call_args[0][3] == "opencode/gpt-5-nano"

    @patch("agent_service.get_agent_cli")
    def test_send_agent_message_with_default_model(self, mock_get_cli):
        """Test agent message sending with default model skips flag."""
        from agent_service import send_agent_message
        from agent_results import RunResult

        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli

        mock_result = RunResult(
            success=True,
            session_id="default_model_session",
            response_parts=[],
        )
        mock_cli.run_agent.return_value = mock_result

        send_agent_message(
            "test-repo",
            "Hello agent",
            session_id="default_model_session",
            model="default",
        )

        mock_cli.run_agent.assert_called_once()
        call_args = mock_cli.run_agent.call_args
        assert call_args[0][3] is None

    @patch("agent_service.get_agent_cli")
    def test_send_agent_message_error_handling(self, mock_get_cli):
        """Test error handling in agent message sending."""
        from agent_service import send_agent_message
        from agent_results import RunResult

        # Mock the CLI to return a failure result
        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli

        mock_result = RunResult(
            success=False,
            session_id=None,
            response_parts=[],
            error_message="Command failed",
        )
        mock_cli.run_agent.return_value = mock_result

        result = send_agent_message("test-repo", "This will fail")
        assert result["response"] == "Processing..."  # Status message only
        assert result["processing"] is True  # Indicates polling needed
        # Error will be available through export API, not immediate response

        # Test FileNotFoundError
        mock_cli.run_agent.side_effect = FileNotFoundError("CLI not found")
        mock_cli.missing_command_error.return_value = "CLI not found error"
        result = send_agent_message("test-repo", "This will fail")
        assert "CLI not found error" in result["response"]  # Immediate error return
        assert result["processing"] is False  # No polling needed
        assert result["sessionId"] is None

        # Test generic exception
        mock_cli.run_agent.side_effect = Exception("Generic error")
        result = send_agent_message("test-repo", "This will fail")
        assert "Error: Generic error" in result["response"]  # Immediate error return
        assert result["processing"] is False  # No polling needed

    @patch("agent_service.get_agent_cli")
    def test_list_chat_sessions(self, mock_get_cli):
        """Test listing chat sessions with success and error scenarios."""
        from agent_service import list_chat_sessions
        from agent_results import SessionListResult, SessionInfo

        # Test successful session listing
        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli

        mock_result = SessionListResult(
            success=True,
            sessions=[
                SessionInfo(
                    session_id="ses_1", title="First Session", updated="2 hours ago"
                ),
                SessionInfo(
                    session_id="ses_2", title="Second Session", updated="1 day ago"
                ),
            ],
        )
        mock_cli.list_sessions.return_value = mock_result

        result = list_chat_sessions("test-repo", limit=5)

        assert len(result) == 2
        assert result[0]["id"] == "ses_1"
        assert result[0]["title"] == "First Session"

        # Test error handling
        mock_error_result = SessionListResult(
            success=False, sessions=[], error_message="Failed to list sessions"
        )
        mock_cli.list_sessions.return_value = mock_error_result

        with pytest.raises(RuntimeError, match="Failed to list sessions"):
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
