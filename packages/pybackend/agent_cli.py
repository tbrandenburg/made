from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
import json
import logging
import re
import subprocess
import tempfile
from datetime import UTC, datetime
from typing import Callable


logger = logging.getLogger(__name__)
SESSION_ROW_PATTERN = re.compile(r"^(ses_[^\s]+)\s{2,}(.*?)\s{2,}(.+)$")
AGENT_ROW_PATTERN = re.compile(r"^(?P<name>\S+)\s+\((?P<kind>[^)]+)\)\s*$")
LOG_PREVIEW_LIMIT = 500


@dataclass(frozen=True)
class AgentResponsePart:
    text: str
    timestamp: str | None
    type: str | None
    part_id: str | None = None
    call_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "text": self.text,
        }
        if self.timestamp is not None:
            payload["timestamp"] = self.timestamp
        if self.type is not None:
            payload["type"] = self.type
        if self.part_id:
            payload["partId"] = self.part_id
        if self.call_id:
            payload["callId"] = self.call_id
        return payload


@dataclass(frozen=True)
class RunResult:
    success: bool
    response: str
    responses: list[AgentResponsePart]
    session_id: str | None
    error: str | None = None


@dataclass(frozen=True)
class SessionInfo:
    id: str
    title: str
    updated: str

    def to_dict(self) -> dict[str, str]:
        return {"id": self.id, "title": self.title, "updated": self.updated}


@dataclass(frozen=True)
class AgentInfo:
    name: str
    type: str
    details: list[str]

    def to_dict(self) -> dict[str, object]:
        return {"name": self.name, "type": self.type, "details": self.details}


@dataclass(frozen=True)
class ExportMessage:
    message_id: str | None
    role: str
    type: str
    content: str
    timestamp: str | None
    part_id: str | None = None
    call_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "messageId": self.message_id,
            "role": self.role,
            "type": self.type,
            "content": self.content,
        }
        if self.timestamp is not None:
            payload["timestamp"] = self.timestamp
        if self.part_id:
            payload["partId"] = self.part_id
        if self.call_id:
            payload["callId"] = self.call_id
        return payload


@dataclass(frozen=True)
class ExportResult:
    session_id: str
    messages: list[ExportMessage]


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
    def run_message(
        self,
        message: str,
        cwd: Path,
        session_id: str | None,
        agent: str | None,
        on_start: Callable[[subprocess.Popen], None] | None = None,
    ) -> RunResult:
        raise NotImplementedError

    @abstractmethod
    def export_session(
        self,
        session_id: str,
        cwd: Path | None,
        start_timestamp: int | float | str | None = None,
        channel: str | None = None,
    ) -> ExportResult:
        raise NotImplementedError

    @abstractmethod
    def list_sessions(self, cwd: Path | None, limit: int) -> list[SessionInfo]:
        raise NotImplementedError

    @abstractmethod
    def list_agents(self) -> list[AgentInfo]:
        raise NotImplementedError


