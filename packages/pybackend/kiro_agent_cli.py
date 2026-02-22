"""Kiro CLI implementation of the AgentCLI interface."""

import json
import os
import re
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path
from threading import Event
from typing import Any, Callable

from agent_cli import AgentCLI
from agent_results import (
    AgentInfo,
    AgentListResult,
    ExportResult,
    HistoryMessage,
    RunResult,
    SessionInfo,
    SessionListResult,
)


class KiroAgentCLI(AgentCLI):
    """Kiro CLI implementation following the AgentCLI interface."""

    @property
    def cli_name(self) -> str:
        """Return the CLI name for error messages."""
        return "kiro-cli"

    def missing_command_error(self) -> str:
        """Return error message for missing CLI command."""
        return f"Error: '{self.cli_name}' command not found. Please ensure it is installed and in PATH."

    def _strip_ansi_codes(self, text: str) -> str:
        """Remove ANSI escape sequences from text."""
        ansi_escape = re.compile(r"\x1b\[[0-9;]*m")
        return ansi_escape.sub("", text)

    def _clean_response_text(self, text: str) -> str:
        """Normalize kiro-cli output for display."""
        cleaned = self._strip_ansi_codes(text)
        if not cleaned:
            return cleaned

        cleaned = re.sub(r"(?m)^>\s*", "", cleaned)
        cleaned = re.sub(r"(?m)^\([^)]*\)\s*", "", cleaned)
        return cleaned.strip()

    def _get_database_path(self) -> Path | None:
        """Get the path to Kiro's SQLite database."""
        # Check environment variable first
        configured = os.environ.get("KIRO_DATABASE_PATH")
        if configured and Path(configured).expanduser().exists():
            return Path(configured).expanduser()

        # Fallback to standard locations
        candidates = [
            Path.home() / ".local/share/kiro-cli/data.sqlite3",
            Path.home() / ".local/share/kiro/data.sqlite3",
            Path.home() / ".config/kiro/data.sqlite3",
        ]
        return next((c for c in candidates if c.exists()), None)

    def _get_directory_key(self, cwd: Path) -> str:
        """Get the directory key for database queries."""
        return str(cwd.resolve())

    def _to_milliseconds(self, raw_value: Any) -> int | None:
        """Convert value to milliseconds timestamp."""
        try:
            return int(float(raw_value))
        except (TypeError, ValueError):
            return None

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
                    "SELECT 1 FROM conversations_v2 WHERE key = ? AND conversation_id = ? LIMIT 1",
                    (directory_key, session_id),
                )
                return cursor.fetchone() is not None
        except sqlite3.Error:
            return False

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
        """Run agent with message and return structured result."""
        try:
            # Build command inline
            command = ["kiro-cli", "chat", "--no-interactive", "--trust-all-tools"]
            if session_id and self._session_matches_directory(session_id, cwd):
                command.append("--resume")
            if agent:
                command.extend(["--agent", agent])
            if model:
                command.extend(["--model", model])

            if cancel_event and cancel_event.is_set():
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message="Agent request cancelled.",
                )

            if cancel_event is None and on_process is None:
                process = subprocess.run(
                    command, input=message, capture_output=True, text=True, cwd=cwd
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
                # Process management only - generate session_id if needed
                final_session_id = (
                    session_id or f"kiro-{int(datetime.now().timestamp())}"
                )

                return RunResult(
                    success=True,
                    session_id=final_session_id,
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

    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        """Export session history and return structured result."""
        try:
            db_path = self._get_database_path()
            if not db_path:
                return ExportResult(
                    success=False,
                    session_id=session_id,
                    messages=[],
                    error_message="Kiro database not found",
                )

            directory_key = self._get_directory_key(cwd or Path.cwd())

            with sqlite3.connect(db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT value FROM conversations_v2 WHERE key = ? AND conversation_id = ?",
                    (directory_key, session_id),
                )
                row = cursor.fetchone()

                if not row:
                    return ExportResult(
                        success=False,
                        session_id=session_id,
                        messages=[],
                        error_message=f"Session {session_id} not found",
                    )

                conversation_data = json.loads(row[0])
                messages = self._parse_conversation_history(conversation_data)

                return ExportResult(
                    success=True, session_id=session_id, messages=messages
                )

        except Exception as e:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Error: {str(e)}",
            )

    def _parse_conversation_history(
        self, conversation_data: dict[str, Any]
    ) -> list[HistoryMessage]:
        """Parse Kiro conversation data into HistoryMessage objects."""
        from datetime import datetime

        messages: list[HistoryMessage] = []
        history = conversation_data.get("history", [])

        for exchange in history:
            user_msg = exchange.get("user", {})
            assistant_msg = exchange.get("assistant", {})
            metadata = exchange.get("request_metadata") or {}
            if not isinstance(metadata, dict):
                metadata = {}

            # Extract timestamp from metadata
            assistant_timestamp_ms = metadata.get("stream_end_timestamp_ms")

            # Add user message
            user_content = user_msg.get("content", {})
            if "Prompt" in user_content:
                prompt_text = user_content["Prompt"].get("prompt", "")
                timestamp_str = user_msg.get("timestamp")
                timestamp_ms = None
                if timestamp_str:
                    try:
                        dt = datetime.fromisoformat(
                            timestamp_str.replace("Z", "+00:00")
                        )
                        timestamp_ms = int(dt.timestamp() * 1000)
                    except ValueError:
                        pass

                messages.append(
                    HistoryMessage(
                        message_id=None,
                        role="user",
                        content_type="text",
                        content=prompt_text,
                        timestamp=timestamp_ms,
                    )
                )

            # Add assistant message
            if "Response" in assistant_msg:
                response_data = assistant_msg["Response"]
                response_text = self._clean_response_text(
                    response_data.get("content", "")
                )
                messages.append(
                    HistoryMessage(
                        message_id=response_data.get("message_id"),
                        role="assistant",
                        content_type="text",
                        content=response_text,
                        timestamp=assistant_timestamp_ms,
                    )
                )
            elif "ToolUse" in assistant_msg:
                tool_data = assistant_msg["ToolUse"]
                tool_uses = tool_data.get("tool_uses", [])
                base_message_id = tool_data.get("message_id", "unknown")

                # Add separate tool usage message
                if tool_uses:
                    tool_info = []
                    for tool in tool_uses:
                        tool_name = tool.get("name", "unknown")
                        tool_args = tool.get("args", {})
                        tool_info.append(f"Tool: {tool_name}")
                        for key, value in tool_args.items():
                            value_str = str(value)
                            if len(value_str) > 200:
                                value_str = value_str[:200] + "..."
                            tool_info.append(f"  {key}: {value_str}")

                    messages.append(
                        HistoryMessage(
                            message_id=f"{base_message_id}-tool",
                            role="assistant",
                            content_type="tool_use",
                            content="\n".join(tool_info),
                            timestamp=assistant_timestamp_ms,
                        )
                    )

                # Add separate response message if there's content
                response_content = tool_data.get("content", "").strip()
                if response_content:
                    messages.append(
                        HistoryMessage(
                            message_id=f"{base_message_id}-response",
                            role="assistant",
                            content_type="text",
                            content=self._clean_response_text(response_content),
                            timestamp=assistant_timestamp_ms,
                        )
                    )

        return messages

    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        """List available sessions and return structured result."""
        try:
            db_path = self._get_database_path()
            if not db_path:
                return SessionListResult(
                    success=False, sessions=[], error_message="Kiro database not found"
                )

            directory_key = self._get_directory_key(cwd or Path.cwd())

            with sqlite3.connect(db_path) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT conversation_id, value, created_at FROM conversations_v2 WHERE key = ? ORDER BY created_at DESC",
                    (directory_key,),
                )
                rows = cursor.fetchall()

                sessions = []
                for conversation_id, value_json, created_at in rows:
                    try:
                        conversation_data = json.loads(value_json)
                        # Extract first user message as title
                        title = "New conversation"
                        history = conversation_data.get("history", [])
                        if history:
                            first_exchange = history[0]
                            user_msg = first_exchange.get("user", {})
                            user_content = user_msg.get("content", {})
                            if "Prompt" in user_content:
                                prompt = user_content["Prompt"].get("prompt", "")
                                title = (
                                    prompt[:50] + "..." if len(prompt) > 50 else prompt
                                )

                        # Convert timestamp to human readable
                        from datetime import datetime

                        dt = datetime.fromtimestamp(created_at / 1000)
                        updated = dt.strftime("%Y-%m-%d %H:%M:%S")

                        sessions.append(
                            SessionInfo(
                                session_id=conversation_id, title=title, updated=updated
                            )
                        )
                    except (json.JSONDecodeError, KeyError):
                        continue

                return SessionListResult(success=True, sessions=sessions)

        except Exception as e:
            return SessionListResult(
                success=False, sessions=[], error_message=f"Error: {str(e)}"
            )

    def list_agents(self) -> AgentListResult:
        """List available agents and return structured result."""
        try:
            result = subprocess.run(
                ["kiro-cli", "agent", "list"],
                capture_output=True,
                text=True,
            )

            if result.returncode != 0:
                error_message = (result.stderr or "").strip() or "Failed to list agents"
                return AgentListResult(
                    success=False, agents=[], error_message=error_message
                )

            agents = self._parse_kiro_agent_list(result.stdout or "")
            return AgentListResult(success=True, agents=agents)

        except FileNotFoundError:
            return AgentListResult(
                success=False, agents=[], error_message=self.missing_command_error()
            )
        except Exception as e:
            return AgentListResult(
                success=False, agents=[], error_message=f"Error: {str(e)}"
            )

    def _parse_kiro_agent_list(self, output: str) -> list[AgentInfo]:
        """Parse kiro-cli agent list output."""
        agents: list[AgentInfo] = []

        for line in output.splitlines():
            line = line.strip()
            if not line:
                continue

            # Handle different formats:
            # "* agent_name    (Built-in)" for active/built-in agents
            # "agent_name    /path/to/agent" for custom agents
            if line.startswith("* "):
                # Active/built-in agent
                parts = line[2:].split()
                if parts:
                    name = parts[0]
                    agent_type = "Built-in" if "(Built-in)" in line else "Active"
                    agents.append(
                        AgentInfo(name=name, agent_type=agent_type, details=[])
                    )
            else:
                # Regular agent line
                parts = line.split(None, 1)  # Split on first whitespace
                if len(parts) >= 2:
                    name = parts[0]
                    path_or_type = parts[1]
                    agent_type = (
                        "Custom" if path_or_type.startswith("/") else "Built-in"
                    )
                    agents.append(
                        AgentInfo(
                            name=name,
                            agent_type=agent_type,
                            details=[path_or_type]
                            if path_or_type.startswith("/")
                            else [],
                        )
                    )
                elif len(parts) == 1:
                    # Just agent name
                    agents.append(
                        AgentInfo(name=parts[0], agent_type="Unknown", details=[])
                    )

        return agents

    # Methods for backward compatibility during migration
