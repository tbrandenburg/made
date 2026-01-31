"""Copilot CLI implementation of the AgentCLI interface."""

import json
import os
import re
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
    ResponsePart,
    RunResult,
    SessionInfo,
    SessionListResult,
)


class CopilotAgentCLI(AgentCLI):
    """Copilot CLI implementation following the AgentCLI interface."""

    @property
    def cli_name(self) -> str:
        """Return the CLI name for error messages."""
        return "copilot"

    def missing_command_error(self) -> str:
        """Return error message for missing CLI command."""
        return f"Error: '{self.cli_name}' command not found. Please ensure it is installed and in PATH."

    def _strip_ansi_codes(self, text: str) -> str:
        """Remove ANSI escape sequences from text."""
        ansi_escape = re.compile(r"\x1b\[[0-9;]*m")
        return ansi_escape.sub("", text)

    def _clean_response_text(self, text: str) -> str:
        """Normalize copilot CLI output for display."""
        cleaned = self._strip_ansi_codes(text)
        if not cleaned:
            return cleaned

        # Remove common Copilot CLI prefixes and formatting
        cleaned = re.sub(r"(?m)^>\s*", "", cleaned)
        cleaned = re.sub(r"(?m)^\([^)]*\)\s*", "", cleaned)
        return cleaned.strip()

    def _get_sessions_directory(self) -> Path | None:
        """Get the path to Copilot's session state directory."""
        # Check environment variable first
        configured = os.environ.get("COPILOT_SESSION_PATH")
        if configured and Path(configured).expanduser().exists():
            return Path(configured).expanduser()

        # Fallback to standard location
        copilot_home = Path.home() / ".copilot"
        sessions_dir = copilot_home / "session-state"
        return sessions_dir if sessions_dir.exists() else None

    def _get_directory_key(self, cwd: Path) -> str:
        """Get the directory key for session queries."""
        return str(cwd.resolve())

    def _to_milliseconds(self, raw_value: Any) -> int | None:
        """Convert value to milliseconds timestamp."""
        try:
            return int(float(raw_value))
        except (TypeError, ValueError):
            return None

    def _session_matches_directory(self, session_id: str, cwd: Path) -> bool:
        """Check whether a session belongs to the provided working directory."""
        sessions_dir = self._get_sessions_directory()
        if not sessions_dir:
            return False

        # Copilot CLI session directories are named with session IDs
        session_path = sessions_dir / session_id
        return session_path.exists()

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
            # Build command inline - following GitHub Copilot CLI patterns
            command = ["copilot", "-p", message, "--allow-all-tools", "--silent"]
            if session_id and self._session_matches_directory(session_id, cwd):
                command.extend(["--resume", session_id])

            if cancel_event and cancel_event.is_set():
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message="Agent request cancelled.",
                )

            if cancel_event is None and on_process is None:
                process = subprocess.run(
                    command, capture_output=True, text=True, cwd=cwd
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

                input_data: str | None = None
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
                # Parse copilot CLI output - strip ANSI codes for clean display
                response_text = self._clean_response_text(stdout or "")
                response_parts = (
                    [
                        ResponsePart(
                            text=response_text, timestamp=None, part_type="final"
                        )
                    ]
                    if response_text
                    else []
                )

                return RunResult(
                    success=True,
                    session_id=session_id,  # Copilot doesn't return session ID in stdout
                    response_parts=response_parts,
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
            sessions_dir = self._get_sessions_directory()
            if not sessions_dir:
                return ExportResult(
                    success=False,
                    session_id=session_id,
                    messages=[],
                    error_message="Copilot session directory not found",
                )

            # Look for events.jsonl file in session directory
            session_path = sessions_dir / session_id
            events_file = session_path / "events.jsonl"

            if not events_file.exists():
                return ExportResult(
                    success=False,
                    session_id=session_id,
                    messages=[],
                    error_message=f"Session {session_id} not found",
                )

            messages = self._parse_events_jsonl(events_file)

            return ExportResult(success=True, session_id=session_id, messages=messages)

        except Exception as e:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Error: {str(e)}",
            )

    def _parse_events_jsonl(self, events_file: Path) -> list[HistoryMessage]:
        """Parse Copilot events.jsonl file into HistoryMessage objects."""
        messages: list[HistoryMessage] = []

        try:
            with open(events_file, "r", encoding="utf-8") as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        event = json.loads(line)
                        event_type = event.get("type", "")
                        event_data = event.get("data", {})

                        # Convert timestamp if present
                        timestamp_ms = None
                        if "timestamp" in event:
                            timestamp_ms = self._to_milliseconds(event["timestamp"])

                        # Process different event types
                        if event_type == "user.message":
                            content = event_data.get("content", "")
                            messages.append(
                                HistoryMessage(
                                    message_id=f"user-{line_num}",
                                    role="user",
                                    content_type="text",
                                    content=content,
                                    timestamp=timestamp_ms,
                                )
                            )
                        elif event_type == "assistant.message":
                            content = event_data.get("content", "")
                            messages.append(
                                HistoryMessage(
                                    message_id=f"assistant-{line_num}",
                                    role="assistant",
                                    content_type="text",
                                    content=content,
                                    timestamp=timestamp_ms,
                                )
                            )
                        elif event_type == "tool.execution_start":
                            tool_name = event_data.get("toolName", "unknown")
                            tool_info = f"Tool started: {tool_name}"
                            messages.append(
                                HistoryMessage(
                                    message_id=f"tool-start-{line_num}",
                                    role="assistant",
                                    content_type="tool",
                                    content=tool_info,
                                    timestamp=timestamp_ms,
                                )
                            )
                        elif event_type == "tool.execution_end":
                            tool_name = event_data.get("toolName", "unknown")
                            tool_info = f"Tool completed: {tool_name}"
                            if "result" in event_data:
                                tool_info += (
                                    f"\nResult: {str(event_data['result'])[:200]}"
                                )
                            messages.append(
                                HistoryMessage(
                                    message_id=f"tool-end-{line_num}",
                                    role="assistant",
                                    content_type="tool",
                                    content=tool_info,
                                    timestamp=timestamp_ms,
                                )
                            )
                    except json.JSONDecodeError:
                        # Skip malformed JSON lines
                        continue

        except FileNotFoundError:
            # Return empty list if file doesn't exist
            pass
        except Exception:
            # Return empty list on any other error
            pass

        return messages

    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        """List available sessions and return structured result."""
        try:
            sessions_dir = self._get_sessions_directory()
            if not sessions_dir:
                return SessionListResult(
                    success=False,
                    sessions=[],
                    error_message="Copilot session directory not found",
                )

            sessions = []

            # Scan session directories
            if sessions_dir.exists():
                for session_dir in sessions_dir.iterdir():
                    if not session_dir.is_dir():
                        continue

                    session_id = session_dir.name
                    events_file = session_dir / "events.jsonl"

                    if not events_file.exists():
                        continue

                    # Extract title from first user message
                    title = "New conversation"
                    updated = "Unknown"

                    try:
                        # Get file modification time
                        mtime = events_file.stat().st_mtime
                        dt = datetime.fromtimestamp(mtime)
                        updated = dt.strftime("%Y-%m-%d %H:%M:%S")

                        # Try to get title from first user message
                        with open(events_file, "r", encoding="utf-8") as f:
                            for line in f:
                                line = line.strip()
                                if not line:
                                    continue
                                try:
                                    event = json.loads(line)
                                    if event.get("type") == "user.message":
                                        content = event.get("data", {}).get(
                                            "content", ""
                                        )
                                        if content:
                                            title = (
                                                content[:50] + "..."
                                                if len(content) > 50
                                                else content
                                            )
                                        break
                                except json.JSONDecodeError:
                                    continue

                    except Exception:
                        pass

                    sessions.append(
                        SessionInfo(session_id=session_id, title=title, updated=updated)
                    )

            # Sort by updated time (newest first)
            sessions.sort(key=lambda s: s.updated, reverse=True)
            return SessionListResult(success=True, sessions=sessions)

        except Exception as e:
            return SessionListResult(
                success=False, sessions=[], error_message=f"Error: {str(e)}"
            )

    def list_agents(self) -> AgentListResult:
        """List available agents and return structured result."""
        try:
            # Copilot CLI doesn't have explicit agent listing like Kiro
            # Return a default agent representing Copilot itself
            agents = [
                AgentInfo(
                    name="copilot",
                    agent_type="Built-in",
                    details=["GitHub Copilot CLI - Claude Sonnet 4.5"],
                )
            ]
            return AgentListResult(success=True, agents=agents)

        except FileNotFoundError:
            return AgentListResult(
                success=False, agents=[], error_message=self.missing_command_error()
            )
        except Exception as e:
            return AgentListResult(
                success=False, agents=[], error_message=f"Error: {str(e)}"
            )
