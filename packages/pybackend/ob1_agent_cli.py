from __future__ import annotations

import json
import logging
import shlex
import subprocess
from pathlib import Path
from threading import Event
from typing import Callable, Any

from agent_cli import AgentCLI
from agent_results import (
    RunResult,
    ExportResult,
    SessionListResult,
    AgentListResult,
    ResponsePart,
    HistoryMessage,
    SessionInfo,
    AgentInfo,
)

logger = logging.getLogger(__name__)


class OB1AgentCLI(AgentCLI):
    """OB1 AgentCLI implementation."""

    @property
    def cli_name(self) -> str:
        return "ob1"

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
        """Run OB1 with message and return structured result."""

        # Build OB1 command with proper argument quoting
        cmd = ["ob1", "--output-format", "json", "--prompt", shlex.quote(message)]

        if session_id:
            cmd.extend(["--resume", shlex.quote(session_id)])
        if model:
            cmd.extend(["--model", shlex.quote(model)])

        logger.info(
            "OB1 CLI operation starting (session: %s, model: %s)",
            session_id or "<new>",
            model or "<default>",
        )

        try:
            process = subprocess.Popen(
                cmd,
                cwd=str(cwd),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            if on_process:
                on_process(process)

            # Handle cancellation
            if cancel_event and cancel_event.is_set():
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message="Agent request cancelled.",
                )

            stdout, stderr = process.communicate()

            if process.returncode != 0:
                error_msg = (stderr or "").strip() or "Command failed with no output"
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message=f"CLI failed: {error_msg}",
                )

            # Parse OB1 JSON response
            return self._parse_ob1_response(stdout, session_id)

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

    def _parse_ob1_response(self, stdout: str, session_id: str | None) -> RunResult:
        """Parse OB1 JSON output into RunResult."""
        try:
            # OB1 outputs JSON on the last line
            lines = [line for line in stdout.splitlines() if line.strip()]
            if not lines:
                return RunResult(
                    success=False,
                    session_id=session_id,
                    response_parts=[],
                    error_message="No output from OB1",
                )

            json_line = lines[-1]
            data = json.loads(json_line)

            # Extract response content from OB1 JSON format
            content = data.get("content", "")
            extracted_session_id = data.get("session_id") or session_id

            # Create response part
            response_part = ResponsePart(
                text=content,
                timestamp=None,  # OB1 doesn't provide timestamp in response
                part_type="final",
                part_id=None,
                call_id=None,
            )

            return RunResult(
                success=True,
                session_id=extracted_session_id,
                response_parts=[response_part],
                error_message=None,
            )

        except json.JSONDecodeError as e:
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message=f"Failed to parse OB1 response: {str(e)}",
            )
        except Exception as e:
            return RunResult(
                success=False,
                session_id=session_id,
                response_parts=[],
                error_message=f"Error parsing OB1 output: {str(e)}",
            )

    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        """Export session history and return structured result."""
        try:
            # Discover OB1 session files in ~/.ob1/tmp/{project}/chats/
            session_files = self._find_ob1_session_files(cwd)

            for session_file in session_files:
                if session_id in str(session_file):
                    with open(session_file, "r") as f:
                        session_data = json.load(f)

                    messages = self._parse_ob1_session_data(session_data)

                    return ExportResult(
                        success=True,
                        session_id=session_id,
                        messages=messages,
                        error_message=None,
                    )

            # Session not found
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Session '{session_id}' not found",
            )

        except FileNotFoundError:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=self.missing_command_error(),
            )
        except Exception as e:
            return ExportResult(
                success=False,
                session_id=session_id,
                messages=[],
                error_message=f"Error: {str(e)}",
            )

    def _find_ob1_session_files(self, cwd: Path | None) -> list[Path]:
        """Find OB1 session files in ~/.ob1/tmp/ directory structure."""
        from os.path import expanduser

        ob1_dir = Path(expanduser("~")) / ".ob1" / "tmp"
        session_files = []

        if ob1_dir.exists():
            # Look for session files in project subdirectories
            for project_dir in ob1_dir.iterdir():
                if project_dir.is_dir():
                    chats_dir = project_dir / "chats"
                    if chats_dir.exists():
                        session_files.extend(chats_dir.glob("session-*.json"))

        return session_files

    def _parse_ob1_session_data(
        self, session_data: dict[str, Any]
    ) -> list[HistoryMessage]:
        """Parse OB1 session data into HistoryMessage objects."""
        messages = []

        # OB1 session format (based on POC findings)
        exchanges = session_data.get("exchanges", [])

        for exchange in exchanges:
            # User message
            user_msg = exchange.get("user", {})
            if user_msg:
                messages.append(
                    HistoryMessage(
                        message_id=None,
                        role="user",
                        content_type="text",
                        content=user_msg.get("content", ""),
                        timestamp=user_msg.get("timestamp_ms"),
                    )
                )

            # Assistant message
            assistant_msg = exchange.get("assistant", {})
            if assistant_msg:
                messages.append(
                    HistoryMessage(
                        message_id=None,
                        role="assistant",
                        content_type="text",
                        content=assistant_msg.get("content", ""),
                        timestamp=assistant_msg.get("timestamp_ms"),
                    )
                )

        return messages

    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        """List available sessions and return structured result."""
        try:
            session_files = self._find_ob1_session_files(cwd)
            sessions = []

            for session_file in session_files:
                # Extract session ID from filename (e.g., "session-abc123.json")
                session_id = session_file.stem.replace("session-", "")

                try:
                    with open(session_file, "r") as f:
                        session_data = json.load(f)

                    # Extract session info
                    created_at = session_data.get("created_at", "Unknown")

                    sessions.append(
                        SessionInfo(
                            session_id=session_id,
                            title=f"OB1 Session {session_id[:8]}",  # Short title
                            updated=created_at or "Unknown",
                        )
                    )

                except (json.JSONDecodeError, Exception):
                    # Skip corrupted session files
                    continue

            return SessionListResult(
                success=True,
                sessions=sessions,
                error_message=None,
            )

        except FileNotFoundError:
            return SessionListResult(
                success=False,
                sessions=[],
                error_message=self.missing_command_error(),
            )
        except Exception as e:
            return SessionListResult(
                success=False,
                sessions=[],
                error_message=f"Error: {str(e)}",
            )

    def list_agents(self, cwd: Path | None = None) -> AgentListResult:
        """List available agents and return structured result."""
        try:
            # OB1 supports multiple models, but we return a single "ob1" agent
            # as the CLI handles model selection internally
            agents = [
                AgentInfo(
                    name="ob1",
                    agent_type="Multi-Model",
                    details=["300+ models available via --model parameter"],
                )
            ]

            return AgentListResult(
                success=True,
                agents=agents,
                error_message=None,
            )

        except FileNotFoundError:
            return AgentListResult(
                success=False,
                agents=[],
                error_message=self.missing_command_error(),
            )
        except Exception as e:
            return AgentListResult(
                success=False,
                agents=[],
                error_message=f"Error: {str(e)}",
            )
