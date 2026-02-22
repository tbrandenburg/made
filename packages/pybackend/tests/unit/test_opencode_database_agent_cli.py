"""Unit tests for OpenCodeDatabaseAgentCLI."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

from opencode_database_agent_cli import OpenCodeDatabaseAgentCLI
from agent_results import (
    SessionListResult,
    ExportResult,
    AgentListResult,
    RunResult,
    AgentInfo,
    ResponsePart,
)


class TestOpenCodeDatabaseAgentCLI(unittest.TestCase):
    """Test cases for OpenCodeDatabaseAgentCLI."""

    def setUp(self):
        """Set up test fixtures."""
        self.cli = OpenCodeDatabaseAgentCLI()

    def test_cli_name(self):
        """Test that cli_name returns the correct identifier."""
        self.assertEqual(self.cli.cli_name, "opencode")

    @patch("opencode_database_agent_cli.Path.home")
    def test_get_database_path_default_location(self, mock_home):
        """Test database path resolution with default location."""
        mock_home_path = Mock()
        mock_home.return_value = mock_home_path

        mock_db_path = Mock()
        mock_db_path.exists.return_value = True
        # Set up the mock to handle Path / operator
        mock_home_path.__truediv__ = Mock(return_value=mock_db_path)

        result = self.cli._get_database_path()

        mock_home_path.__truediv__.assert_called_with(
            ".local/share/opencode/opencode.db"
        )
        self.assertEqual(result, mock_db_path)

    @patch.dict("os.environ", {"OPENCODE_DATABASE_PATH": "/custom/path/opencode.db"})
    @patch("opencode_database_agent_cli.Path")
    def test_get_database_path_environment_variable(self, mock_path_class):
        """Test database path resolution with environment variable."""
        mock_path = Mock()
        mock_path.exists.return_value = True
        mock_path.expanduser.return_value = mock_path
        mock_path_class.return_value = mock_path

        result = self.cli._get_database_path()

        mock_path_class.assert_called_with("/custom/path/opencode.db")
        self.assertEqual(result, mock_path)

    @patch("opencode_database_agent_cli.Path.home")
    def test_get_database_path_not_found(self, mock_home):
        """Test database path resolution when database doesn't exist."""
        mock_home_path = Mock()
        mock_home.return_value = mock_home_path

        mock_db_path = Mock()
        mock_db_path.exists.return_value = False
        # Set up the mock to handle Path / operator
        mock_home_path.__truediv__ = Mock(return_value=mock_db_path)

        result = self.cli._get_database_path()

        self.assertIsNone(result)

    def test_get_directory_key(self):
        """Test directory key generation."""
        test_path = Path("/test/directory")
        # Just test the actual function since mocking resolve is complex
        result = self.cli._get_directory_key(test_path)
        # Should return a string representation of the resolved path
        self.assertIsInstance(result, str)

    def test_list_sessions_database_not_found(self):
        """Test list_sessions when database doesn't exist."""
        with patch.object(self.cli, "_get_database_path", return_value=None):
            result = self.cli.list_sessions(Path("/test"))

        self.assertFalse(result.success)
        self.assertEqual(len(result.sessions), 0)
        self.assertIn("database not found", (result.error_message or "").lower())

    def test_list_sessions_success(self):
        """Test successful session listing."""
        # Create a temporary database
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_db:
            temp_db_path = Path(temp_db.name)

        try:
            # Set up test database
            with sqlite3.connect(temp_db_path) as conn:
                conn.execute("""
                    CREATE TABLE session (
                        id TEXT PRIMARY KEY,
                        title TEXT,
                        directory TEXT,
                        time_updated REAL
                    )
                """)
                conn.execute("""
                    INSERT INTO session (id, title, directory, time_updated)
                    VALUES ('session1', 'Test Session 1', '/test/dir', 1640995200.0)
                """)
                conn.execute("""
                    INSERT INTO session (id, title, directory, time_updated)
                    VALUES ('session2', 'Test Session 2', '/test/dir', 1640995300.0)
                """)
                conn.commit()

            with patch.object(
                self.cli, "_get_database_path", return_value=temp_db_path
            ):
                result = self.cli.list_sessions(Path("/test/dir"))

            self.assertTrue(result.success)
            self.assertEqual(len(result.sessions), 2)
            self.assertEqual(
                result.sessions[0].session_id, "session2"
            )  # Should be ordered by time_updated DESC
            self.assertEqual(result.sessions[1].session_id, "session1")

        finally:
            temp_db_path.unlink(missing_ok=True)

    def test_list_sessions_no_directory_filter(self):
        """Test session listing without directory filter."""
        # Create a temporary database
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_db:
            temp_db_path = Path(temp_db.name)

        try:
            # Set up test database
            with sqlite3.connect(temp_db_path) as conn:
                conn.execute("""
                    CREATE TABLE session (
                        id TEXT PRIMARY KEY,
                        title TEXT,
                        directory TEXT,
                        time_updated REAL
                    )
                """)
                conn.execute("""
                    INSERT INTO session (id, title, directory, time_updated)
                    VALUES ('session1', 'Test Session 1', '/test/dir1', 1640995200.0)
                """)
                conn.execute("""
                    INSERT INTO session (id, title, directory, time_updated)
                    VALUES ('session2', 'Test Session 2', '/test/dir2', 1640995300.0)
                """)
                conn.commit()

            with patch.object(
                self.cli, "_get_database_path", return_value=temp_db_path
            ):
                result = self.cli.list_sessions(None)

            self.assertTrue(result.success)
            self.assertEqual(len(result.sessions), 2)

        finally:
            temp_db_path.unlink(missing_ok=True)

    def test_list_sessions_with_millisecond_timestamp(self):
        """Test session listing handles millisecond epoch timestamps."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_db:
            temp_db_path = Path(temp_db.name)

        try:
            with sqlite3.connect(temp_db_path) as conn:
                conn.execute("""
                    CREATE TABLE session (
                        id TEXT PRIMARY KEY,
                        title TEXT,
                        directory TEXT,
                        time_updated REAL
                    )
                """)
                conn.execute("""
                    INSERT INTO session (id, title, directory, time_updated)
                    VALUES ('session_ms', 'Millisecond Session', '/test/dir', 1763729204675)
                """)
                conn.commit()

            with patch.object(
                self.cli, "_get_database_path", return_value=temp_db_path
            ):
                result = self.cli.list_sessions(Path("/test/dir"))

            self.assertTrue(result.success)
            self.assertEqual(len(result.sessions), 1)
            self.assertNotEqual(result.sessions[0].updated, "Unknown")

        finally:
            temp_db_path.unlink(missing_ok=True)

    def test_export_session_database_not_found(self):
        """Test export_session when database doesn't exist."""
        with patch.object(self.cli, "_get_database_path", return_value=None):
            result = self.cli.export_session("session1", Path("/test"))

        self.assertFalse(result.success)
        self.assertEqual(len(result.messages), 0)
        self.assertIn("database not found", (result.error_message or "").lower())

    def test_export_session_success(self):
        """Test successful session export."""
        # Create a temporary database
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_db:
            temp_db_path = Path(temp_db.name)

        try:
            # Set up test database
            with sqlite3.connect(temp_db_path) as conn:
                conn.execute("""
                    CREATE TABLE session (
                        id TEXT PRIMARY KEY,
                        title TEXT,
                        directory TEXT,
                        time_updated REAL
                    )
                """)
                conn.execute("""
                    CREATE TABLE message (
                        id TEXT PRIMARY KEY,
                        session_id TEXT,
                        time_created REAL,
                        data TEXT
                    )
                """)
                conn.execute("""
                    CREATE TABLE part (
                        id TEXT PRIMARY KEY,
                        message_id TEXT,
                        time_created REAL,
                        data TEXT
                    )
                """)

                # Insert test data
                conn.execute("""
                    INSERT INTO session (id, title, directory, time_updated)
                    VALUES ('session1', 'Test Session', '/test/dir', 1640995200.0)
                """)

                message_data = json.dumps({"role": "user", "content": "Hello, world!"})
                conn.execute(
                    """
                    INSERT INTO message (id, session_id, time_created, data)
                    VALUES ('msg1', 'session1', 1640995200.0, ?)
                """,
                    (message_data,),
                )

                part_data = json.dumps({"content": "Hello, world!"})
                conn.execute(
                    """
                    INSERT INTO part (id, message_id, time_created, data)
                    VALUES ('part1', 'msg1', 1640995200.0, ?)
                """,
                    (part_data,),
                )

                conn.commit()

            with patch.object(
                self.cli, "_get_database_path", return_value=temp_db_path
            ):
                result = self.cli.export_session("session1", None)

            self.assertTrue(result.success)
            self.assertEqual(len(result.messages), 1)
            self.assertEqual(result.messages[0].role, "user")
            self.assertEqual(result.messages[0].content, "Hello, world!")

        finally:
            temp_db_path.unlink(missing_ok=True)

    def test_export_session_preserves_millisecond_timestamp(self):
        """Test export_session keeps millisecond timestamps stable."""
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_db:
            temp_db_path = Path(temp_db.name)

        try:
            with sqlite3.connect(temp_db_path) as conn:
                conn.execute("""
                    CREATE TABLE session (
                        id TEXT PRIMARY KEY,
                        title TEXT,
                        directory TEXT,
                        time_updated REAL
                    )
                """)
                conn.execute("""
                    CREATE TABLE message (
                        id TEXT PRIMARY KEY,
                        session_id TEXT,
                        time_created REAL,
                        data TEXT
                    )
                """)
                conn.execute("""
                    CREATE TABLE part (
                        id TEXT PRIMARY KEY,
                        message_id TEXT,
                        time_created REAL,
                        data TEXT
                    )
                """)
                conn.execute("""
                    INSERT INTO session (id, title, directory, time_updated)
                    VALUES ('session1', 'Test Session', '/test/dir', 1763729204675)
                """)

                message_data = json.dumps({"role": "user", "content": "Hello"})
                conn.execute(
                    """
                    INSERT INTO message (id, session_id, time_created, data)
                    VALUES ('msg1', 'session1', 1763729204675, ?)
                """,
                    (message_data,),
                )
                conn.commit()

            with patch.object(
                self.cli, "_get_database_path", return_value=temp_db_path
            ):
                result = self.cli.export_session("session1", None)

            self.assertTrue(result.success)
            self.assertEqual(len(result.messages), 1)
            self.assertEqual(result.messages[0].timestamp, 1763729204675)

        finally:
            temp_db_path.unlink(missing_ok=True)

    def test_export_session_malformed_json(self):
        """Test export_session handles malformed JSON gracefully."""
        # Create a temporary database
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_db:
            temp_db_path = Path(temp_db.name)

        try:
            # Set up test database with malformed JSON
            with sqlite3.connect(temp_db_path) as conn:
                conn.execute("""
                    CREATE TABLE session (
                        id TEXT PRIMARY KEY,
                        title TEXT,
                        directory TEXT,
                        time_updated REAL
                    )
                """)
                conn.execute("""
                    CREATE TABLE message (
                        id TEXT PRIMARY KEY,
                        session_id TEXT,
                        time_created REAL,
                        data TEXT
                    )
                """)
                conn.execute("""
                    CREATE TABLE part (
                        id TEXT PRIMARY KEY,
                        message_id TEXT,
                        time_created REAL,
                        data TEXT
                    )
                """)

                # Insert test data with malformed JSON
                conn.execute("""
                    INSERT INTO session (id, title, directory, time_updated)
                    VALUES ('session1', 'Test Session', '/test/dir', 1640995200.0)
                """)

                conn.execute("""
                    INSERT INTO message (id, session_id, time_created, data)
                    VALUES ('msg1', 'session1', 1640995200.0, 'invalid json {')
                """)

                conn.commit()

            with patch.object(
                self.cli, "_get_database_path", return_value=temp_db_path
            ):
                result = self.cli.export_session("session1", None)

            # Should still succeed but with empty content
            self.assertTrue(result.success)
            self.assertEqual(len(result.messages), 1)
            self.assertEqual(result.messages[0].content, "")

        finally:
            temp_db_path.unlink(missing_ok=True)

    def test_session_matches_directory(self):
        """Test session directory matching."""
        # Create a temporary database
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_db:
            temp_db_path = Path(temp_db.name)

        try:
            # Set up test database
            with sqlite3.connect(temp_db_path) as conn:
                conn.execute("""
                    CREATE TABLE session (
                        id TEXT PRIMARY KEY,
                        title TEXT,
                        directory TEXT,
                        time_updated REAL
                    )
                """)
                conn.execute("""
                    INSERT INTO session (id, title, directory, time_updated)
                    VALUES ('session1', 'Test Session', '/test/dir', 1640995200.0)
                """)
                conn.commit()

            with patch.object(
                self.cli, "_get_database_path", return_value=temp_db_path
            ):
                # Should match
                result = self.cli._session_matches_directory(
                    "session1", Path("/test/dir")
                )
                self.assertTrue(result)

                # Should not match
                result = self.cli._session_matches_directory(
                    "session1", Path("/other/dir")
                )
                self.assertFalse(result)

        finally:
            temp_db_path.unlink(missing_ok=True)

    @patch("opencode_database_agent_cli.subprocess.run")
    def test_list_agents_success(self, mock_subprocess_run):
        """Test successful agent listing via CLI subprocess."""
        # Mock successful subprocess output
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = (
            "test_agent (Built-in)\nDetails about test agent\ncustom_agent (Custom)\n"
        )
        mock_result.stderr = ""
        mock_subprocess_run.return_value = mock_result

        result = self.cli.list_agents()

        # Verify subprocess was called correctly
        mock_subprocess_run.assert_called_once_with(
            ["opencode", "agent", "list"],
            capture_output=True,
            text=True,
        )

        self.assertTrue(result.success)
        self.assertEqual(len(result.agents), 2)
        self.assertEqual(result.agents[0].name, "test_agent")
        self.assertEqual(result.agents[0].agent_type, "Built-in")
        self.assertEqual(result.agents[1].name, "custom_agent")
        self.assertEqual(result.agents[1].agent_type, "Custom")

    @patch("opencode_database_agent_cli.subprocess.run")
    def test_list_agents_command_failure(self, mock_subprocess_run):
        """Test agent listing when CLI command fails."""
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stderr = "Command failed"
        mock_subprocess_run.return_value = mock_result

        result = self.cli.list_agents()

        self.assertFalse(result.success)
        self.assertEqual(len(result.agents), 0)
        self.assertIn("Command failed", result.error_message or "")

    @patch("opencode_database_agent_cli.subprocess.run")
    def test_list_agents_file_not_found(self, mock_subprocess_run):
        """Test agent listing when CLI command is not found."""
        mock_subprocess_run.side_effect = FileNotFoundError()

        result = self.cli.list_agents()

        self.assertFalse(result.success)
        self.assertEqual(len(result.agents), 0)
        self.assertIn("command not found", result.error_message or "")

    @patch("opencode_database_agent_cli.subprocess.run")
    def test_run_agent_success(self, mock_subprocess_run):
        """Test successful agent execution via CLI subprocess."""
        # Mock successful subprocess output
        mock_result = Mock()
        mock_result.returncode = 0
        mock_result.stdout = '{"session_id": "ses_123"}\n{"part": {"type": "text", "text": "Hello response", "timestamp": 1640995200000}}\n'
        mock_result.stderr = ""
        mock_subprocess_run.return_value = mock_result

        result = self.cli.run_agent(
            message="test message",
            session_id="session1",
            agent="test_agent",
            model="test_model",
            cwd=Path("/test"),
        )

        # Verify subprocess was called correctly
        mock_subprocess_run.assert_called_once_with(
            [
                "opencode",
                "run",
                "-s",
                "session1",
                "--agent",
                "test_agent",
                "--model",
                "test_model",
                "--format",
                "json",
            ],
            input="test message",
            capture_output=True,
            text=True,
            cwd=Path("/test"),
        )

        self.assertTrue(result.success)
        self.assertEqual(result.session_id, "ses_123")
        self.assertEqual(
            len(result.response_parts), 0
        )  # No response parsing - export API handles content

    @patch("opencode_database_agent_cli.subprocess.run")
    def test_run_agent_command_failure(self, mock_subprocess_run):
        """Test agent execution when CLI command fails."""
        mock_result = Mock()
        mock_result.returncode = 1
        mock_result.stderr = "Execution failed"
        mock_subprocess_run.return_value = mock_result

        result = self.cli.run_agent(
            message="test message",
            session_id="session1",
            agent="test_agent",
            model="test_model",
            cwd=Path("/test"),
        )

        self.assertFalse(result.success)
        self.assertEqual(len(result.response_parts), 0)
        self.assertIn("Execution failed", result.error_message or "")

    @patch("opencode_database_agent_cli.subprocess.run")
    def test_run_agent_file_not_found(self, mock_subprocess_run):
        """Test agent execution when CLI command is not found."""
        mock_subprocess_run.side_effect = FileNotFoundError()

        result = self.cli.run_agent(
            message="test message",
            session_id="session1",
            agent="test_agent",
            model="test_model",
            cwd=Path("/test"),
        )

        self.assertFalse(result.success)
        self.assertEqual(len(result.response_parts), 0)
        self.assertIn("command not found", result.error_message or "")

    @patch("opencode_database_agent_cli.subprocess.Popen")
    def test_run_agent_with_cancellation(self, mock_popen):
        """Test agent execution with cancellation support."""
        from threading import Event

        cancel_event = Event()
        cancel_event.set()  # Pre-cancelled

        result = self.cli.run_agent(
            message="test message",
            session_id="session1",
            agent="test_agent",
            model="test_model",
            cwd=Path("/test"),
            cancel_event=cancel_event,
        )

        # Should return immediately due to pre-set cancel event
        self.assertFalse(result.success)
        self.assertEqual(len(result.response_parts), 0)
        self.assertIn("cancelled", result.error_message or "")

    def test_parse_agent_list_empty(self):
        """Test parsing empty agent list output."""
        result = self.cli._parse_agent_list("")
        self.assertEqual(len(result), 0)

    def test_parse_agent_list_with_details(self):
        """Test parsing agent list output with details."""
        output = """test_agent (Built-in)
    This is a test agent
    It does testing things
custom_agent (Custom)
    A custom agent"""

        result = self.cli._parse_agent_list(output)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].name, "test_agent")
        self.assertEqual(result[0].agent_type, "Built-in")
        self.assertEqual(len(result[0].details), 2)
        self.assertEqual(result[0].details[0], "This is a test agent")
        self.assertEqual(result[1].name, "custom_agent")
        self.assertEqual(result[1].agent_type, "Custom")

    def test_extract_part_content_reasoning(self):
        """Test extracting content from reasoning parts."""
        part: dict[str, object] = {
            "type": "reasoning",
            "text": "Let me think about this",
        }
        result = self.cli._extract_part_content(part, "reasoning")
        self.assertEqual(result, "Let me think about this")

    def test_extract_part_content_fallback(self):
        """Test extracting content using fallback logic."""
        # Test content field fallback
        part: dict[str, object] = {"content": "Some content"}
        result = self.cli._extract_part_content(part, "unknown_type")
        self.assertEqual(result, "Some content")

        # Test empty content filtering
        part_empty: dict[str, object] = {"type": "unknown"}
        result_empty = self.cli._extract_part_content(part_empty, "unknown_type")
        self.assertEqual(result_empty, "")

    def test_extract_part_content_text(self):
        """Test extracting content from text parts."""
        part: dict[str, object] = {"text": "Hello, world!"}
        result = self.cli._extract_part_content(part, "text")
        self.assertEqual(result, "Hello, world!")

    def test_extract_part_content_tool(self):
        """Test extracting content from tool parts."""
        part: dict[str, object] = {"tool": "calculator", "name": "calc"}
        result = self.cli._extract_part_content(part, "tool")
        self.assertEqual(result, "calculator")

    def test_to_milliseconds_valid(self):
        """Test converting valid timestamp to milliseconds."""
        result = self.cli._to_milliseconds(1640995200.5)
        self.assertEqual(result, 1640995200)

    def test_to_milliseconds_invalid(self):
        """Test converting invalid timestamp returns None."""
        result = self.cli._to_milliseconds("invalid")
        self.assertIsNone(result)

    def test_list_sessions_sqlite_error(self):
        """Test list_sessions handles SQLite errors gracefully."""
        with patch.object(
            self.cli, "_get_database_path", return_value=Path("/nonexistent/db.sqlite")
        ):
            with patch("sqlite3.connect", side_effect=sqlite3.Error("Database error")):
                result = self.cli.list_sessions(Path("/test"))

                self.assertFalse(result.success)
                self.assertIn("error", (result.error_message or "").lower())

    def test_export_session_sqlite_error(self):
        """Test export_session handles SQLite errors gracefully."""
        with patch.object(
            self.cli, "_get_database_path", return_value=Path("/nonexistent/db.sqlite")
        ):
            with patch("sqlite3.connect", side_effect=sqlite3.Error("Database error")):
                result = self.cli.export_session("session1", None)  # Pass None for cwd

                self.assertFalse(result.success)
                self.assertIn("error", (result.error_message or "").lower())


if __name__ == "__main__":
    unittest.main()
