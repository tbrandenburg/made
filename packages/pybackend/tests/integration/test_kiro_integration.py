"""Integration tests for KiroAgentCLI with real kiro-cli installation."""

import subprocess
from pathlib import Path

import pytest

from kiro_agent_cli import KiroAgentCLI
from agent_results import AgentListResult, SessionListResult, ExportResult


@pytest.mark.integration
class TestKiroIntegration:
    """Integration tests assuming kiro-cli is installed and available."""

    def test_kiro_cli_available(self):
        """Test that kiro-cli command is available and responsive."""
        try:
            result = subprocess.run(
                ["kiro-cli", "--help"],
                capture_output=True,
                text=True,
                timeout=10
            )
            assert result.returncode == 0
            assert "kiro-cli" in result.stdout.lower() or "usage" in result.stdout.lower()
        except FileNotFoundError:
            pytest.skip("kiro-cli not available in PATH")
        except subprocess.TimeoutExpired:
            pytest.fail("kiro-cli --help timed out")

    def test_agent_list_integration(self):
        """Test KiroAgentCLI.list_agents() with real kiro-cli."""
        cli = KiroAgentCLI()
        result = cli.list_agents()
        
        assert isinstance(result, AgentListResult)
        
        if result.success:
            # Should have at least some agents (built-in ones)
            assert isinstance(result.agents, list)
            # Verify agent structure
            for agent in result.agents:
                assert hasattr(agent, 'name')
                assert hasattr(agent, 'agent_type')
                assert hasattr(agent, 'details')
                assert isinstance(agent.name, str)
                assert len(agent.name) > 0
        else:
            # If it fails, should have a meaningful error message
            assert result.error_message is not None
            assert len(result.error_message) > 0

    def test_session_list_integration(self):
        """Test KiroAgentCLI.list_sessions() with real database."""
        cli = KiroAgentCLI()
        result = cli.list_sessions(Path.cwd())
        
        assert isinstance(result, SessionListResult)
        
        if result.success:
            # Should return a list (may be empty)
            assert isinstance(result.sessions, list)
            # Verify session structure if any sessions exist
            for session in result.sessions:
                assert hasattr(session, 'session_id')
                assert hasattr(session, 'title')
                assert hasattr(session, 'updated')
                assert isinstance(session.session_id, str)
                assert len(session.session_id) > 0
        else:
            # If it fails, should have a meaningful error message
            assert result.error_message is not None
            # Common failure reasons
            assert any(phrase in result.error_message.lower() for phrase in [
                "database not found",
                "error",
                "permission denied"
            ])

    def test_export_session_integration(self):
        """Test KiroAgentCLI.export_session() with real conversation data."""
        cli = KiroAgentCLI()
        
        # First get available sessions
        sessions_result = cli.list_sessions(Path.cwd())
        
        if not sessions_result.success or not sessions_result.sessions:
            pytest.skip("No sessions available for export test")
        
        # Try to export the first session
        first_session = sessions_result.sessions[0]
        result = cli.export_session(first_session.session_id, Path.cwd())
        
        assert isinstance(result, ExportResult)
        
        if result.success:
            # Should have messages
            assert isinstance(result.messages, list)
            # Verify message structure if any messages exist
            for message in result.messages:
                assert hasattr(message, 'role')
                assert hasattr(message, 'content_type')
                assert hasattr(message, 'content')
                assert message.role in ['user', 'assistant']
                assert message.content_type in ['text', 'tool', 'tool_use']
        else:
            # If it fails, should have a meaningful error message
            assert result.error_message is not None
            assert len(result.error_message) > 0

    def test_interface_spec_compliance(self):
        """Test that all KiroAgentCLI methods return correct typed results per interface spec."""
        cli = KiroAgentCLI()
        
        # Test list_agents return type
        agents_result = cli.list_agents()
        assert isinstance(agents_result, AgentListResult)
        assert hasattr(agents_result, 'success')
        assert hasattr(agents_result, 'agents')
        assert hasattr(agents_result, 'error_message')
        assert isinstance(agents_result.success, bool)
        assert isinstance(agents_result.agents, list)
        
        # Test to_frontend_format methods exist and work
        if agents_result.success and agents_result.agents:
            frontend_format = agents_result.agents[0].to_frontend_format()
            assert isinstance(frontend_format, dict)
            assert 'name' in frontend_format
            assert 'type' in frontend_format
            assert 'details' in frontend_format
        
        # Test list_sessions return type
        sessions_result = cli.list_sessions(Path.cwd())
        assert isinstance(sessions_result, SessionListResult)
        assert hasattr(sessions_result, 'success')
        assert hasattr(sessions_result, 'sessions')
        assert hasattr(sessions_result, 'error_message')
        assert isinstance(sessions_result.success, bool)
        assert isinstance(sessions_result.sessions, list)
        
        # Test to_frontend_format methods exist and work
        if sessions_result.success and sessions_result.sessions:
            frontend_format = sessions_result.sessions[0].to_frontend_format()
            assert isinstance(frontend_format, dict)
            assert 'id' in frontend_format
            assert 'title' in frontend_format
            assert 'updated' in frontend_format
        
        # Test export_session return type (if sessions available)
        if sessions_result.success and sessions_result.sessions:
            export_result = cli.export_session(sessions_result.sessions[0].session_id, Path.cwd())
            assert isinstance(export_result, ExportResult)
            assert hasattr(export_result, 'success')
            assert hasattr(export_result, 'session_id')
            assert hasattr(export_result, 'messages')
            assert hasattr(export_result, 'error_message')
            assert isinstance(export_result.success, bool)
            assert isinstance(export_result.messages, list)
            
            # Test message to_frontend_format if messages exist
            if export_result.success and export_result.messages:
                frontend_format = export_result.messages[0].to_frontend_format()
                assert isinstance(frontend_format, dict)
                assert 'role' in frontend_format
                assert 'type' in frontend_format
                assert 'content' in frontend_format

    def test_database_path_resolution(self):
        """Test that database path resolution works correctly."""
        cli = KiroAgentCLI()
        db_path = cli._get_database_path()
        
        if db_path is not None:
            # Should be a valid Path object
            assert isinstance(db_path, Path)
            # Should exist
            assert db_path.exists()
            # Should be a file
            assert db_path.is_file()
            # Should have .sqlite3 extension
            assert db_path.suffix == ".sqlite3"

    def test_error_handling_graceful_degradation(self):
        """Test that error handling provides graceful degradation."""
        cli = KiroAgentCLI()
        
        # Test with non-existent session
        result = cli.export_session("non-existent-session-id", Path.cwd())
        assert isinstance(result, ExportResult)
        assert result.success is False
        assert result.error_message is not None
        assert len(result.error_message) > 0
        
        # Test with non-existent directory
        result = cli.list_sessions(Path("/non/existent/directory"))
        assert isinstance(result, SessionListResult)
        # Should either succeed with empty list or fail gracefully
        if not result.success:
            assert result.error_message is not None
            assert len(result.error_message) > 0
