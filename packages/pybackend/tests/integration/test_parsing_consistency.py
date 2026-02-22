"""Integration tests to ensure parsing consistency and prevent regressions."""

import pytest
from pathlib import Path

from agent_cli import OpenCodeAgentCLI
from agent_results import RunResult, SessionListResult, AgentListResult, ExportResult


@pytest.mark.integration
class TestParsingConsistency:
    """Test parsing consistency across all CLI operations."""

    def test_all_parsing_functions_exist(self):
        """Ensure all required parsing functions exist and are callable."""
        cli = OpenCodeAgentCLI()

        # Test that all parsing methods exist
        assert hasattr(cli, "_parse_opencode_output")
        assert hasattr(cli, "_parse_session_table")
        assert hasattr(cli, "_parse_agent_list")
        assert hasattr(cli, "_parse_export_messages")
        assert hasattr(cli, "_extract_part_content")
        assert hasattr(cli, "_resolve_message_timestamp")
        assert hasattr(cli, "_resolve_part_timestamp")
        assert hasattr(cli, "_to_milliseconds")

        # Test that they're callable
        assert callable(cli._parse_opencode_output)
        assert callable(cli._parse_session_table)
        assert callable(cli._parse_agent_list)
        assert callable(cli._parse_export_messages)

    def test_run_agent_parsing_integration(self):
        """Test that run_agent properly uses _parse_opencode_output."""
        cli = OpenCodeAgentCLI()

        try:
            result = cli.run_agent("Say hello", None, None, None, Path.cwd())

            # Should return RunResult
            assert isinstance(result, RunResult)

            if result.success:
                # Should have parsed response parts
                assert isinstance(result.response_parts, list)

                # Each part should be properly typed
                for part in result.response_parts:
                    assert hasattr(part, "text")
                    assert hasattr(part, "part_type")
                    assert hasattr(part, "timestamp")
                    assert part.part_type in ["thinking", "tool", "final"]

        except FileNotFoundError:
            pytest.skip("OpenCode CLI not available")

    def test_list_sessions_parsing_integration(self):
        """Test that list_sessions properly uses _parse_session_table."""
        cli = OpenCodeAgentCLI()

        try:
            result = cli.list_sessions(Path.cwd())

            # Should return SessionListResult
            assert isinstance(result, SessionListResult)

            if result.success:
                # Should have parsed sessions
                assert isinstance(result.sessions, list)

                # Each session should be properly typed
                for session in result.sessions:
                    assert hasattr(session, "session_id")
                    assert hasattr(session, "title")
                    assert hasattr(session, "updated")
                    assert isinstance(session.session_id, str)
                    assert len(session.session_id) > 0

        except FileNotFoundError:
            pytest.skip("OpenCode CLI not available")

    def test_list_agents_parsing_integration(self):
        """Test that list_agents properly uses _parse_agent_list."""
        cli = OpenCodeAgentCLI()

        try:
            result = cli.list_agents()

            # Should return AgentListResult
            assert isinstance(result, AgentListResult)

            if result.success:
                # Should have parsed agents
                assert isinstance(result.agents, list)

                # Each agent should be properly typed
                for agent in result.agents:
                    assert hasattr(agent, "name")
                    assert hasattr(agent, "agent_type")
                    assert hasattr(agent, "details")
                    assert isinstance(agent.name, str)
                    assert len(agent.name) > 0

        except FileNotFoundError:
            pytest.skip("OpenCode CLI not available")

    def test_export_session_parsing_integration(self):
        """Test that export_session properly uses _parse_export_messages."""
        cli = OpenCodeAgentCLI()

        try:
            # First get a session to export
            sessions_result = cli.list_sessions(Path.cwd())

            if not sessions_result.success or not sessions_result.sessions:
                pytest.skip("No sessions available for export test")

            session_id = sessions_result.sessions[0].session_id
            result = cli.export_session(session_id, Path.cwd())

            # Should return ExportResult
            assert isinstance(result, ExportResult)

            if result.success:
                # Should have parsed messages
                assert isinstance(result.messages, list)

                # Each message should be properly typed
                for message in result.messages:
                    assert hasattr(message, "role")
                    assert hasattr(message, "content_type")
                    assert hasattr(message, "content")
                    assert message.role in ["user", "assistant"]
                    assert message.content_type in ["text", "tool", "tool_use"]

        except FileNotFoundError:
            pytest.skip("OpenCode CLI not available")

    def test_parsing_error_handling(self):
        """Test that parsing functions handle malformed input gracefully."""
        cli = OpenCodeAgentCLI()

        # Test _parse_opencode_output with malformed JSON
        session_id, parts = cli._parse_opencode_output("invalid json\n{malformed")
        assert session_id is None
        assert parts == []

        # Test _parse_session_table with empty input
        sessions = cli._parse_session_table("", 10)
        assert sessions == []

        # Test _parse_agent_list with empty input
        agents = cli._parse_agent_list("")
        assert agents == []

        # Test _parse_export_messages with empty input
        messages = cli._parse_export_messages([], None)
        assert messages == []

    def test_parsing_consistency_with_real_data(self):
        """Test parsing consistency when CLI is available."""
        cli = OpenCodeAgentCLI()

        try:
            # Test that all operations return consistent types
            agents_result = cli.list_agents()
            sessions_result = cli.list_sessions(Path.cwd())

            # Both should succeed or fail consistently
            if agents_result.success:
                assert isinstance(agents_result.agents, list)

            if sessions_result.success:
                assert isinstance(sessions_result.sessions, list)

                # If we have sessions, test export
                if sessions_result.sessions:
                    export_result = cli.export_session(
                        sessions_result.sessions[0].session_id, Path.cwd()
                    )

                    if export_result.success:
                        assert isinstance(export_result.messages, list)

        except FileNotFoundError:
            pytest.skip("OpenCode CLI not available for consistency test")

    def test_reasoning_content_parsing_consistency(self):
        """Test that reasoning content is consistently parsed in live and export modes.

        This test specifically addresses the issue where live chat shows empty [agent:final]
        messages while export_session shows them correctly filled due to missing reasoning
        content extraction in live parsing.
        """
        from opencode_database_agent_cli import OpenCodeDatabaseAgentCLI

        cli = OpenCodeDatabaseAgentCLI()

        # Test live parsing with reasoning content
        live_output = """{"sessionID": "test_session"}
{"type": "reasoning", "timestamp": 1640995100000, "part": {"type": "reasoning", "text": "Let me analyze this step by step"}}
{"type": "text", "timestamp": 1640995200000, "part": {"type": "text", "text": "Based on my analysis, the answer is 42"}}"""

        session_id, response_parts = cli._parse_opencode_output(live_output)

        # Verify that reasoning content is properly extracted
        assert session_id == "test_session"
        assert len(response_parts) == 2

        # First part should be reasoning (mapped to thinking)
        reasoning_part = response_parts[0]
        assert reasoning_part.text == "Let me analyze this step by step"
        assert reasoning_part.part_type == "thinking"

        # Second part should be final text
        final_part = response_parts[1]
        assert final_part.text == "Based on my analysis, the answer is 42"
        assert final_part.part_type == "final"

        # Test content extraction directly
        reasoning_content = cli._extract_part_content(
            {"type": "reasoning", "text": "reasoning content"}, "reasoning"
        )
        assert reasoning_content == "reasoning content"

        # Test fallback content extraction
        fallback_content = cli._extract_part_content(
            {"content": "fallback content"}, "unknown_type"
        )
        assert fallback_content == "fallback content"
