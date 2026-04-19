"""Unit tests for ClaudeCodeAgentCLI implementation."""

import json
import tempfile
import unittest.mock
from pathlib import Path
from threading import Event

from claude_agent_cli import ClaudeCodeAgentCLI
from agent_results import (
    AgentListResult,
    ExportResult,
    RunResult,
    SessionListResult,
    ResponsePart,
    HistoryMessage,
    SessionInfo,
    AgentInfo,
)


class TestClaudeCodeAgentCLI:
    """Test cases for ClaudeCodeAgentCLI."""

    def test_cli_name(self):
        """Test that cli_name property returns correct value."""
        cli = ClaudeCodeAgentCLI()
        assert cli.cli_name == "claude"

    def test_main_executable_name(self):
        """Test main_executable_name returns correct value."""
        assert ClaudeCodeAgentCLI.main_executable_name() == "claude"

    def test_prompt_via_stdin(self):
        """Test that prompt_via_stdin returns False for positional argument mode."""
        cli = ClaudeCodeAgentCLI()
        assert cli.prompt_via_stdin() is False

    def test_build_prompt_command(self):
        """Test build_prompt_command creates correct command structure."""
        cli = ClaudeCodeAgentCLI()
        prompt = "Hello, world!"
        
        cmd = cli.build_prompt_command(prompt)
        expected = [
            "claude",
            "--print",
            "--output-format", "json",
            "--permission-mode", "bypassPermissions",
            prompt,
        ]
        assert cmd == expected

    def test_missing_command_error(self):
        """Test missing_command_error returns correct error message."""
        cli = ClaudeCodeAgentCLI()
        error_msg = cli.missing_command_error()
        assert "claude" in error_msg
        assert "command not found" in error_msg
        assert "Please ensure it is installed and in PATH" in error_msg

    def test_build_run_command_basic(self):
        """Test _build_run_command with basic parameters."""
        cli = ClaudeCodeAgentCLI()
        message = "Test message"
        
        cmd = cli._build_run_command(message, None, None, None)
        expected = [
            "claude",
            "--print",
            "--output-format", "json",
            "--permission-mode", "bypassPermissions",
            message,
        ]
        assert cmd == expected

    def test_build_run_command_with_session(self):
        """Test _build_run_command with session ID."""
        cli = ClaudeCodeAgentCLI()
        message = "Test message"
        session_id = "test-session-123"
        
        cmd = cli._build_run_command(message, session_id, None, None)
        assert "--resume" in cmd
        assert session_id in cmd

    def test_build_run_command_with_model(self):
        """Test _build_run_command with model specification."""
        cli = ClaudeCodeAgentCLI()
        message = "Test message"
        model = "sonnet"
        
        cmd = cli._build_run_command(message, None, None, model)
        assert "--model" in cmd
        assert model in cmd

    def test_build_run_command_with_agent(self):
        """Test _build_run_command with agent specification."""
        cli = ClaudeCodeAgentCLI()
        message = "Test message"
        agent = "custom-agent"
        
        cmd = cli._build_run_command(message, None, agent, None)
        assert "--agent" in cmd
        assert agent in cmd

    def test_build_run_command_with_cwd(self):
        """Test _build_run_command with cwd for tool scoping."""
        cli = ClaudeCodeAgentCLI()
        message = "Test message"
        cwd = Path("/test/workspace")
        
        cmd = cli._build_run_command(message, None, None, None, cwd)
        assert "--allowedTools" in cmd
        # Find the allowedTools argument
        allowed_tools_idx = cmd.index("--allowedTools")
        allowed_tools_value = cmd[allowed_tools_idx + 1]
        assert f"Bash(* {cwd}/*)" in allowed_tools_value

    def test_parse_claude_json_output_success(self):
        """Test _parse_claude_json_output with successful response."""
        cli = ClaudeCodeAgentCLI()
        
        json_output = json.dumps({
            "type": "result",
            "subtype": "success", 
            "session_id": "test-session-123",
            "result": "Hello! How can I help you?",
            "cost_usd": 0.001,
            "duration_ms": 1234,
            "num_turns": 1
        })
        
        result = cli._parse_claude_json_output(json_output, None)
        
        assert result.success is True
        assert result.session_id == "test-session-123"
        assert len(result.response_parts) == 1
        assert result.response_parts[0].text == "Hello! How can I help you?"
        assert result.response_parts[0].part_type == "final"

    def test_parse_claude_json_output_error(self):
        """Test _parse_claude_json_output with error response."""
        cli = ClaudeCodeAgentCLI()
        
        json_output = json.dumps({
            "type": "result",
            "subtype": "error_max_turns",
            "session_id": "test-session-123",
            "result": "Maximum turns exceeded",
            "is_error": True
        })
        
        result = cli._parse_claude_json_output(json_output, None)
        
        assert result.success is False
        assert result.session_id == "test-session-123"
        assert result.error_message == "Maximum turns exceeded"

    def test_parse_claude_json_output_invalid_json(self):
        """Test _parse_claude_json_output with invalid JSON falls back to text."""
        cli = ClaudeCodeAgentCLI()
        
        plain_text = "This is plain text response"
        
        result = cli._parse_claude_json_output(plain_text, "session-123")
        
        assert result.success is True
        assert result.session_id == "session-123"
        assert len(result.response_parts) == 1
        assert result.response_parts[0].text == plain_text

    def test_parse_claude_json_output_empty(self):
        """Test _parse_claude_json_output with empty output."""
        cli = ClaudeCodeAgentCLI()
        
        result = cli._parse_claude_json_output("", "session-123")
        
        assert result.success is False
        assert result.error_message == "No output from Claude Code"

    @unittest.mock.patch('subprocess.run')
    def test_list_agents_success(self, mock_run):
        """Test list_agents with successful command execution."""
        cli = ClaudeCodeAgentCLI()
        
        mock_output = """4 active agents

Built-in agents:
  Explore · haiku
  general-purpose · inherit
  Plan · inherit
  statusline-setup · sonnet

Project agents:
  my-agent · sonnet
"""
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = mock_output
        
        result = cli.list_agents()
        
        assert result.success is True
        assert len(result.agents) == 5
        
        # Check built-in agents
        explore_agent = next((a for a in result.agents if a.name == "Explore"), None)
        assert explore_agent is not None
        assert explore_agent.agent_type == "built-in"
        assert "model: haiku" in explore_agent.details
        
        # Check project agents
        my_agent = next((a for a in result.agents if a.name == "my-agent"), None)
        assert my_agent is not None
        assert my_agent.agent_type == "project"
        assert "model: sonnet" in my_agent.details

    @unittest.mock.patch('subprocess.run')
    def test_list_agents_command_not_found(self, mock_run):
        """Test list_agents when claude command is not found."""
        cli = ClaudeCodeAgentCLI()
        
        mock_run.side_effect = FileNotFoundError("Command not found")
        
        result = cli.list_agents()
        
        assert result.success is False
        assert "claude" in result.error_message
        assert "command not found" in result.error_message

    def test_iso_to_ms_conversion(self):
        """Test _iso_to_ms helper function."""
        from claude_agent_cli import _iso_to_ms
        
        # Test ISO string
        iso_string = "2023-12-01T10:30:00Z"
        result = _iso_to_ms(iso_string)
        assert isinstance(result, int)
        assert result > 0
        
        # Test numeric timestamp
        numeric_ts = 1701428400.5
        result = _iso_to_ms(numeric_ts)
        assert result == int(numeric_ts)
        
        # Test None
        result = _iso_to_ms(None)
        assert result is None
        
        # Test invalid string
        result = _iso_to_ms("invalid-date")
        assert result is None

    def test_encode_cwd(self):
        """Test _encode_cwd helper function."""
        from claude_agent_cli import _encode_cwd
        
        cwd = Path("/home/user/my-project")
        encoded = _encode_cwd(cwd)
        
        assert encoded == "-home-user-my-project"

    def test_extract_session_summary(self):
        """Test _extract_session_summary helper function."""
        from claude_agent_cli import _extract_session_summary
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            # Write sample JSONL content
            f.write(json.dumps({
                "uuid": "msg-1",
                "type": "user",
                "message": {"content": "Hello, how are you?"},
                "timestamp": "2023-12-01T10:30:00Z"
            }) + "\n")
            f.write(json.dumps({
                "uuid": "msg-2", 
                "type": "assistant",
                "message": {"content": "I'm doing well, thank you!"},
                "timestamp": "2023-12-01T10:30:05Z"
            }) + "\n")
            
            session_file = Path(f.name)
        
        try:
            title, updated = _extract_session_summary(session_file)
            
            assert title == "Hello, how are you?"
            assert len(updated) > 10  # Should contain date string like "2026-04-19 20:36"
        finally:
            session_file.unlink()

    def test_parse_agents_output(self):
        """Test _parse_agents_output helper function."""
        from claude_agent_cli import _parse_agents_output
        
        output = """4 active agents

Built-in agents:
  Explore · haiku
  general-purpose · inherit

Project agents:
  my-agent · sonnet
"""
        
        agents = _parse_agents_output(output)
        
        assert len(agents) == 3
        
        # Check agent parsing
        explore_agent = next((a for a in agents if a.name == "Explore"), None)
        assert explore_agent is not None
        assert explore_agent.agent_type == "built-in"
        
        my_agent = next((a for a in agents if a.name == "my-agent"), None)
        assert my_agent is not None
        assert my_agent.agent_type == "project"

    @unittest.mock.patch('subprocess.Popen')
    def test_run_agent_file_not_found(self, mock_popen):
        """Test run_agent when claude command is not found."""
        cli = ClaudeCodeAgentCLI()
        
        mock_popen.side_effect = FileNotFoundError("Command not found")
        
        result = cli.run_agent("test message", None, None, None, Path("/test"))
        
        assert result.success is False
        assert "claude" in result.error_message
        assert "command not found" in result.error_message

    @unittest.mock.patch('subprocess.Popen')
    def test_run_agent_cancellation(self, mock_popen):
        """Test run_agent with cancellation event."""
        cli = ClaudeCodeAgentCLI()
        cancel_event = Event()
        cancel_event.set()  # Pre-cancelled
        
        result = cli.run_agent("test message", None, None, None, Path("/test"), cancel_event)
        
        assert result.success is False
        assert "cancelled" in result.error_message.lower()

    def test_find_session_file_not_found(self):
        """Test _find_session_file when session doesn't exist."""
        cli = ClaudeCodeAgentCLI()
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Mock CLAUDE_SESSIONS_BASE to point to our temp directory
            original_base = cli.__class__.__module__ + ".CLAUDE_SESSIONS_BASE"
            with unittest.mock.patch(original_base, Path(temp_dir)):
                result = cli._find_session_file("nonexistent-session", None)
                assert result is None

    def test_parse_session_jsonl(self):
        """Test _parse_session_jsonl with sample JSONL data."""
        cli = ClaudeCodeAgentCLI()
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.jsonl', delete=False) as f:
            # Write sample JSONL content with different message types
            f.write(json.dumps({
                "uuid": "msg-1",
                "type": "user",
                "message": {"content": "Hello"},
                "timestamp": "2023-12-01T10:30:00Z"
            }) + "\n")
            f.write(json.dumps({
                "uuid": "msg-2",
                "type": "assistant", 
                "message": {"content": [
                    {"type": "text", "text": "Hi there!"},
                    {
                        "type": "tool_use",
                        "id": "tool-1",
                        "name": "read_file", 
                        "input": {"path": "test.py"}
                    }
                ]},
                "timestamp": "2023-12-01T10:30:05Z"
            }) + "\n")
            
            session_file = Path(f.name)
        
        try:
            messages = cli._parse_session_jsonl(session_file)
            
            assert len(messages) == 3  # user + assistant text + tool_use
            
            # Check user message
            user_msg = messages[0]
            assert user_msg.role == "user"
            assert user_msg.content == "Hello"
            assert user_msg.content_type == "text"
            
            # Check assistant text
            assistant_text = messages[1]
            assert assistant_text.role == "assistant"
            assert assistant_text.content == "Hi there!"
            assert assistant_text.content_type == "text"
            
            # Check tool use
            tool_msg = messages[2]
            assert tool_msg.role == "assistant"
            assert tool_msg.content_type == "tool_use"
            assert "read_file" in tool_msg.content
            
        finally:
            session_file.unlink()

    def test_export_session_file_not_found(self):
        """Test export_session when session file doesn't exist."""
        cli = ClaudeCodeAgentCLI()
        
        with tempfile.TemporaryDirectory() as temp_dir:
            # Mock CLAUDE_SESSIONS_BASE to point to our temp directory
            original_base = cli.__class__.__module__ + ".CLAUDE_SESSIONS_BASE"
            with unittest.mock.patch(original_base, Path(temp_dir)):
                result = cli.export_session("nonexistent-session", None)
                
                assert result.success is False
                assert "Session file not found" in result.error_message

    def test_list_sessions_no_sessions_dir(self):
        """Test list_sessions when sessions directory doesn't exist."""
        cli = ClaudeCodeAgentCLI()
        
        with tempfile.TemporaryDirectory() as temp_dir:
            nonexistent_dir = Path(temp_dir) / "nonexistent"
            original_base = cli.__class__.__module__ + ".CLAUDE_SESSIONS_BASE"
            with unittest.mock.patch(original_base, nonexistent_dir):
                result = cli.list_sessions(None)
                
                assert result.success is False
                assert "Claude projects directory not found" in result.error_message