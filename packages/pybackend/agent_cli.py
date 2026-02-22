from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
import subprocess
import json
import tempfile
import re
import logging
from threading import Event
from typing import Callable

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

SESSION_ROW_PATTERN = re.compile(r"^(ses_[^\s]+)\s{2,}(.*?)\s{2,}(.+)$")
AGENT_ROW_PATTERN = re.compile(r"^(?P<name>\S+)\s+\((?P<kind>[^)]+)\)\s*$")


class AgentCLI(ABC):
    @property
    @abstractmethod
    def cli_name(self) -> str:
        raise NotImplementedError

    def missing_command_error(self) -> str:
        return (
            f"Error: '{self.cli_name}' command not found. "
            "Please ensure it is installed and in PATH."
        )

    @abstractmethod
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
        raise NotImplementedError

    @abstractmethod
    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        """Export session history and return structured result."""
        raise NotImplementedError

    @abstractmethod
    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        """List available sessions and return structured result."""
        raise NotImplementedError

    @abstractmethod
    def list_agents(self) -> AgentListResult:
        """List available agents and return structured result."""
        raise NotImplementedError

    def _to_milliseconds(self, raw_value: object) -> int | None:
        """Convert value to milliseconds timestamp."""
        try:
            return int(float(raw_value))
        except (TypeError, ValueError):
            return None

    def _extract_part_content(self, part: dict[str, object], part_type: str) -> str:
        """Extract content from a response part."""
        if part_type in {"text"}:
            return str(part.get("text") or "")
        if part_type in {"reasoning"}:
            return str(part.get("text") or "")
        if part_type in {"tool_use", "tool"}:
            for key in ("tool", "name", "id"):
                if part.get(key):
                    return str(part[key])
            return ""
        return ""

    def _parse_opencode_output(
        self, stdout: str
    ) -> tuple[str | None, list[ResponsePart]]:
        """Parse opencode JSON output into structured response parts."""
        session_id = None
        parts: list[dict[str, object]] = []

        for line in stdout.splitlines():
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue

            payload_session_id = payload.get("sessionID")
            if payload_session_id:
                session_id = payload_session_id

            payload_type = payload.get("type")
            payload_timestamp = payload.get("timestamp")
            part = payload.get("part") or {}

            part_id = part.get("id")
            call_id = part.get("callID") or part.get("callId")

            if payload_type == "text":
                text = self._extract_part_content(part, "text")
                # Include all text parts, even empty ones, to maintain conversation flow
                parts.append(
                    {
                        "kind": "text",
                        "content": text,
                        "timestamp": payload_timestamp,
                        "part_id": part_id,
                        "call_id": call_id,
                    }
                )
            elif payload_type == "reasoning":
                reasoning_text = self._extract_part_content(part, "reasoning")
                # Reasoning content should be treated as thinking
                parts.append(
                    {
                        "kind": "reasoning",
                        "content": reasoning_text,
                        "timestamp": payload_timestamp,
                        "part_id": part_id,
                        "call_id": call_id,
                    }
                )
            elif payload_type in {"tool_use", "tool"}:
                tool_name = self._extract_part_content(part, payload_type)
                if tool_name:  # Only include tools if they have content
                    parts.append(
                        {
                            "kind": "tool",
                            "content": tool_name,
                            "timestamp": payload_timestamp,
                            "part_id": part_id,
                            "call_id": call_id,
                        }
                    )

        if not parts:
            return session_id, []

        response_parts: list[ResponsePart] = []
        text_indices = [
            index for index, part in enumerate(parts) if part.get("kind") == "text"
        ]

        for index, part in enumerate(parts):
            kind = part.get("kind")
            content = str(part.get("content", ""))
            raw_timestamp = part.get("timestamp")
            timestamp = self._to_milliseconds(raw_timestamp)

            if kind == "text":
                part_type = (
                    "final"
                    if text_indices and index == text_indices[-1]
                    else "thinking"
                )
            elif kind == "reasoning":
                part_type = "thinking"
            else:
                part_type = "tool"

            response_parts.append(
                ResponsePart(
                    text=content,
                    timestamp=timestamp,
                    part_type=part_type,
                    part_id=part.get("part_id"),
                    call_id=part.get("call_id"),
                )
            )

        return session_id, response_parts