class OpenCodeAgentCLI(AgentCLI):
    @property
    def cli_name(self) -> str:
        return "opencode"

    def build_run_command(self, session_id: str | None, agent: str | None) -> list[str]:
        command = ["opencode", "run"]
        if session_id:
            command.extend(["-s", session_id])
        if agent:
            command.extend(["--agent", agent])
        command.extend(["--format", "json"])
        return command

    def run_message(
        self,
        message: str,
        cwd: Path,
        session_id: str | None,
        agent: str | None,
        on_start: Callable[[subprocess.Popen], None] | None = None,
    ) -> RunResult:
        command = self.build_run_command(session_id, agent)
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
        )
        if on_start is not None:
            on_start(process)
        stdout, stderr = process.communicate(input=message)
        return self._build_run_result(stdout or "", stderr or "", process.returncode)

    def export_session(
        self,
        session_id: str,
        cwd: Path | None,
        start_timestamp: int | float | str | None = None,
        channel: str | None = None,
    ) -> ExportResult:
        if not session_id:
            raise ValueError("Session ID is required")

        normalized_start = (
            _to_milliseconds(start_timestamp) if start_timestamp is not None else None
        )

        with tempfile.NamedTemporaryFile(mode="w+", encoding="utf-8", delete=True) as tmp:
            result = subprocess.run(
                ["opencode", "export", session_id],
                stdout=tmp,
                stderr=subprocess.PIPE,
                text=True,
                cwd=cwd,
            )

            stderr_text = str(result.stderr or "")

            if result.returncode != 0:
                error_message = stderr_text.strip() or "Failed to export session history"
                logger.error(
                    "Exporting chat history failed (channel: %s, session: %s): %s",
                    channel or "<unspecified>",
                    session_id,
                    error_message,
                )
                raise RuntimeError(error_message)

            tmp.flush()
            tmp_path = Path(tmp.name)

            try:
                export_payload = _decode_json_file(tmp_path, channel, session_id)
            except ValueError as exc:
                tmp.seek(0)
                preview = tmp.read(600)
                _log_invalid_export_file(
                    channel, session_id, preview, stderr_text.strip()
                )
                raise exc

        messages = export_payload.get("messages") or []
        pruned_messages = _prune_export_payload({"messages": messages})["messages"]
        history_entries = _filter_export_messages(pruned_messages, normalized_start)
        return ExportResult(session_id=session_id, messages=history_entries)

    def list_sessions(self, cwd: Path | None, limit: int) -> list[SessionInfo]:
        result = subprocess.run(
            ["opencode", "session", "list"],
            capture_output=True,
            text=True,
            cwd=cwd,
        )

        stderr_text = str(result.stderr or "")

        if result.returncode != 0:
            error_message = stderr_text.strip() or "Failed to list sessions"
            logger.error(
                "Listing chat sessions failed (cwd: %s, code: %s, stderr: %s)",
                cwd,
                result.returncode,
                _preview_output(stderr_text),
            )
            raise RuntimeError(error_message)

        logger.debug(
            "Listing chat sessions succeeded (cwd: %s, stdout_bytes: %s, stderr_preview: %s)",
            cwd,
            len(result.stdout or ""),
            _preview_output(stderr_text),
        )

        return _parse_session_table(result.stdout or "", limit)

    def list_agents(self) -> list[AgentInfo]:
        result = subprocess.run(
            ["opencode", "agent", "list"],
            capture_output=True,
            text=True,
        )

        stderr_text = str(result.stderr or "")

        if result.returncode != 0:
            error_message = stderr_text.strip() or "Failed to list agents"
            logger.error(
                "Listing agents failed (code: %s, stderr: %s)",
                result.returncode,
                _preview_output(stderr_text),
            )
            raise RuntimeError(error_message)

        logger.debug(
            "Listing agents succeeded (stdout_bytes: %s, stderr_preview: %s)",
            len(result.stdout or ""),
            _preview_output(stderr_text),
        )

        return _parse_agent_list(result.stdout or "")

    def _build_run_result(
        self, stdout: str, stderr: str, returncode: int
    ) -> RunResult:
        if returncode == 0:
            session_id, responses = _parse_opencode_output(stdout)
            response_text = (
                "\n\n".join(part.text for part in responses)
                if responses
                else (stdout or "").strip()
            )
            return RunResult(
                success=True,
                response=response_text,
                responses=responses,
                session_id=session_id,
            )

        error_message = (stderr or "").strip() or None
        return RunResult(
            success=False,
            response="",
            responses=[],
            session_id=None,
            error=error_message,
        )


def _preview_output(raw_text: str, limit: int = LOG_PREVIEW_LIMIT) -> str:
    stripped = (raw_text or "").strip()
    if len(stripped) <= limit:
        return stripped

    return stripped[: limit - 3] + "..."


def _extract_part_content(part: dict[str, object], part_type: str) -> str:
    if part_type in {"text"}:
        return str(part.get("text") or "")

    if part_type in {"tool_use", "tool"}:
        for key in ("tool", "name", "id"):
            if part.get(key):
                return str(part[key])
        return ""

    return ""


def _parse_opencode_output(stdout: str) -> tuple[str | None, list[AgentResponsePart]]:
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
            text = _extract_part_content(part, "text")
            if text:
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
            tool_name = _extract_part_content(part, payload_type)
            if tool_name:
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

    responses: list[AgentResponsePart] = []
    text_indices = [
        index for index, part in enumerate(parts) if part.get("kind") == "text"
    ]

    for index, part in enumerate(parts):
        kind = part.get("kind")
        content = str(part.get("content", ""))
        raw_timestamp = part.get("timestamp")

        if kind == "text":
            message_type = (
                "final" if text_indices and index == text_indices[-1] else "thinking"
            )
            text_content = content
        else:
            message_type = "tool"
            text_content = content

        response = AgentResponsePart(
            text=text_content,
            timestamp=_format_timestamp(raw_timestamp),
            type=message_type,
            part_id=part.get("part_id"),
            call_id=part.get("call_id"),
        )

        responses.append(response)

    return session_id, responses


def _parse_session_table(output: str, limit: int) -> list[SessionInfo]:
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
            SessionInfo(id=session_id.strip(), title=title.strip(), updated=updated.strip())
        )

        if len(sessions) >= limit:
            break

    if not sessions:
        logger.warning(
            "No sessions parsed from opencode output (limit: %s, preview: %s)",
            limit,
            _preview_output(output),
        )

    return sessions


def _parse_agent_list(output: str) -> list[AgentInfo]:
    agents: list[AgentInfo] = []
    current_agent: AgentInfo | None = None

    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        match = AGENT_ROW_PATTERN.match(stripped)
        if match:
            current_agent = AgentInfo(
                name=match.group("name"),
                type=match.group("kind"),
                details=[],
            )
            agents.append(current_agent)
            continue

        if current_agent is not None:
            current_agent.details.append(stripped)

    if not agents:
        logger.warning("No agents parsed from opencode output")
    return agents


def _to_milliseconds(raw_value: object) -> int | None:
    try:
        return int(float(raw_value))
    except (TypeError, ValueError):
        return None


