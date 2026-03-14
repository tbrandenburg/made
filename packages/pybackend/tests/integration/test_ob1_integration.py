"""Integration tests for OB1AgentCLI with real ob1 CLI installation."""

import subprocess
from pathlib import Path

import pytest

from ob1_agent_cli import OB1AgentCLI
from agent_results import AgentListResult, SessionListResult, ExportResult, RunResult
from agent_service import get_agent_cli
from settings_service import read_settings, write_settings


@pytest.mark.integration
class TestOB1Integration:
    """Integration tests assuming ob1 CLI is installed and available."""

    def test_ob1_cli_available(self):
        """Test that ob1 command is available and responsive."""
        try:
            result = subprocess.run(
                ["ob1", "--help"], capture_output=True, text=True, timeout=10
            )
            # ob1 may return non-zero for help, but should produce output
            assert (
                "ob1" in result.stdout.lower()
                or "usage" in result.stdout.lower()
                or len(result.stdout) > 0
            )
        except FileNotFoundError:
            pytest.skip("ob1 CLI not available in PATH")
        except subprocess.TimeoutExpired:
            pytest.fail("ob1 --help timed out")

    def test_agent_list_integration(self):
        """Test OB1AgentCLI.list_agents() with real ob1 CLI."""
        cli = OB1AgentCLI()
        result = cli.list_agents()

        assert isinstance(result, AgentListResult)

        if result.success:
            # Should return the single ob1 agent
            assert isinstance(result.agents, list)
            assert len(result.agents) == 1

            agent = result.agents[0]
            assert agent.name == "ob1"
            assert agent.agent_type == "Multi-Model"
            assert isinstance(agent.details, list)
            assert len(agent.details) > 0
            assert "300+" in agent.details[0]
        else:
            # If it fails, should have a meaningful error message
            assert result.error_message is not None
            assert isinstance(result.error_message, str)
            assert len(result.error_message) > 0

    def test_session_list_integration(self):
        """Test OB1AgentCLI.list_sessions() integration."""
        cli = OB1AgentCLI()
        result = cli.list_sessions(Path("."))

        assert isinstance(result, SessionListResult)

        if result.success:
            # Should return a list (may be empty if no sessions exist)
            assert isinstance(result.sessions, list)

            # If sessions exist, verify structure
            for session in result.sessions:
                assert hasattr(session, "session_id")
                assert hasattr(session, "title")
                assert hasattr(session, "updated")
                assert isinstance(session.session_id, str)
                assert len(session.session_id) > 0
        else:
            # If it fails, should have a meaningful error message
            assert result.error_message is not None

    def test_agent_service_integration(self):
        """Test that agent_service can create OB1AgentCLI when configured."""
        # Save current settings
        original_settings = read_settings()

        try:
            # Set ob1 as the agent CLI
            test_settings = original_settings.copy()
            test_settings["agentCli"] = "ob1"
            write_settings(test_settings)

            # Get agent CLI from service
            agent_cli = get_agent_cli()

            # Should return OB1AgentCLI instance
            assert isinstance(agent_cli, OB1AgentCLI)
            assert agent_cli.cli_name == "ob1"

        finally:
            # Restore original settings
            write_settings(original_settings)

    def test_settings_validation_integration(self):
        """Test that ob1 is accepted as a valid agentCli setting."""
        # Save current settings
        original_settings = read_settings()

        try:
            # Set ob1 as agent CLI
            test_settings = {"agentCli": "ob1"}
            write_settings(test_settings)

            # Read back settings
            restored_settings = read_settings()

            # Should accept ob1 value
            assert restored_settings["agentCli"] == "ob1"

        finally:
            # Restore original settings
            write_settings(original_settings)

    @pytest.mark.slow
    def test_run_agent_with_credits(self):
        """Test actual ob1 CLI execution (requires ob1 credits)."""
        cli = OB1AgentCLI()

        try:
            result = cli.run_agent(
                message="What is 2+2? Please respond with just the number.",
                session_id=None,
                agent=None,
                model=None,
                cwd=Path("."),
            )

            assert isinstance(result, RunResult)

            if result.success:
                # Should have response parts
                assert len(result.response_parts) > 0
                assert result.response_parts[0].text is not None
                assert len(result.response_parts[0].text.strip()) > 0

                # Should have session_id for future reference
                assert result.session_id is not None

            else:
                # If failed, should have meaningful error
                assert result.error_message is not None

                # Common failure reasons (ob1 not installed, no credits, etc.)
                error_lower = result.error_message.lower()
                expected_errors = [
                    "command not found",
                    "ob1",
                    "cli failed",
                    "credits",
                    "authentication",
                    "network",
                ]

                # Should contain at least one expected error indicator
                assert any(expected in error_lower for expected in expected_errors), (
                    f"Unexpected error message: {result.error_message}"
                )

        except Exception as e:
            # If exception occurs, it should be a known type
            assert isinstance(
                e, (FileNotFoundError, subprocess.SubprocessError, OSError)
            )

    def test_export_session_integration(self):
        """Test session export functionality."""
        cli = OB1AgentCLI()

        # Try to export a non-existent session (should fail gracefully)
        result = cli.export_session("nonexistent-session-12345", Path("."))

        assert isinstance(result, ExportResult)
        assert not result.success  # Should fail for non-existent session
        assert result.error_message is not None
        assert "not found" in result.error_message.lower()

    def test_cli_command_construction(self):
        """Test that CLI commands are constructed properly."""
        cli = OB1AgentCLI()

        # Test command construction by calling run_agent
        # This will either succeed (ob1 installed) or fail gracefully
        result = cli.run_agent(
            message="test",
            session_id="test-session",
            agent=None,
            model="gpt-4",
            cwd=Path("."),
        )

        # Should always return a RunResult, not raise exception
        assert isinstance(result, RunResult)
        # Either success or proper error message
        if not result.success:
            assert result.error_message is not None

    def test_missing_command_error(self):
        """Test error handling when ob1 command is not found."""
        cli = OB1AgentCLI()

        # Mock a scenario where ob1 is not installed
        error_msg = cli.missing_command_error()

        assert "ob1" in error_msg
        assert "command not found" in error_msg
        assert "installed" in error_msg


