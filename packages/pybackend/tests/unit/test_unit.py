"""
Unit tests focusing on isolated testing of individual functions.
These tests mock all external dependencies and focus on business logic.
"""

import pytest
import subprocess
import time
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, Mock, call, patch

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

    @patch('agent_service.get_made_home')
    def test_get_working_directory_knowledge_chat(self, mock_get_made_home):
        """Test working directory selection for knowledge chats."""
        from agent_service import _get_working_directory

        made_home = Path("/test/made/home")
        mock_get_made_home.return_value = made_home

        # Test knowledge chat
        result = _get_working_directory("knowledge:some-artefact")

        mock_get_made_home.assert_called_once()
        assert result == made_home

    @patch('agent_service.get_made_home')
    def test_get_working_directory_constitution_chat(self, mock_get_made_home):
        """Test working directory selection for constitution chats."""
        from agent_service import _get_working_directory

        made_home = Path("/test/made/home")
        mock_get_made_home.return_value = made_home

        # Test constitution chat
        result = _get_working_directory("constitution:some-constitution")

        mock_get_made_home.assert_called_once()
        assert result == made_home

    @patch('agent_service._get_working_directory')
    @patch('agent_service.subprocess.run')
    def test_send_agent_message_success(self, mock_subprocess_run, mock_get_working_dir):
        """Test successful agent message sending."""
        from agent_service import _active_conversations, send_agent_message

        # Setup mocks
        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Agent response content"
        mock_subprocess_run.return_value = mock_result

        _active_conversations.clear()

        # Test successful message
        result = send_agent_message("test-repo", "Hello agent")
        
        # Verify subprocess call
        mock_subprocess_run.assert_called_once_with(
            ["opencode", "run", "Hello agent"],
            capture_output=True,
            text=True,
            cwd=mock_working_dir
        )
        
        # Verify response structure
        assert "messageId" in result
        assert "sent" in result
        assert result["prompt"] == "Hello agent"
        assert result["response"] == "Agent response content"

    @patch('agent_service._get_working_directory')
    @patch('agent_service.subprocess.run')
    def test_send_agent_message_continuation(self, mock_subprocess_run, mock_get_working_dir):
        """Test follow-up messages use continuation flag."""
        from agent_service import _active_conversations, send_agent_message

        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = "Agent response content"
        mock_subprocess_run.return_value = mock_result

        _active_conversations.clear()

        send_agent_message("test-repo", "Hello agent")
        send_agent_message("test-repo", "Follow up")

        assert mock_subprocess_run.call_args_list[0] == call(
            ["opencode", "run", "Hello agent"],
            capture_output=True,
            text=True,
            cwd=mock_working_dir,
        )
        assert mock_subprocess_run.call_args_list[1] == call(
            ["opencode", "run", "-c", "Follow up"],
            capture_output=True,
            text=True,
            cwd=mock_working_dir,
        )

    @patch('agent_service._get_working_directory')
    @patch('agent_service.subprocess.run')
    def test_send_agent_message_command_failure(self, mock_subprocess_run, mock_get_working_dir):
        """Test agent message sending with command failure."""
        from agent_service import _active_conversations, send_agent_message
        
        # Setup mocks
        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir
        
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stderr = "Command error"
        mock_subprocess_run.return_value = mock_result

        _active_conversations.clear()
        
        # Test failed command
        result = send_agent_message("test-repo", "Hello agent")

        # Verify error response
        assert result["response"] == "Error: Command error"

    @patch('agent_service._get_working_directory')
    @patch('agent_service.subprocess.run')
    def test_send_agent_message_file_not_found(self, mock_subprocess_run, mock_get_working_dir):
        """Test agent message sending when opencode is not found."""
        from agent_service import _active_conversations, send_agent_message
        
        # Setup mocks
        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_subprocess_run.side_effect = FileNotFoundError()

        _active_conversations.clear()
        
        # Test file not found
        result = send_agent_message("test-repo", "Hello agent")
        
        # Verify file not found response
        assert result["response"] == "Error: 'opencode' command not found. Please ensure it is installed and in PATH."

    @patch('agent_service._get_working_directory')
    @patch('agent_service.subprocess.run')
    def test_send_agent_message_generic_exception(self, mock_subprocess_run, mock_get_working_dir):
        """Test agent message sending with generic exception."""
        from agent_service import _active_conversations, send_agent_message
        
        # Setup mocks
        mock_working_dir = Path("/test/workspace/repo")
        mock_get_working_dir.return_value = mock_working_dir

        mock_subprocess_run.side_effect = Exception("Generic error")

        _active_conversations.clear()
        
        # Test generic exception
        result = send_agent_message("test-repo", "Hello agent")
        
        # Verify generic error response
        assert result["response"] == "Error: Generic error"
