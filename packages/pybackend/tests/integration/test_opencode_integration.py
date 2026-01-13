"""Integration tests for OpenCodeAgentCLI with real opencode installation."""

import subprocess
from pathlib import Path

import pytest

from agent_cli import OpenCodeAgentCLI
from agent_results import AgentListResult, SessionListResult, ExportResult, RunResult


@pytest.mark.integration
class TestOpenCodeIntegration:
    """Integration tests assuming opencode is installed and available."""

    def test_opencode_cli_available(self):
        """Test that opencode command is available and responsive."""
        try:
            result = subprocess.run(
                ["opencode", "--help"],
                capture_output=True,
                text=True,
                timeout=10
            )
            assert result.returncode == 0
            assert "opencode" in result.stdout.lower() or "usage" in result.stdout.lower()
        except FileNotFoundError:
            pytest.skip("opencode not available in PATH")
        except subprocess.TimeoutExpired:
            pytest.fail("opencode --help timed out")

    def test_agent_list_integration(self):
        """Test OpenCodeAgentCLI.list_agents() with real opencode."""
        cli = OpenCodeAgentCLI()
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
        """Test OpenCodeAgentCLI.list_sessions() with real opencode."""
        cli = OpenCodeAgentCLI()
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
                "command not found",
                "error",
                "permission denied"
            ])

    def test_export_session_integration(self):
        """Test OpenCodeAgentCLI.export_session() with real conversation data."""
        cli = OpenCodeAgentCLI()
        
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

    def test_run_agent_integration(self):
        """Test OpenCodeAgentCLI.run_agent() with real opencode."""
        cli = OpenCodeAgentCLI()
        
        # Test with a simple message
        result = cli.run_agent("Hello, can you respond with 'test successful'?", None, None, Path.cwd())
        
        assert isinstance(result, RunResult)
        
        if result.success:
            # Should have response parts
            assert isinstance(result.response_parts, list)
            # Should have combined response
            assert isinstance(result.combined_response, str)
            assert len(result.combined_response) > 0
            
            # Verify response part structure if any parts exist
            for part in result.response_parts:
                assert hasattr(part, 'text')
                assert hasattr(part, 'part_type')
                assert hasattr(part, 'timestamp')
                assert part.part_type in ['thinking', 'tool', 'final']
        else:
            # If it fails, should have a meaningful error message
            assert result.error_message is not None
            assert len(result.error_message) > 0

    def test_interface_spec_compliance(self):
        """Test that all OpenCodeAgentCLI methods return correct typed results per interface spec."""
        cli = OpenCodeAgentCLI()
        
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

    def test_json_output_parsing(self):
        """Test that OpenCode JSON output is parsed correctly."""
        cli = OpenCodeAgentCLI()
        
        # Test with a simple message that should produce JSON output
        result = cli.run_agent("Say hello", None, None, Path.cwd())
        
        assert isinstance(result, RunResult)
        
        if result.success:
            # Should have parsed response parts from JSON
            assert isinstance(result.response_parts, list)
            
            # If we have response parts, they should have proper structure
            for part in result.response_parts:
                assert hasattr(part, 'text')
                assert hasattr(part, 'part_type')
                assert isinstance(part.text, str)
                assert part.part_type in ['thinking', 'tool', 'final']
                
                # Should be able to convert to frontend format
                frontend_format = part.to_frontend_format()
                assert isinstance(frontend_format, dict)
                assert 'text' in frontend_format
                assert 'type' in frontend_format

    def test_session_persistence(self):
        """Test that sessions are properly managed across multiple calls."""
        cli = OpenCodeAgentCLI()
        
        # First message without session ID
        result1 = cli.run_agent("Start a conversation", None, None, Path.cwd())
        
        if not result1.success:
            pytest.skip("OpenCode not available or not working")
        
        # Should get a session ID back
        session_id = result1.session_id
        
        if session_id:
            # Second message with the session ID
            result2 = cli.run_agent("Continue the conversation", session_id, None, Path.cwd())
            
            if result2.success:
                # Should maintain the same session
                assert result2.session_id == session_id or result2.session_id is None

    def test_agent_parameter_handling(self):
        """Test that agent parameter is handled correctly."""
        cli = OpenCodeAgentCLI()
        
        # Test with specific agent if available
        agents_result = cli.list_agents()
        
        if agents_result.success and agents_result.agents:
            # Use the first available agent
            agent_name = agents_result.agents[0].name
            
            result = cli.run_agent("Hello", None, agent_name, Path.cwd())
            
            assert isinstance(result, RunResult)
            # Should either succeed or fail gracefully
            if not result.success:
                assert result.error_message is not None
                assert len(result.error_message) > 0

    def test_error_handling_graceful_degradation(self):
        """Test that error handling provides graceful degradation."""
        cli = OpenCodeAgentCLI()
        
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

    def test_cli_name_property(self):
        """Test that CLI name property is correct."""
        cli = OpenCodeAgentCLI()
        assert cli.cli_name == "opencode"

    def test_missing_command_error(self):
        """Test that missing command error message is appropriate."""
        cli = OpenCodeAgentCLI()
        error_msg = cli.missing_command_error()
        assert "opencode" in error_msg
        assert "command not found" in error_msg
        assert "PATH" in error_msg