class OpenCodeAgentCLI(AgentCLI):
    @property
    def cli_name(self) -> str:
        return "opencode"

    def _to_milliseconds(self, raw_value: object) -> int | None:
        """Convert value to milliseconds timestamp."""
        try:
            return int(float(raw_value))
        except (TypeError, ValueError):
            return None

    def _extract_part_content(self, part: dict[str, object], part_type: str) -> str:
        """Extract content from a response part."""
        if part_type in {"text"}:
            return str(part.get("text") or "")
        if part_type in {"tool_use", "tool"}:
            for key in ("tool", "name", "id"):
                if part.get(key):
                    return str(part[key])
            return ""
        return ""

    def _parse_opencode_output(
        self, stdout: str
    ) -> tuple[str | None, list[ResponsePart]]:
        """Parse opencode JSON output into structured response parts."""
        session_id = None
        parts: list[dict[str, object]] = []

        for line in stdout.splitlines():
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue

            payload_session_id = payload.get("sessionID")
            if payload_session_id:
                session_id = payload_session_id

            payload_type = payload.get("type")
            payload_timestamp = payload.get("timestamp")
            part = payload.get("part") or {}

            part_id = part.get("id")
            call_id = part.get("callID") or part.get("callId")

            if payload_type == "text":
                text = self._extract_part_content(part, "text")
                # Include all text parts, even empty ones, to maintain conversation flow
                parts.append(
                    {
                        "kind": "text",
                        "content": text,
                        "timestamp": payload_timestamp,
                        "part_id": part_id,
                        "call_id": call_id,
                    }
                )
            elif payload_type in {"tool_use", "tool"}:
                tool_name = self._extract_part_content(part, payload_type)
                if tool_name:  # Only include tools if they have content
                    parts.append(
                        {
                            "kind": "tool",
                            "content": tool_name,
                            "timestamp": payload_timestamp,
                            "part_id": part_id,
                            "call_id": call_id,
                        }
                    )

        if not parts:
            return session_id, []

        response_parts: list[ResponsePart] = []
        text_indices = [
            index for index, part in enumerate(parts) if part.get("kind") == "text"
        ]

        for index, part in enumerate(parts):
            kind = part.get("kind")
            content = str(part.get("content", ""))
            raw_timestamp = part.get("timestamp")
            timestamp = self._to_milliseconds(raw_timestamp)

            if kind == "text":
                part_type = (
                    "final"
                    if text_indices and index == text_indices[-1]
                    else "thinking"
                )
            else:
                part_type = "tool"

            response_parts.append(
                ResponsePart(
                    text=content,
                    timestamp=timestamp,
                    part_type=part_type,
                    part_id=part.get("part_id"),
                    call_id=part.get("call_id"),
                )
            )

        return session_id, response_parts

    def _parse_session_table(self, output: str, limit: int) -> list[SessionInfo]:
        """Parse session list table output."""
        sessions: list[SessionInfo] = []
        for line in output.splitlines():
            stripped = line.strip()
            if (
                not stripped
                or stripped.startswith("Session ID")
                or stripped.startswith("─")
            ):
                continue

            match = SESSION_ROW_PATTERN.match(stripped)
            if not match:
                logger.debug("Skipping non-matching session row: %s", stripped)
                continue

            session_id, title, updated = match.groups()
            sessions.append(
                SessionInfo(
                    session_id=session_id.strip(),
                    title=title.strip(),
                    updated=updated.strip(),
                )
            )

            if len(sessions) >= limit:
                break

        return sessions

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

    def _parse_export_messages(
        self, messages: list[dict[str, object]], start_timestamp: int | None
    ) -> list[HistoryMessage]:
        """Parse exported messages into structured history."""
        history: list[HistoryMessage] = []

        for message in messages:
            message_info = message.get("info") or {}
            role = message_info.get("role")
            if role not in {"user", "assistant"}:
                continue

            message_timestamp = self._resolve_message_timestamp(message_info)

            for part in message.get("parts") or []:
                part_type = part.get("type")
                if part_type not in {"text", "tool_use", "tool"}:
                    continue

                part_timestamp = self._resolve_part_timestamp(part, message_timestamp)
                if start_timestamp is not None and part_timestamp is not None:
                    if part_timestamp < start_timestamp:
                        continue

                history.append(
                    HistoryMessage(
                        message_id=message_info.get("id"),
                        role=role,
                        content_type=part_type,
                        content=self._extract_part_content(part, part_type),
                        timestamp=part_timestamp,
                        part_id=part.get("id"),
                        call_id=part.get("callID") or part.get("callId"),
                    )
                )

        return history

    def _resolve_message_timestamp(self, message_info: dict[str, object]) -> int | None:
        """Extract timestamp from message info."""
        time_info = message_info.get("time") or {}
        if not isinstance(time_info, dict):
            return None

        for key in ("created", "start", "completed", "end", "updated"):
            resolved = self._to_milliseconds(time_info.get(key))
            if resolved is not None:
                return resolved
        return None

    def _resolve_part_timestamp(
        self, part: dict[str, object], fallback: int | None
    ) -> int | None:
        """Extract timestamp from part info."""
        time_info = part.get("time") or {}
        if isinstance(time_info, dict):
            for key in ("end", "start"):
                resolved = self._to_milliseconds(time_info.get(key))
                if resolved is not None:
                    return resolved

        state = part.get("state")
        if isinstance(state, dict):
            state_time = state.get("time") or {}
            if isinstance(state_time, dict):
                for key in ("end", "start"):
                    resolved = self._to_milliseconds(state_time.get(key))
                    if resolved is not None:
                        return resolved

        resolved = self._to_milliseconds(part.get("timestamp"))
        if resolved is not None:
            return resolved

        return fallback

    def _parse_export_messages(
        self, messages: list[dict[str, object]], start_timestamp: int | None
    ) -> list[HistoryMessage]:
        """Parse exported messages into structured history."""
        history: list[HistoryMessage] = []

        for message in messages:
            message_info = message.get("info") or {}
            role = message_info.get("role")
            if role not in {"user", "assistant"}:
                continue

            message_timestamp = self._resolve_message_timestamp(message_info)

            for part in message.get("parts") or []:
                part_type = part.get("type")
                if part_type not in {"text", "tool_use", "tool"}:
                    continue

                part_timestamp = self._resolve_part_timestamp(part, message_timestamp)
                if start_timestamp is not None and part_timestamp is not None:
                    if part_timestamp < start_timestamp:
                        continue

                history.append(
                    HistoryMessage(
                        message_id=message_info.get("id"),
                        role=role,
                        content_type=part_type,
                        content=self._extract_part_content(part, part_type),
                        timestamp=part_timestamp,
                        part_id=part.get("id"),
                        call_id=part.get("callID") or part.get("callId"),
                    )
                )

        return history

    # New typed methods
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
                # Process management only - extract session_id but no parsing
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
                    import time

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

    def _extract_part_content(self, part: dict[str, object], part_type: str) -> str:
        """Extract content from a response part."""
        if part_type in {"text"}:
            return str(part.get("text") or "")
        if part_type in {"tool_use", "tool"}:
            for key in ("tool", "name", "id"):
                if part.get(key):
                    return str(part[key])
            return ""
        return ""

    def export_session(self, session_id: str, cwd: Path | None) -> ExportResult:
        """Export session history and return structured result."""
        try:
            with tempfile.NamedTemporaryFile(
                mode="w+", encoding="utf-8", delete=True
            ) as tmp:
                result = subprocess.run(
                    ["opencode", "export", session_id],
                    stdout=tmp,
                    stderr=subprocess.PIPE,
                    text=True,
                    cwd=cwd,
                )

                if result.returncode != 0:
                    error_message = (
                        result.stderr or ""
                    ).strip() or "Failed to export session history"
                    return ExportResult(
                        success=False,
                        session_id=session_id,
                        messages=[],
                        error_message=error_message,
                    )

                tmp.flush()
                tmp.seek(0)
                try:
                    export_payload = json.load(tmp)
                except json.JSONDecodeError:
                    return ExportResult(
                        success=False,
                        session_id=session_id,
                        messages=[],
                        error_message="Invalid export data returned by opencode",
                    )

                messages = export_payload.get("messages") or []
                parsed_messages = self._parse_export_messages(messages, None)

                return ExportResult(
                    success=True, session_id=session_id, messages=parsed_messages
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

    def list_sessions(self, cwd: Path | None) -> SessionListResult:
        """List available sessions and return structured result."""
        try:
            result = subprocess.run(
                ["opencode", "session", "list"],
                capture_output=True,
                text=True,
                cwd=cwd,
            )

            if result.returncode != 0:
                error_message = (
                    result.stderr or ""
                ).strip() or "Failed to list sessions"
                return SessionListResult(
                    success=False, sessions=[], error_message=error_message
                )

            sessions = self._parse_session_table(
                result.stdout or "", 50
            )  # Default limit
            return SessionListResult(success=True, sessions=sessions)

        except FileNotFoundError:
            return SessionListResult(
                success=False, sessions=[], error_message=self.missing_command_error()
            )
        except Exception as e:
            return SessionListResult(
                success=False, sessions=[], error_message=f"Error: {str(e)}"
            )

    def list_agents(self) -> AgentListResult:
        """List available agents and return structured result."""
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

    # Legacy methods for backward compatibility
