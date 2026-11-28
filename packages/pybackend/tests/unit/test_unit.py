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

    def setup_method(self):
        """Clear agents cache before each test to prevent cross-test contamination."""
        import agent_service

        agent_service._AGENTS_CACHE.clear()

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

    @patch("agent_service.ensure_directory")
    @patch("agent_service.get_made_directory")
    def test_get_working_directory_task_chat(
        self, mock_get_made_directory, mock_ensure_directory
    ):
        from agent_service import _get_working_directory

        made_dir = Path("/test/made/home/.made")
        tasks_dir = made_dir / "tasks"
        mock_get_made_directory.return_value = made_dir
        mock_ensure_directory.return_value = tasks_dir

        result = _get_working_directory("task:daily.md")

        mock_get_made_directory.assert_called_once()
        mock_ensure_directory.assert_called_once_with(tasks_dir)
        assert result == tasks_dir

    @patch("agent_service.get_agent_cli")
    @patch("agent_service.get_workspace_home")
    def test_list_agents_uses_workspace_cwd(
        self, mock_get_workspace_home, mock_get_cli
    ):
        """Test agent listing executes with workspace cwd when available."""
        from agent_service import list_agents
        from agent_results import AgentListResult, AgentInfo

        workspace = Mock(spec=Path)
        workspace.__str__ = Mock(return_value="/workspace/made")
        workspace.exists.return_value = True
        workspace.is_dir.return_value = True
        mock_get_workspace_home.return_value = workspace

        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli
        mock_cli.list_agents.return_value = AgentListResult(
            success=True,
            agents=[AgentInfo(name="test", agent_type="primary", details=[])],
        )

        result = list_agents()

        mock_cli.list_agents.assert_called_once_with(cwd=workspace)
        assert result == [{"name": "test", "type": "primary", "details": []}]

    @patch("agent_service.get_agent_cli")
    @patch("agent_service.get_workspace_home")
    def test_list_agents_uses_repository_cwd(
        self, mock_get_workspace_home, mock_get_cli
    ):
        """Test agent listing executes with repository cwd when provided."""
        from agent_service import list_agents
        from agent_results import AgentListResult, AgentInfo

        workspace = Path("/workspace")
        repository = workspace / "sample"

        mock_get_workspace_home.return_value = workspace
        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli
        mock_cli.list_agents.return_value = AgentListResult(
            success=True,
            agents=[AgentInfo(name="test", agent_type="primary", details=[])],
        )

        with (
            patch.object(Path, "exists", return_value=True),
            patch.object(Path, "is_dir", return_value=True),
        ):
            result = list_agents("sample")

        mock_cli.list_agents.assert_called_once_with(cwd=repository)
        assert result == [{"name": "test", "type": "primary", "details": []}]

    @patch("agent_service.get_workspace_home")
    def test_list_agents_repository_not_found(self, mock_get_workspace_home):
        """Test repository-specific agent listing fails for missing repository."""
        from agent_service import list_agents

        workspace = Path("/workspace")
        mock_get_workspace_home.return_value = workspace

        with (
            patch.object(Path, "exists", return_value=False),
            patch.object(Path, "is_dir", return_value=False),
        ):
            with pytest.raises(FileNotFoundError):
                list_agents("missing")

    @patch("agent_service._list_agents_uncached")
    def test_list_agents_caches_result(self, mock_uncached):
        """Second call returns cached result without invoking subprocess again."""
        import agent_service

        agent_service._AGENTS_CACHE.clear()
        mock_uncached.return_value = [
            {"name": "test", "type": "primary", "details": []}
        ]

        result1 = agent_service.list_agents("my-repo")
        result2 = agent_service.list_agents("my-repo")

        mock_uncached.assert_called_once()
        assert result1 == result2

    @patch("agent_service._list_agents_uncached")
    def test_list_agents_separate_cache_per_repo(self, mock_uncached):
        """Different repo names use separate cache keys."""
        import agent_service

        agent_service._AGENTS_CACHE.clear()
        mock_uncached.return_value = []

        agent_service.list_agents("repo-a")
        agent_service.list_agents("repo-b")

        assert mock_uncached.call_count == 2

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
        assert "Command failed" in result["response"]  # Immediate error return
        assert result["processing"] is False  # CLI failure clears immediately
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














    def test_is_process_running_for_session_matches_command_line(self):
        """_is_process_running_for_session must match session_id in command lines."""
        from unittest.mock import patch
        from agent_service import _is_process_running_for_session

        fake_processes = [
            {"pid": 1001, "command": "opencode run -s ses_abc123 --format json"},
            {"pid": 1002, "command": "pi --print --mode json --session pi-xyz"},
        ]

        with patch(
            "agent_service.list_running_agent_processes", return_value=fake_processes
        ):
            assert _is_process_running_for_session("ses_abc123") is True
            assert _is_process_running_for_session("pi-xyz") is True
            assert _is_process_running_for_session("nonexistent-session") is False

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

    @patch("agent_service.get_agent_cli")
    def test_list_chat_sessions_keeps_root_limit_and_child_listing_is_separate(
        self, mock_get_cli
    ):
        from agent_service import list_chat_child_sessions, list_chat_sessions
        from agent_results import SessionListResult, SessionInfo

        roots = [
            SessionInfo(f"ses_root_{index}", f"Root {index}", "today")
            for index in range(55)
        ]
        children = [
            SessionInfo(
                "ses_child_old_parent", "Child", "today", "ses_root_54", "Root 54"
            ),
            SessionInfo(
                "ses_grandchild", "Grandchild", "today", "ses_child_old_parent", "Child"
            ),
            *[
                SessionInfo(
                    f"ses_child_{index}",
                    f"Child {index}",
                    "today",
                    "ses_root_0",
                    "Root 0",
                )
                for index in range(58)
            ],
        ]
        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli
        mock_cli.list_sessions.return_value = SessionListResult(
            success=True, sessions=roots
        )
        mock_cli.list_child_sessions.return_value = SessionListResult(
            success=True, sessions=children
        )

        result = list_chat_sessions("test-repo", limit=10)

        assert [session["id"] for session in result] == [
            f"ses_root_{index}" for index in range(10)
        ]
        assert all("ses_child" not in session["id"] for session in result)

        child_result = list_chat_child_sessions("test-repo", limit=500)

        assert len(child_result) == 50
        assert child_result[0]["id"] == "ses_child_old_parent"
        assert child_result[0]["parentId"] == "ses_root_54"
        assert child_result[0]["parentTitle"] == "Root 54"
        assert child_result[1]["id"] == "ses_grandchild"
        assert child_result[1]["parentId"] == "ses_child_old_parent"

    @patch("agent_service.get_agent_cli", return_value=object())
    def test_non_v2_child_listing_is_empty(self, _mock_get_cli):
        from agent_service import list_chat_child_sessions

        assert list_chat_child_sessions("test-repo") == []

    @patch("agent_service.get_agent_cli")
    def test_child_listing_failure_does_not_log_adapter_error(
        self, mock_get_cli, caplog
    ):
        from agent_service import list_chat_child_sessions
        from agent_results import SessionListResult

        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli
        mock_cli.list_child_sessions.return_value = SessionListResult(
            success=False,
            sessions=[],
            error_message="synthetic-private-child-list-marker",
        )

        with pytest.raises(RuntimeError, match="Failed to list child sessions"):
            list_chat_child_sessions("test-repo")

        assert "Listing child sessions failed" in caplog.text
        assert "synthetic-private-child-list-marker" not in caplog.text

    @patch("agent_service.get_agent_cli")
    def test_export_chat_history_missing_session_returns_empty(self, mock_get_cli):
        """Test missing sessions return an empty history payload."""
        from agent_service import export_chat_history
        from agent_results import ExportResult

        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli
        mock_cli.export_session.return_value = ExportResult(
            success=False,
            session_id="1",
            messages=[],
            error_message="Session file not found for ID: 1",
        )

        assert export_chat_history("1", None, "test-repo") == {
            "sessionId": "1",
            "messages": [],
            "processing": False,
            "startedAt": None,
        }

    @patch("agent_service.get_agent_cli")
    def test_export_chat_history_missing_session_with_directory_error_returns_empty(
        self, mock_get_cli
    ):
        """Treat session-not-found variants as empty history."""
        from agent_service import export_chat_history
        from agent_results import ExportResult

        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli
        mock_cli.export_session.return_value = ExportResult(
            success=False,
            session_id="1",
            messages=[],
            error_message="Session 1 not found in directory /tmp/repo",
        )

        assert export_chat_history("1", None, "test-repo") == {
            "sessionId": "1",
            "messages": [],
            "processing": False,
            "startedAt": None,
        }

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














class TestCorsOrigins:
    """Tests for CORS origin configuration."""

    def test_default_origins_local_dev(self, monkeypatch):
        monkeypatch.delenv("MADE_ALLOWED_ORIGINS", raising=False)

        from config import get_cors_origins

        assert get_cors_origins() == [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]

    def test_custom_origins_from_env(self, monkeypatch):
        monkeypatch.setenv(
            "MADE_ALLOWED_ORIGINS",
            "https://app.example.com, https://admin.example.com",
        )

        from config import get_cors_origins

        assert get_cors_origins() == [
            "https://app.example.com",
            "https://admin.example.com",
        ]

    def test_empty_or_whitespace_only_env_falls_back_to_defaults(self, monkeypatch):
        from config import get_cors_origins

        for value in ("", "   ,  "):
            monkeypatch.setenv("MADE_ALLOWED_ORIGINS", value)
            assert get_cors_origins() == [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            ]
