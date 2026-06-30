from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
import subprocess
import json
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
)

logger = logging.getLogger(__name__)

SESSION_ROW_PATTERN = re.compile(r"^(ses_[^\s]+)\s{2,}(.*?)\s{2,}(.+)$")
AGENT_ROW_PATTERN = re.compile(r"^(?P<name>\S+)\s+\((?P<kind>[^)]+)\)\s*$")


class AgentCLI(ABC):
    @classmethod
    @abstractmethod
    def main_executable_name(cls) -> str:
        """Return the primary executable used to start this CLI."""
        raise NotImplementedError

    @property
    @abstractmethod
    def cli_name(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def build_prompt_command(self, prompt: str) -> list[str]:
        """Build a base command used to send a prompt."""
        raise NotImplementedError

    def prompt_via_stdin(self) -> bool:
        """Whether the base prompt command expects prompt content on stdin."""
        return False

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
    def list_agents(self, cwd: Path | None = None) -> AgentListResult:
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
            # Check for tool name first
            tool_name = None
            for key in ("tool", "name"):
                if part.get(key):
                    tool_name = str(part[key])
                    break

            if tool_name:
                # Format with arguments if available (following Kiro pattern)
                tool_args = part.get("args", {})
                if tool_args:
                    tool_info = [f"Tool: {tool_name}"]
                    for key, value in tool_args.items():
                        value_str = str(value)
                        if len(value_str) > 90:
                            value_str = value_str[:90] + "..."
                        tool_info.append(f"  {key}: {value_str}")
                    return "\n".join(tool_info)
                else:
                    return f"Tool: {tool_name}"

            # Fallback to ID if no name found
            if part.get("id"):
                return str(part["id"])
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
