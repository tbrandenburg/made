"""Codex CLI implementation of the AgentCLI interface."""

import json
import os
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


class CodexAgentCLI(AgentCLI):
    """Codex CLI implementation following the AgentCLI interface."""

    @property
    def cli_name(self) -> str:
        """Return the CLI name for error messages."""
        return "codex"

    def missing_command_error(self) -> str:
        """Return error message for missing CLI command."""
        return f"Error: '{self.cli_name}' command not found. Please ensure it is installed and in PATH."

    def _parse_codex_output(self, stdout: str) -> tuple[str | None, list[ResponsePart]]:
        """Parse codex JSON event stream for session ID and responses."""
        session_id = None
        response_parts = []

        for line in stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
                event_type = event.get("type", "")

                if event_type == "thread.started":
                    session_id = event.get("thread_id")
                elif event_type == "item.completed":
                    item = event.get("item", {})
                    text = item.get("text", "")
                    if text:
                        response_parts.append(
                            ResponsePart(
                                text=text,
                                timestamp=self._to_milliseconds(event.get("timestamp")),
                                part_type="final",
                            )
                        )
            except json.JSONDecodeError:
                continue

        return session_id, response_parts

    def _get_codex_sessions_directory(self) -> Path | None:
        """Get the path to Codex's session directory."""
        # Check environment variable first
        configured = os.environ.get("CODEX_SESSION_PATH")
        if configured and Path(configured).expanduser().exists():
            return Path(configured).expanduser()

        # Fallback to standard location
        codex_home = Path.home() / ".codex"
        sessions_dir = codex_home / "sessions"
        return sessions_dir if sessions_dir.exists() else None

    def _to_milliseconds(self, raw_value: Any) -> int | None:
        """Convert value to milliseconds timestamp."""
        if raw_value is None:
            return None
        if isinstance(raw_value, str):
            try:
                return int(float(raw_value))
            except ValueError:
                try:
                    dt = datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
                except ValueError:
                    return None
                return int(dt.timestamp() * 1000)
        try:
            return int(float(raw_value))
        except (TypeError, ValueError):
            return None

    def _session_matches_directory(self, session_id: str, cwd: Path) -> bool:
        """Check whether a session belongs to the provided working directory."""
        sessions_dir = self._get_codex_sessions_directory()
        if not sessions_dir:
            return False

        # Resolve the provided cwd to absolute path for comparison
        target_cwd = cwd.resolve()

        # Scan date-based directory structure for session files
        for year_dir in sessions_dir.iterdir():
            if not year_dir.is_dir():
                continue
            for month_dir in year_dir.iterdir():
                if not month_dir.is_dir():
                    continue
                for day_dir in month_dir.iterdir():
                    if not day_dir.is_dir():
                        continue
                    for session_file in day_dir.glob("rollout-*.jsonl"):
                        if session_id in session_file.name:
                            # Found matching session file, now check workspace
                            try:
                                with open(session_file, "r", encoding="utf-8") as f:
                                    # Read first line to get session metadata
                                    first_line = f.readline().strip()
                                    if first_line:
                                        event = json.loads(first_line)
                                        if event.get("type") == "session_meta":
                                            payload = event.get("payload", {})
                                            session_cwd = payload.get("cwd")
                                            if session_cwd:
                                                session_path = Path(
                                                    session_cwd
                                                ).resolve()
                                                # Check if session was created in target directory or subdirectory
                                                return (
                                                    session_path == target_cwd
                                                    or target_cwd
                                                    in session_path.parents
                                                    or session_path
                                                    in target_cwd.parents
                                                )
                            except (json.JSONDecodeError, FileNotFoundError, Exception):
                                # If we can't read the session metadata, don't include it
                                continue
                            return False
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
            # Build command inline - using stdin pattern like other CLIs
            # Note: Removed hardcoded --sandbox flag to use codex config defaults
            command = ["codex", "exec"]

            # Add session resumption using 'resume' subcommand if session exists
            if session_id and self._session_matches_directory(session_id, cwd):
                command.extend(["resume", session_id])

            # Add JSON output flag (no message argument - passed via stdin)
            command.append("--json")

            if cancel_event and cancel_event.is_set():
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message="Agent request cancelled.",
                )

            if cancel_event is None and on_process is None:
                process = subprocess.run(
                    command, capture_output=True, text=True, cwd=cwd, input=message
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

                input_data: str | None = message  # Pass message via stdin initially
                while True:
                    try:
                        stdout, stderr = process.communicate(
                            input=input_data, timeout=0.1
                        )
                        break
                    except subprocess.TimeoutExpired:
                        input_data = None  # Only send message once
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
                # Process management only - extract session_id but no parsing
                extracted_session_id = session_id  # Default to input session_id
                if stdout:
                    for line in stdout.strip().split("\n"):
                        if line:
                            try:
                                data = json.loads(line)
                                if isinstance(data, dict) and "sessionId" in data:
                                    extracted_session_id = str(data["sessionId"])
                                    break
                            except json.JSONDecodeError:
                                continue

                # Generate session_id if none provided and none extracted
                if not extracted_session_id:
                    extracted_session_id = f"codex-{int(datetime.now().timestamp())}"

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

    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        """Export session history and return structured result."""
        try:
            sessions_dir = self._get_codex_sessions_directory()
            if not sessions_dir:
                return ExportResult(
                    success=False,
                    session_id=session_id,
                    messages=[],
                    error_message="Codex session directory not found",
                )

            # Scan ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl files
            session_file = None
            for year_dir in sessions_dir.iterdir():
                if not year_dir.is_dir():
                    continue
                for month_dir in year_dir.iterdir():
                    if not month_dir.is_dir():
                        continue
                    for day_dir in month_dir.iterdir():
                        if not day_dir.is_dir():
                            continue
                        for rollout_file in day_dir.glob("rollout-*.jsonl"):
                            if session_id in rollout_file.name:
                                session_file = rollout_file
                                break
                        if session_file:
                            break
                    if session_file:
                        break
                if session_file:
                    break

            if not session_file or not session_file.exists():
                return ExportResult(
                    success=False,
                    session_id=session_id,
                    messages=[],
                    error_message=f"Session {session_id} not found",
                )

            messages = self._parse_session_jsonl(session_file)

            return ExportResult(success=True, session_id=session_id, messages=messages)

        except Exception as e:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Error: {str(e)}",
            )

    def _parse_session_jsonl(self, session_file: Path) -> list[HistoryMessage]:
        """Parse Codex session JSONL file into HistoryMessage objects."""
        messages: list[HistoryMessage] = []

        try:
            with open(session_file, "r", encoding="utf-8") as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        event = json.loads(line)
                        event_type = event.get("type", "")

                        # Convert timestamp if present
                        timestamp_ms = None
                        if "timestamp" in event:
                            timestamp_ms = self._to_milliseconds(event["timestamp"])

                        # Process response_item events into messages (real codex format)
                        if event_type == "response_item":
                            payload = event.get("payload", {})
                            if payload.get("type") == "message":
                                role = payload.get("role", "assistant")
                                if role not in {"user", "assistant"}:
                                    continue
                                text = ""

                                # Extract text from content array
                                content_items = payload.get("content", [])
                                for content_item in content_items:
                                    content_type = content_item.get("type", "")
                                    if content_type in ["input_text", "output_text"]:
                                        text += content_item.get("text", "")

                                if text:
                                    messages.append(
                                        HistoryMessage(
                                            message_id=f"codex-{line_num}",
                                            role=role,
                                            content_type="text",
                                            content=text,
                                            timestamp=timestamp_ms,
                                        )
                                    )
                        elif event_type == "item.completed":
                            item = event.get("item", {})
                            text = item.get("text", "")
                            if text:
                                messages.append(
                                    HistoryMessage(
                                        message_id=f"item-{line_num}",
                                        role="assistant",
                                        content_type="text",
                                        content=text,
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
            sessions_dir = self._get_codex_sessions_directory()
            if not sessions_dir:
                return SessionListResult(
                    success=False,
                    sessions=[],
                    error_message="Codex session directory not found",
                )

            sessions = []

            # Scan date-based directory structure for session files
            if sessions_dir.exists():
                for year_dir in sessions_dir.iterdir():
                    if not year_dir.is_dir():
                        continue
                    for month_dir in year_dir.iterdir():
                        if not month_dir.is_dir():
                            continue
                        for day_dir in month_dir.iterdir():
                            if not day_dir.is_dir():
                                continue
                            for session_file in day_dir.glob("rollout-*.jsonl"):
                                if not session_file.is_file():
                                    continue

                                # Extract session ID from filename
                                session_id = (
                                    session_file.stem
                                )  # removes .jsonl extension

                                # Filter by workspace if cwd provided
                                if cwd and not self._session_matches_directory(
                                    session_id, cwd
                                ):
                                    continue

                                # Extract title from first message
                                title = "New conversation"
                                updated = "Unknown"

                                try:
                                    # Get file modification time
                                    mtime = session_file.stat().st_mtime
                                    dt = datetime.fromtimestamp(mtime)
                                    updated = dt.strftime("%Y-%m-%d %H:%M:%S")

                                    # Try to get title from first message in session
                                    with open(session_file, "r", encoding="utf-8") as f:
                                        for line in f:
                                            line = line.strip()
                                            if not line:
                                                continue
                                            try:
                                                event = json.loads(line)
                                                # Look for the first user message or content
                                                if event.get("type") == "response_item":
                                                    content = event.get("content", {})
                                                    parts = content.get("parts", [])
                                                    for part in parts:
                                                        if part.get("type") == "text":
                                                            text = part.get("text", "")
                                                            if text:
                                                                title = (
                                                                    text[:50] + "..."
                                                                    if len(text) > 50
                                                                    else text
                                                                )
                                                                break
                                                    if title != "New conversation":
                                                        break
                                                elif (
                                                    event.get("type")
                                                    == "item.completed"
                                                ):
                                                    item = event.get("item", {})
                                                    text = item.get("text", "")
                                                    if text:
                                                        title = (
                                                            text[:50] + "..."
                                                            if len(text) > 50
                                                            else text
                                                        )
                                                        break
                                            except json.JSONDecodeError:
                                                continue

                                except Exception:
                                    pass

                                sessions.append(
                                    SessionInfo(
                                        session_id=session_id,
                                        title=title,
                                        updated=updated,
                                    )
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
            # Codex CLI doesn't have explicit agent listing like Kiro
            # Return a default agent representing Codex itself
            agents = [
                AgentInfo(
                    name="codex",
                    agent_type="Built-in",
                    details=["Codex Cloud - Advanced AI Agent"],
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
