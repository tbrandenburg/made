"""Unit tests for KiroAgentCLI implementation."""

import json
import sqlite3
import tempfile
import unittest.mock
from pathlib import Path

import pytest

from kiro_agent_cli import KiroAgentCLI
from agent_results import (
    AgentInfo,
    AgentListResult,
    ExportResult,
    HistoryMessage,
    ResponsePart,
    RunResult,
    SessionInfo,
    SessionListResult,
)


class TestKiroAgentCLI:
    """Test cases for KiroAgentCLI."""

    def test_cli_name(self):
        """Test that cli_name property returns correct value."""
        cli = KiroAgentCLI()
        assert cli.cli_name == "kiro-cli"

    def test_missing_command_error(self):
        """Test missing_command_error returns correct error message."""
        cli = KiroAgentCLI()
        error_msg = cli.missing_command_error()
        assert "kiro-cli" in error_msg
        assert "command not found" in error_msg
        assert "Please ensure it is installed and in PATH" in error_msg

    @unittest.mock.patch('subprocess.run')
    def test_run_agent_success(self, mock_run):
        """Test run_agent with successful subprocess execution."""
        # Mock successful kiro-cli response
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "Test response from kiro-cli"
        mock_run.return_value.stderr = ""
        
        cli = KiroAgentCLI()
        result = cli.run_agent("test message", None, None, Path("."))
        
        assert isinstance(result, RunResult)
        assert result.success is True
        assert len(result.response_parts) == 1
        assert result.response_parts[0].text == "Test response from kiro-cli"
        assert result.response_parts[0].part_type == "final"
        
        # Verify subprocess was called correctly
        mock_run.assert_called_once()
        call_args = mock_run.call_args
        assert call_args[0][0] == ["kiro-cli", "chat", "--no-interactive", "--trust-all-tools"]

    @unittest.mock.patch('subprocess.run')
    def test_run_agent_command_not_found(self, mock_run):
        """Test run_agent with FileNotFoundError from subprocess."""
        mock_run.side_effect = FileNotFoundError("kiro-cli not found")
        
        cli = KiroAgentCLI()
        result = cli.run_agent("test message", None, None, Path("."))
        
        assert isinstance(result, RunResult)
        assert result.success is False
        assert "kiro-cli" in result.error_message
        assert "command not found" in result.error_message

    def test_list_sessions_no_database(self):
        """Test list_sessions when database doesn't exist."""
        with unittest.mock.patch.object(KiroAgentCLI, '_get_database_path', return_value=None):
            cli = KiroAgentCLI()
            result = cli.list_sessions(Path("."))
            
            assert isinstance(result, SessionListResult)
            assert result.success is False
            assert "database not found" in result.error_message.lower()

    def test_list_sessions_with_database(self):
        """Test list_sessions with mocked SQLite database."""
        # Create temporary database with test data
        with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp_db:
            db_path = Path(tmp_db.name)
            
            # Set up test database
            with sqlite3.connect(db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    CREATE TABLE conversations_v2 (
                        key TEXT NOT NULL,
                        conversation_id TEXT NOT NULL,
                        value TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (key, conversation_id)
                    )
                """)
                
                # Insert test conversation
                test_conversation = {
                    "conversation_id": "test-conv-123",
                    "history": [{
                        "user": {
                            "content": {"Prompt": {"prompt": "Test message"}},
                            "timestamp": "2026-01-13T10:00:00Z"
                        },
                        "assistant": {
                            "Response": {"message_id": "msg-123", "content": "Test response"}
                        }
                    }]
                }
                
                cursor.execute(
                    "INSERT INTO conversations_v2 (key, conversation_id, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    ("/test/path", "test-conv-123", json.dumps(test_conversation), 1736766000000, 1736766000000)
                )
                conn.commit()
            
            # Mock database path to return our test database
            with unittest.mock.patch.object(KiroAgentCLI, '_get_database_path', return_value=db_path):
                cli = KiroAgentCLI()
                result = cli.list_sessions(Path("/test/path"))
                
                assert isinstance(result, SessionListResult)
                assert result.success is True
                assert len(result.sessions) == 1
                
                session = result.sessions[0]
                assert session.session_id == "test-conv-123"
                assert "Test message" in session.title
            
            # Clean up
            db_path.unlink()

    @unittest.mock.patch('subprocess.run')
    def test_list_agents_success(self, mock_run):
        """Test list_agents with mocked subprocess output."""
        # Mock kiro-cli agent list output
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = """* default    (Built-in)
custom-agent    /path/to/custom/agent
another-agent    /another/path"""
        mock_run.return_value.stderr = ""
        
        cli = KiroAgentCLI()
        result = cli.list_agents()
        
        assert isinstance(result, AgentListResult)
        assert result.success is True
        assert len(result.agents) == 3
        
        # Check first agent (built-in)
        agent1 = result.agents[0]
        assert agent1.name == "default"
        assert agent1.agent_type == "Built-in"
        
        # Check second agent (custom)
        agent2 = result.agents[1]
        assert agent2.name == "custom-agent"
        assert agent2.agent_type == "Custom"
        assert "/path/to/custom/agent" in agent2.details

    @unittest.mock.patch('subprocess.run')
    def test_list_agents_command_not_found(self, mock_run):
        """Test list_agents with FileNotFoundError."""
        mock_run.side_effect = FileNotFoundError("kiro-cli not found")
        
        cli = KiroAgentCLI()
        result = cli.list_agents()
        
        assert isinstance(result, AgentListResult)
        assert result.success is False
        assert "kiro-cli" in result.error_message
        assert "command not found" in result.error_message

    def test_export_session_no_database(self):
        """Test export_session when database doesn't exist."""
        with unittest.mock.patch.object(KiroAgentCLI, '_get_database_path', return_value=None):
            cli = KiroAgentCLI()
            result = cli.export_session("test-session", Path("."))
            
            assert isinstance(result, ExportResult)
            assert result.success is False
            assert "database not found" in result.error_message.lower()

    def test_export_session_session_not_found(self):
        """Test export_session when session doesn't exist in database."""
        # Create temporary empty database
        with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as tmp_db:
            db_path = Path(tmp_db.name)
            
            with sqlite3.connect(db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    CREATE TABLE conversations_v2 (
                        key TEXT NOT NULL,
                        conversation_id TEXT NOT NULL,
                        value TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (key, conversation_id)
                    )
                """)
                conn.commit()
            
            with unittest.mock.patch.object(KiroAgentCLI, '_get_database_path', return_value=db_path):
                cli = KiroAgentCLI()
                result = cli.export_session("nonexistent-session", Path("/test/path"))
                
                assert isinstance(result, ExportResult)
                assert result.success is False
                assert "not found" in result.error_message.lower()
            
            # Clean up
            db_path.unlink()

    def test_parse_conversation_history(self):
        """Test _parse_conversation_history method."""
        cli = KiroAgentCLI()
        
        conversation_data = {
            "conversation_id": "test-conv",
            "history": [{
                "user": {
                    "content": {"Prompt": {"prompt": "Hello"}},
                    "timestamp": "2026-01-13T10:00:00+01:00"
                },
                "assistant": {
                    "Response": {"message_id": "msg-123", "content": "Hi there!"}
                }
            }]
        }
        
        messages = cli._parse_conversation_history(conversation_data)
        
        assert len(messages) == 2
        
        # Check user message
        user_msg = messages[0]
        assert user_msg.role == "user"
        assert user_msg.content_type == "text"
        assert user_msg.content == "Hello"
        assert user_msg.timestamp is not None
        
        # Check assistant message
        assistant_msg = messages[1]
        assert assistant_msg.role == "assistant"
        assert assistant_msg.content_type == "text"
        assert assistant_msg.content == "Hi there!"
        assert assistant_msg.message_id == "msg-123"

    def test_parse_kiro_agent_list(self):
        """Test _parse_kiro_agent_list method."""
        cli = KiroAgentCLI()
        
        output = """* default    (Built-in)
custom-agent    /path/to/custom/agent
another-agent    /another/path
simple-agent"""
        
        agents = cli._parse_kiro_agent_list(output)
        
        assert len(agents) == 4
        
        # Built-in agent
        assert agents[0].name == "default"
        assert agents[0].agent_type == "Built-in"
        
        # Custom agents
        assert agents[1].name == "custom-agent"
        assert agents[1].agent_type == "Custom"
        assert "/path/to/custom/agent" in agents[1].details
        
        assert agents[2].name == "another-agent"
        assert agents[2].agent_type == "Custom"
        
        # Simple agent (no path)
        assert agents[3].name == "simple-agent"
        assert agents[3].agent_type == "Unknown"

    def test_get_directory_key(self):
        """Test _get_directory_key method."""
        cli = KiroAgentCLI()
        
        test_path = Path("/test/path")
        key = cli._get_directory_key(test_path)
        
        # Should return resolved absolute path as string
        assert isinstance(key, str)
        assert key == str(test_path.resolve())

    def test_to_milliseconds(self):
        """Test _to_milliseconds method."""
        cli = KiroAgentCLI()
        
        # Valid conversions
        assert cli._to_milliseconds(1000) == 1000
        assert cli._to_milliseconds("1000") == 1000
        assert cli._to_milliseconds(1000.5) == 1000
        
        # Invalid conversions
        assert cli._to_milliseconds(None) is None
        assert cli._to_milliseconds("invalid") is None
        assert cli._to_milliseconds([]) is None