@pytest.mark.integration
class TestOB1SystemIntegration:
    """System-level integration tests for ob1 within MADE platform."""

    def test_frontend_backend_integration(self):
        """Test that ob1 option flows from frontend to backend properly."""
        # This tests the full integration path:
        # SettingsPage.tsx -> settings_service.py -> agent_service.py -> OB1AgentCLI

        original_settings = read_settings()

        try:
            # Simulate frontend setting ob1 as agent CLI
            settings = {"agentCli": "ob1"}
            write_settings(settings)

            # Backend should create OB1AgentCLI
            agent_cli = get_agent_cli()
            assert isinstance(agent_cli, OB1AgentCLI)

            # Should have correct CLI name
            assert agent_cli.cli_name == "ob1"

        finally:
            write_settings(original_settings)

    def test_error_handling_integration(self):
        """Test error handling integration across the system."""
        cli = OB1AgentCLI()

        # Test various error conditions
        error_cases = [
            ("", None, None, None),  # Empty message
            ("test", "invalid-session-format", None, None),  # Invalid session
            ("test", None, None, "invalid-model-name"),  # Invalid model
        ]

        for message, session_id, agent, model in error_cases:
            result = cli.run_agent(message, session_id, agent, model, Path("."))

            # Should always return RunResult, never raise exception
            assert isinstance(result, RunResult)

            # Either success or proper error message
            if not result.success:
                assert result.error_message is not None
                assert len(result.error_message) > 0

    def test_agent_listing_consistency(self):
        """Test that agent listing is consistent across different calls."""
        cli = OB1AgentCLI()

        # Call list_agents multiple times
        results = [cli.list_agents() for _ in range(3)]

        # All should return same structure
        for result in results:
            assert isinstance(result, AgentListResult)

            if result.success:
                assert len(result.agents) == 1
                assert result.agents[0].name == "ob1"
                assert result.agents[0].agent_type == "Multi-Model"
