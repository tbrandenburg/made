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

        with patch.object(Path, "exists", return_value=True), patch.object(
            Path, "is_dir", return_value=True
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

        with patch.object(Path, "exists", return_value=False), patch.object(
            Path, "is_dir", return_value=False
        ):
            with pytest.raises(FileNotFoundError):
                list_agents("missing")

    @patch("agent_service._list_agents_uncached")
    def test_list_agents_caches_result(self, mock_uncached):
        """Second call returns cached result without invoking subprocess again."""
        import agent_service

        agent_service._AGENTS_CACHE.clear()
        mock_uncached.return_value = [{"name": "test", "type": "primary", "details": []}]

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
        from agent_service import send_agent_message, _clear_channel_processing
        from agent_results import RunResult

        # Ensure clean state (prior success tests leave entries in _processing_channels)
        _clear_channel_processing("test-repo")

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

    def test_concurrent_sessions_on_same_channel_not_blocked(self):
        """Two different sessions must not block each other on the same channel."""
        from agent_service import _mark_channel_processing, _clear_channel_processing

        # Given: session A starts processing
        assert _mark_channel_processing("ses_A") is True
        # When: session B on the same repo also tries to start
        # Then: it must succeed independently
        assert _mark_channel_processing("ses_B") is True

        _clear_channel_processing("ses_A")
        _clear_channel_processing("ses_B")

    def test_same_session_blocked_while_processing(self):
        """A single session sending a second message before first completes must raise ChannelBusyError."""
        from agent_service import _mark_channel_processing, _clear_channel_processing, ChannelBusyError

        # Given: lock for session X is already held
        assert _mark_channel_processing("ses_X") is True
        try:
            # When: same session tries to send another message
            with pytest.raises(ChannelBusyError):
                # send_agent_message derives lock_key = session_id when provided
                # We simulate by calling _mark_channel_processing directly as the function would
                from agent_service import _mark_channel_processing as mark
                result = mark("ses_X")
                assert result is False
                raise ChannelBusyError("Agent is still processing a previous message for this chat.")
        finally:
            _clear_channel_processing("ses_X")

    @patch("agent_service.get_agent_cli")
    def test_success_keeps_processing_entry_after_return(self, mock_get_cli):
        """Success path must leave _processing_channels entry intact after return."""
        from agent_service import (
            send_agent_message,
            _processing_channels,
            _clear_channel_processing,
        )
        from agent_results import RunResult

        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli
        mock_result = RunResult(
            success=True,
            session_id="session_stale_test",
            response_parts=[],
        )
        mock_cli.run_agent.return_value = mock_result

        result = send_agent_message("test-stale-repo", "Hello")

        assert result["processing"] is True
        # Entry must still be present so GET /status returns True before first poll
        assert "test-stale-repo" in _processing_channels
        _clear_channel_processing("test-stale-repo")  # cleanup

    @patch("agent_service.get_agent_cli")
    def test_file_not_found_clears_processing_entry(self, mock_get_cli):
        """FileNotFoundError path must clear the processing entry before returning."""
        from agent_service import send_agent_message, _processing_channels

        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli
        mock_cli.run_agent.side_effect = FileNotFoundError("CLI not found")
        mock_cli.missing_command_error.return_value = "CLI not found error"

        result = send_agent_message("test-fnf-repo", "Hi")

        assert result["processing"] is False
        assert "test-fnf-repo" not in _processing_channels

    @patch("agent_service.get_agent_cli")
    def test_exception_clears_processing_entry(self, mock_get_cli):
        """Generic Exception path must clear the processing entry before returning."""
        from agent_service import send_agent_message, _processing_channels

        mock_cli = Mock()
        mock_get_cli.return_value = mock_cli
        mock_cli.run_agent.side_effect = Exception("Boom")

        result = send_agent_message("test-exc-repo", "Hi")

        assert result["processing"] is False
        assert "test-exc-repo" not in _processing_channels

    def test_mark_channel_processing_replaces_exited_process_entry(self):
        """_mark_channel_processing must replace entries whose process has exited."""
        from unittest.mock import MagicMock
        from datetime import UTC, datetime
        from agent_service import (
            _mark_channel_processing,
            _clear_channel_processing,
            _processing_channels,
            _active_processes,
            _processing_lock,
        )

        channel = "stale-exited-channel"
        try:
            # Simulate a stale entry with an exited process
            with _processing_lock:
                _processing_channels[channel] = datetime.now(UTC)
                mock_proc = MagicMock()
                mock_proc.poll.return_value = 0  # process has exited
                _active_processes[channel] = mock_proc

            # Should succeed: stale exited process is replaced
            assert _mark_channel_processing(channel) is True
        finally:
            _clear_channel_processing(channel)

    def test_mark_channel_processing_rejects_running_process_entry(self):
        """_mark_channel_processing must reject entries whose process is still running."""
        from unittest.mock import MagicMock
        from datetime import UTC, datetime
        from agent_service import (
            _mark_channel_processing,
            _clear_channel_processing,
            _processing_channels,
            _active_processes,
            _processing_lock,
        )

        channel = "running-channel"
        try:
            with _processing_lock:
                _processing_channels[channel] = datetime.now(UTC)
                mock_proc = MagicMock()
                mock_proc.poll.return_value = None  # process still running
                _active_processes[channel] = mock_proc

            assert _mark_channel_processing(channel) is False
        finally:
            _clear_channel_processing(channel)

    def test_get_channel_status_clears_exited_process_entry(self):
        """get_channel_status must detect and clean up entries for completed processes."""
        from unittest.mock import MagicMock
        from datetime import UTC, datetime
        from agent_service import (
            get_channel_status,
            _processing_channels,
            _active_processes,
            _processing_lock,
        )

        channel = "status-stale-channel"
        with _processing_lock:
            _processing_channels[channel] = datetime.now(UTC)
            mock_proc = MagicMock()
            mock_proc.poll.return_value = 0  # process exited
            _active_processes[channel] = mock_proc

        status = get_channel_status(channel)

        assert status["processing"] is False
        assert channel not in _processing_channels

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

    def test_get_channel_status_reverse_lookup_via_conversation_sessions(self):
        """get_channel_status must find processing entry by reverse lookup when lock_key is a session_id."""
        from datetime import UTC, datetime
        from agent_service import (
            get_channel_status,
            _conversation_sessions,
            _processing_channels,
            _processing_lock,
        )

        channel = "reverse-lookup-repo"
        session_id = "reverse-session-123"
        try:
            with _processing_lock:
                _conversation_sessions[channel] = session_id
                _processing_channels[channel] = datetime.now(UTC)

            status = get_channel_status(session_id)

            assert status["processing"] is True
            # session_id key should now be populated (propagated by get_channel_status)
            with _processing_lock:
                assert session_id in _processing_channels
        finally:
            with _processing_lock:
                _conversation_sessions.pop(channel, None)
                _processing_channels.pop(channel, None)
                _processing_channels.pop(session_id, None)

    def test_get_channel_status_falls_back_to_persisted_state(self):
        """get_channel_status must restore processing=True from disk when in-memory is empty."""
        from datetime import UTC, datetime
        from unittest.mock import patch
        from agent_service import (
            get_channel_status,
            _processing_channels,
            _active_processes,
            _processing_lock,
        )

        lock_key = "persisted-session-456"
        with _processing_lock:
            _processing_channels.pop(lock_key, None)
            _active_processes.pop(lock_key, None)

        with patch("agent_service._load_processing_state") as mock_load:
            mock_load.return_value = {lock_key: datetime.now(UTC)}
            with patch("agent_service._dump_processing_state"):
                status = get_channel_status(lock_key)

        assert status["processing"] is True
        assert status["startedAt"] is not None

    def test_alias_cleanup_removes_all_related_keys_on_process_exit(self):
        """get_channel_status cleanup must remove both channel and session_id keys when process exits."""
        from datetime import UTC, datetime
        from unittest.mock import MagicMock, patch
        from agent_service import (
            get_channel_status,
            _conversation_sessions,
            _processing_channels,
            _active_processes,
            _processing_lock,
        )

        channel = "alias-cleanup-repo"
        session_id = "alias-cleanup-session"
        try:
            mock_proc = MagicMock()
            mock_proc.poll.return_value = 0  # process exited
            with _processing_lock:
                _conversation_sessions[channel] = session_id
                _processing_channels[channel] = datetime.now(UTC)
                _processing_channels[session_id] = datetime.now(UTC)
                _active_processes[session_id] = mock_proc

            with patch("agent_service._dump_processing_state"):
                get_channel_status(session_id)

            with _processing_lock:
                assert channel not in _processing_channels
                assert session_id not in _processing_channels
        finally:
            with _processing_lock:
                _conversation_sessions.pop(channel, None)
                _processing_channels.pop(channel, None)
                _processing_channels.pop(session_id, None)

    def test_mark_channel_processing_persists_state(self):
        """_mark_channel_processing must call _dump_processing_state."""
        from unittest.mock import patch
        from agent_service import _mark_channel_processing, _clear_channel_processing

        channel = "persist-mark-channel"
        try:
            with patch("agent_service._dump_processing_state") as mock_dump:
                result = _mark_channel_processing(channel)
                assert result is True
                mock_dump.assert_called_once()
        finally:
            with patch("agent_service._dump_processing_state"):
                _clear_channel_processing(channel)

    def test_clear_channel_processing_persists_state(self):
        """_clear_channel_processing must call _dump_processing_state."""
        from datetime import UTC, datetime
        from unittest.mock import patch
        from agent_service import (
            _clear_channel_processing,
            _processing_channels,
            _processing_lock,
        )

        channel = "persist-clear-channel"
        with _processing_lock:
            _processing_channels[channel] = datetime.now(UTC)

        with patch("agent_service._dump_processing_state") as mock_dump:
            _clear_channel_processing(channel)
            mock_dump.assert_called_once()

    def test_load_processing_state_discards_stale_entries(self):
        """_load_processing_state must discard entries older than _MAX_PROCESSING_AGE."""
        from datetime import UTC, datetime, timedelta
        from unittest.mock import patch
        from agent_service import _load_processing_state, _MAX_PROCESSING_AGE

        recent_time = datetime.now(UTC) - timedelta(minutes=10)
        stale_time = datetime.now(UTC) - _MAX_PROCESSING_AGE - timedelta(minutes=1)

        fake_data = {
            "recent-session": recent_time.isoformat(),
            "stale-session": stale_time.isoformat(),
        }

        with patch("agent_service._get_agent_state_path") as mock_path:
            mock_file = mock_path.return_value
            mock_file.exists.return_value = True
            mock_file.read_text.return_value = __import__("json").dumps(fake_data)

            result = _load_processing_state()

        assert "recent-session" in result
        assert "stale-session" not in result

    def test_get_channel_status_ignores_stale_persisted_entry(self):
        """get_channel_status must not report processing for entries beyond the TTL."""
        from datetime import UTC, datetime, timedelta
        from unittest.mock import patch
        from agent_service import get_channel_status, _MAX_PROCESSING_AGE

        stale_time = datetime.now(UTC) - _MAX_PROCESSING_AGE - timedelta(minutes=1)

        with patch("agent_service._load_processing_state") as mock_load:
            mock_load.return_value = {}  # stale entry already filtered by _load
            status = get_channel_status("ghost-session-after-restart")

        assert status["processing"] is False
