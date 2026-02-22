"""OpenCode Database Agent CLI implementation.

This module provides a database-backed implementation of the AgentCLI interface
that directly queries OpenCode's SQLite database instead of using CLI commands.
"""

import sqlite3
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Callable
from threading import Event
import subprocess
from datetime import datetime
from collections import defaultdict

from agent_cli import AgentCLI
from agent_results import (
    ExportResult,
    SessionListResult,
    HistoryMessage,
    SessionInfo,
    AgentListResult,
    AgentInfo,
    RunResult,
)

logger = logging.getLogger(__name__)

# Regex patterns for parsing CLI output
AGENT_ROW_PATTERN = re.compile(r"^(?P<name>\S+)\s+\((?P<kind>[^)]+)\)\s*$")


class OpenCodeDatabaseAgentCLI(AgentCLI):
    """Hybrid OpenCode agent CLI implementation.

    This class provides both fast database access for session operations
    and full CLI subprocess functionality for agent operations, combining
    the best of both approaches for optimal performance and completeness.
    """

    @property
    def cli_name(self) -> str:
        """Return the CLI name identifier."""
        return "opencode"

    def _get_database_path(self) -> Path | None:
        """Get the path to OpenCode's SQLite database."""
        # Check environment variable first
        configured = os.environ.get("OPENCODE_DATABASE_PATH")
        if configured and Path(configured).expanduser().exists():
            return Path(configured).expanduser()

        # Standard OpenCode database location
        opencode_db = Path.home() / ".local/share/opencode/opencode.db"
        return opencode_db if opencode_db.exists() else None

    def _get_directory_key(self, cwd: Path) -> str:
        """Get the directory key for database queries."""
        return str(cwd.resolve())

    def _session_matches_directory(self, session_id: str, cwd: Path) -> bool:
        """Check whether a session belongs to the provided working directory."""
        db_path = self._get_database_path()
        if not db_path:
            return False

        directory_key = self._get_directory_key(cwd)
        try:
            with sqlite3.connect(db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT 1 FROM session WHERE id = ? AND directory = ? LIMIT 1",
                    (session_id, directory_key),
                )
                return cursor.fetchone() is not None
        except sqlite3.Error:
            return False

    def _normalize_epoch_milliseconds(self, raw_value: Any) -> int | None:
        """Normalize epoch timestamps in seconds/ms/us/ns to milliseconds."""
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            return None

        magnitude = abs(value)
        seconds = value

        if magnitude >= 1e17:
            # Nanoseconds
            seconds = value / 1_000_000_000
        elif magnitude >= 1e14:
            # Microseconds
            seconds = value / 1_000_000
        elif magnitude >= 1e11:
            # Milliseconds
            seconds = value / 1_000

        return int(seconds * 1000)

    def _format_session_updated(self, raw_value: Any) -> str:
        """Format session update timestamp safely for display."""
        normalized = self._normalize_epoch_milliseconds(raw_value)
        if normalized is None:
            return "Unknown"

        try:
            return datetime.fromtimestamp(normalized / 1000).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
        except (OverflowError, OSError, ValueError):
            return "Unknown"

    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        """List available sessions and return structured result."""
        try:
            db_path = self._get_database_path()
            if not db_path:
                return SessionListResult(
                    success=False,
                    sessions=[],
                    error_message=self.missing_command_error()
                    + " OpenCode database not found.",
                )

            logger.debug(f"Connecting to database: {db_path}")

            sessions = []
            directory_key = self._get_directory_key(cwd) if cwd else None

            with sqlite3.connect(db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                if directory_key:
                    cursor.execute(
                        "SELECT id, title, directory, time_updated FROM session "
                        "WHERE directory = ? ORDER BY time_updated DESC LIMIT 50",
                        (directory_key,),
                    )
                else:
                    cursor.execute(
                        "SELECT id, title, directory, time_updated FROM session "
                        "ORDER BY time_updated DESC LIMIT 50"
                    )

                for row in cursor.fetchall():
                    updated = self._format_session_updated(row["time_updated"])

                    sessions.append(
                        SessionInfo(
                            session_id=row["id"],
                            title=row["title"] or f"Session {row['id'][:8]}",
                            updated=updated,
                        )
                    )

            logger.info(f"Found {len(sessions)} sessions")
            return SessionListResult(success=True, sessions=sessions)

        except FileNotFoundError:
            return SessionListResult(
                success=False, sessions=[], error_message=self.missing_command_error()
            )
        except Exception as e:
            logger.error(f"Database error: {str(e)}")
            return SessionListResult(
                success=False, sessions=[], error_message=f"Error: {str(e)}"
            )

    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        """Export session history and return structured result."""
        try:
            db_path = self._get_database_path()
            if not db_path:
                return ExportResult(
                    success=False,
                    session_id=session_id,
                    messages=[],
                    error_message=self.missing_command_error()
                    + " OpenCode database not found.",
                )

            logger.debug(f"Connecting to database: {db_path}")
            logger.info(f"Exporting session: {session_id}")

            # Check if session exists and matches directory if specified
            if cwd and not self._session_matches_directory(session_id, cwd):
                return ExportResult(
                    success=False,
                    session_id=session_id,
                    messages=[],
                    error_message=f"Session {session_id} not found in directory {cwd}",
                )

            messages = []
            with sqlite3.connect(db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()

                # Query messages and their parts
                cursor.execute(
                    """
                    SELECT m.id as message_id, m.time_created as message_time, m.data as message_data,
                           p.id as part_id, p.time_created as part_time, p.data as part_data
                    FROM message m LEFT JOIN part p ON m.id = p.message_id  
                    WHERE m.session_id = ? ORDER BY m.time_created, p.time_created
                """,
                    (session_id,),
                )

                # Group parts by message
                message_parts = defaultdict(list)
                message_data = {}

                for row in cursor.fetchall():
                    msg_id = row["message_id"]

                    # Store message data if not already stored
                    if msg_id not in message_data:
                        try:
                            msg_json = (
                                json.loads(row["message_data"])
                                if row["message_data"]
                                else {}
                            )
                        except (json.JSONDecodeError, TypeError):
                            msg_json = {}

                        message_data[msg_id] = {
                            "json": msg_json,
                            "timestamp": row["message_time"],
                        }

                    # Add part data if exists
                    if row["part_id"]:
                        try:
                            part_json = (
                                json.loads(row["part_data"]) if row["part_data"] else {}
                            )
                        except (json.JSONDecodeError, TypeError):
                            part_json = {}

                        message_parts[msg_id].append(
                            {
                                "id": row["part_id"],
                                "json": part_json,
                                "timestamp": row["part_time"],
                            }
                        )

                # Convert to HistoryMessage objects
                for msg_id, data in message_data.items():
                    msg_json = data["json"]
                    parts = message_parts[msg_id]

                    # Determine role and content from message data
                    role = msg_json.get("role", "assistant")

                    # Convert message timestamp
                    base_timestamp = None
                    if data["timestamp"]:
                        base_timestamp = self._normalize_epoch_milliseconds(
                            data["timestamp"]
                        )

                    if parts:
                        # Create separate messages for different part types
                        text_parts = []

                        for part in parts:
                            part_data = part["json"]
                            part_type = part_data.get("type", "")

                            # Get part-specific timestamp or use message timestamp
                            part_timestamp = None
                            if part["timestamp"]:
                                part_timestamp = self._normalize_epoch_milliseconds(
                                    part["timestamp"]
                                )
                            part_timestamp = part_timestamp or base_timestamp

                            if part_type == "text":
                                # User input or assistant text content
                                part_content = part_data.get("text", "")
                                if part_content:
                                    text_parts.append(part_content)

                            elif part_type == "reasoning":
                                # Assistant reasoning steps - add as text content
                                part_content = part_data.get("text", "")
                                if part_content:
                                    text_parts.append(part_content)

                            elif part_type == "tool":
                                # Tool invocations - create separate tool message
                                tool_name = part_data.get("tool", "")
                                if tool_name:
                                    messages.append(
                                        HistoryMessage(
                                            message_id=f"{msg_id}_tool_{part['id']}",
                                            role=role,
                                            content_type="tool_use",
                                            content=tool_name,
                                            timestamp=part_timestamp,
                                        )
                                    )

                            elif part_type in ["step-start", "step-finish"]:
                                # Skip metadata-only parts
                                continue

                            else:
                                # Fallback: check text, content, or other fields
                                part_content = (
                                    part_data.get("text", "")
                                    or part_data.get("content", "")
                                    or part_data.get("tool", "")
                                )
                                if part_content:
                                    text_parts.append(part_content)

                        # Create main text message if we have text content
                        if text_parts:
                            content = "\n\n".join(text_parts)
                            messages.append(
                                HistoryMessage(
                                    message_id=msg_id,
                                    role=role,
                                    content_type="text",
                                    content=content,
                                    timestamp=base_timestamp,
                                )
                            )
                    else:
                        # No parts - use message content directly
                        content = msg_json.get("content", "")
                        # Always create message for database records, even with empty content
                        # This handles cases like malformed JSON gracefully
                        messages.append(
                            HistoryMessage(
                                message_id=msg_id,
                                role=role,
                                content_type="text",
                                content=content,
                                timestamp=base_timestamp,
                            )
                        )

            logger.info(f"Exported {len(messages)} messages from session {session_id}")
            return ExportResult(success=True, session_id=session_id, messages=messages)

        except FileNotFoundError:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=self.missing_command_error(),
            )
        except Exception as e:
            logger.error(f"Database error: {str(e)}")
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Error: {str(e)}",
            )

    def _to_milliseconds(self, raw_value: Any) -> int | None:
        """Convert value to milliseconds timestamp."""
        try:
            return int(float(raw_value))
        except (TypeError, ValueError):
            return None

    def _extract_part_content(self, part: dict[str, object], part_type: str) -> str:
        """Extract content from a response part."""
        if part_type in {"text"}:
            return str(part.get("text") or "")
        elif part_type == "reasoning":
            # Assistant reasoning steps - check reasoning field first, then text
            return str(part.get("reasoning") or part.get("text") or "")
        elif part_type in {"tool_use", "tool"}:
            for key in ("tool", "name", "id"):
                if part.get(key):
                    return str(part[key])
            return ""
        elif part_type in ["step-start", "step-finish"]:
            # Skip metadata-only parts
            return ""
        else:
            # Fallback: check text, content, or other fields (matches export_session logic)
            content = (
                part.get("text", "") or part.get("content", "") or part.get("tool", "")
            )
            return str(content) if content else ""

    def _parse_agent_list(self, output: str) -> list[AgentInfo]:
        """Parse agent list output."""
        agents: list[AgentInfo] = []
        current_agent: AgentInfo | None = None

        for line in output.splitlines():
            stripped = line.strip()
            if not stripped:
                continue

            match = AGENT_ROW_PATTERN.match(stripped)
            if match:
                current_agent = AgentInfo(
                    name=match.group("name"), agent_type=match.group("kind"), details=[]
                )
                agents.append(current_agent)
                continue

            if current_agent is not None:
                current_agent.details.append(stripped)

        return agents

    def list_agents(self) -> AgentListResult:
        """List available agents using CLI subprocess."""
        try:
            result = subprocess.run(
                ["opencode", "agent", "list"],
                capture_output=True,
                text=True,
            )

            if result.returncode != 0:
                error_message = (result.stderr or "").strip() or "Failed to list agents"
                return AgentListResult(
                    success=False, agents=[], error_message=error_message
                )

            agents = self._parse_agent_list(result.stdout or "")
            return AgentListResult(success=True, agents=agents)

        except FileNotFoundError:
            return AgentListResult(
                success=False, agents=[], error_message=self.missing_command_error()
            )
        except Exception as e:
            return AgentListResult(
                success=False, agents=[], error_message=f"Error: {str(e)}"
            )

    def run_agent(
        self,
        message: str,
        session_id: str | None,
        agent: str | None,
        model: str | None,
        cwd: Path,
        cancel_event: Event | None = None,
        on_process: Callable[[subprocess.Popen[str]], None] | None = None,
    ) -> RunResult:
        """Run agent with message using CLI subprocess and return structured result."""
        try:
            # Build command inline
            command = ["opencode", "run"]
            if session_id:
                command.extend(["-s", session_id])
            if agent:
                command.extend(["--agent", agent])
            if model:
                command.extend(["--model", model])
            command.extend(["--format", "json"])

            if cancel_event and cancel_event.is_set():
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message="Agent request cancelled.",
                )

            if cancel_event is None and on_process is None:
                process = subprocess.run(
                    command,
                    input=message,
                    capture_output=True,
                    text=True,
                    cwd=cwd,
                )
                stdout = process.stdout
                stderr = process.stderr
            else:
                process = subprocess.Popen(
                    command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    cwd=cwd,
                )
                if on_process:
                    on_process(process)

                input_data: str | None = message
                while True:
                    try:
                        stdout, stderr = process.communicate(
                            input=input_data, timeout=0.1
                        )
                        break
                    except subprocess.TimeoutExpired:
                        input_data = None
                        if cancel_event and cancel_event.is_set():
                            process.terminate()
                            try:
                                stdout, stderr = process.communicate(timeout=1)
                            except subprocess.TimeoutExpired:
                                process.kill()
                                stdout, stderr = process.communicate()
                            return RunResult(
                                success=False,
                                session_id=session_id,
                                response_parts=[],
                                error_message="Agent request cancelled.",
                            )

            if process.returncode == 0:
                # Extract only session_id from output, no response parsing
                extracted_session_id = session_id  # Default to input session_id
                if stdout:
                    for line in stdout.strip().split("\n"):
                        if line:
                            try:
                                data = json.loads(line)
                                if isinstance(data, dict) and "session_id" in data:
                                    extracted_session_id = str(data["session_id"])
                                    break
                            except json.JSONDecodeError:
                                continue

                # Generate session_id if none provided and none extracted
                if not extracted_session_id:
                    extracted_session_id = f"opencode-{int(time.time())}"

                return RunResult(
                    success=True,
                    session_id=extracted_session_id,
                    response_parts=[],  # No response parsing - export API handles content
                )
            else:
                if cancel_event and cancel_event.is_set():
                    return RunResult(
                        success=False,
                        session_id=session_id,
                        response_parts=[],
                        error_message="Agent request cancelled.",
                    )
                error_msg = (stderr or "").strip() or "Command failed with no output"
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message=error_msg,
                )

        except FileNotFoundError:
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message=self.missing_command_error(),
            )
        except Exception as e:
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message=f"Error: {str(e)}",
            )