def _format_timestamp(raw_timestamp: int | float | str | None) -> str:
    try:
        timestamp_value = (
            float(raw_timestamp) / 1000 if raw_timestamp is not None else None
        )
    except (TypeError, ValueError):
        timestamp_value = None

    dt = (
        datetime.fromtimestamp(timestamp_value, tz=UTC)
        if timestamp_value is not None
        else datetime.now(UTC)
    )
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _format_timestamp_optional(raw_timestamp: int | float | str | None) -> str | None:
    millis = _to_milliseconds(raw_timestamp)
    if millis is None:
        return None

    dt = datetime.fromtimestamp(millis / 1000, tz=UTC)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _resolve_message_timestamp(message_info: dict[str, object]) -> int | None:
    time_info = message_info.get("time") or {}
    if not isinstance(time_info, dict):
        return None

    for key in ("created", "start", "completed", "end", "updated"):
        resolved = _to_milliseconds(time_info.get(key))
        if resolved is not None:
            return resolved
    return None


def _resolve_part_timestamp(
    part: dict[str, object], fallback: int | None
) -> int | None:
    time_info = part.get("time") or {}
    if isinstance(time_info, dict):
        for key in ("end", "start"):
            resolved = _to_milliseconds(time_info.get(key))
            if resolved is not None:
                return resolved

    state = part.get("state")
    if isinstance(state, dict):
        state_time = state.get("time") or {}
        if isinstance(state_time, dict):
            for key in ("end", "start"):
                resolved = _to_milliseconds(state_time.get(key))
                if resolved is not None:
                    return resolved

    resolved = _to_milliseconds(part.get("timestamp"))
    if resolved is not None:
        return resolved

    return fallback


def _filter_export_messages(
    messages: list[dict[str, object]], start_timestamp: int | None
) -> list[ExportMessage]:
    history: list[ExportMessage] = []

    for message in messages:
        message_info = message.get("info") or {}
        role = message_info.get("role")
        if role not in {"user", "assistant"}:
            continue

        message_timestamp = _resolve_message_timestamp(message_info)

        for part in message.get("parts") or []:
            part_type = part.get("type")
            if part_type not in {"text", "tool_use", "tool"}:
                continue

            part_timestamp = _resolve_part_timestamp(part, message_timestamp)
            if start_timestamp is not None and part_timestamp is not None:
                if part_timestamp < start_timestamp:
                    continue

            entry = ExportMessage(
                message_id=message_info.get("id"),
                role=role,
                type=part_type,
                content=_extract_part_content(part, part_type),
                timestamp=_format_timestamp_optional(part_timestamp),
                part_id=part.get("id"),
                call_id=part.get("callID") or part.get("callId"),
            )

            history.append(entry)

    return history


def _prune_export_payload(export_payload: dict[str, object]) -> dict[str, object]:
    """Strip export payload down to only the fields required for history reconstruction."""

    def _prune_time(time_obj: object) -> dict[str, object]:
        if not isinstance(time_obj, dict):
            return {}
        pruned = {
            key: time_obj[key]
            for key in ("created", "start", "completed", "end", "updated")
            if key in time_obj
        }
        return pruned

    def _prune_part(part: object) -> dict[str, object]:
        if not isinstance(part, dict):
            return {}
        pruned_part: dict[str, object] = {}
        part_type = part.get("type")
        if part_type:
            pruned_part["type"] = part_type

        for key in ("text", "tool", "name", "id", "timestamp", "callID", "callId"):
            if key in part:
                pruned_part[key] = part[key]

        time_info = _prune_time(part.get("time"))
        if time_info:
            pruned_part["time"] = time_info

        state = part.get("state")
        if isinstance(state, dict):
            state_time = _prune_time(state.get("time"))
            if state_time:
                pruned_part["state"] = {"time": state_time}

        return pruned_part

    def _prune_message(message: object) -> dict[str, object]:
        if not isinstance(message, dict):
            return {"info": {}, "parts": []}

        info = message.get("info") or {}
        parts = message.get("parts") or []

        pruned_info: dict[str, object] = {}
        for key in ("id", "role"):
            if key in info:
                pruned_info[key] = info[key]

        time_info = _prune_time(info.get("time"))
        if time_info:
            pruned_info["time"] = time_info

        return {
            "info": pruned_info,
            "parts": [_prune_part(part) for part in parts if isinstance(part, dict)],
        }

    messages = export_payload.get("messages") or []
    return {"messages": [_prune_message(message) for message in messages]}


def _decode_json_file(
    json_file: Path, channel: str | None, session_id: str
) -> dict[str, object]:
    """Parse clean JSON from a file."""
    try:
        with json_file.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        logger.error(
            "Invalid JSON export (channel: %s, session: %s): %s",
            channel or "<unspecified>",
            session_id,
            exc,
        )
        raise ValueError("Invalid export data returned by opencode") from exc


def _log_invalid_export_file(
    channel: str | None, session_id: str, stdout_preview: str, stderr_text: str
) -> None:
    logger.warning(
        (
            "Invalid export data while exporting chat history "
            "(channel: %s, session: %s). "
            "stdout sample: %r stderr first: %r stderr last: %r"
        ),
        channel or "<unspecified>",
        session_id,
        stdout_preview,
        stderr_text[:300],
        stderr_text[-300:],
    )
