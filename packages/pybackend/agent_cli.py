from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import logging
from pathlib import Path
import re
import subprocess
import tempfile

logger = logging.getLogger(__name__)
SESSION_ROW_PATTERN = re.compile(r"^(ses_[^\s]+)\s{2,}(.*?)\s{2,}(.+)$")
AGENT_ROW_PATTERN = re.compile(r"^(?P<name>\S+)\s+\((?P<kind>[^)]+)\)\s*$")
LOG_PREVIEW_LIMIT = 500


@dataclass(frozen=True)
class RunHandle:
    process: subprocess.Popen
    command: list[str]


@dataclass(frozen=True)
class RunResult:
    returncode: int
    stdout: str
    stderr: str
    session_id: str | None
    responses: list[dict[str, object]]


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
    def build_run_command(self, session_id: str | None, agent: str | None) -> list[str]:
        raise NotImplementedError

    @abstractmethod
    def start_run(self, command: list[str], cwd: Path) -> RunHandle:
        raise NotImplementedError

    @abstractmethod
    def wait_for_run(self, handle: RunHandle, message: str) -> RunResult:
        raise NotImplementedError

    @abstractmethod
    def export_session(
        self,
        session_id: str,
        cwd: Path | None,
        start_timestamp: int | float | str | None = None,
    ) -> list[dict[str, object]]:
        raise NotImplementedError

    @abstractmethod
    def list_sessions(
        self, cwd: Path | None, limit: int
    ) -> list[dict[str, str]]:
        raise NotImplementedError

    @abstractmethod
    def list_agents(self) -> list[dict[str, object]]:
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

    def start_run(self, command: list[str], cwd: Path) -> RunHandle:
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
        )
        return RunHandle(process=process, command=command)

    def wait_for_run(self, handle: RunHandle, message: str) -> RunResult:
        stdout, stderr = handle.process.communicate(input=message)
        stdout_text = stdout or ""
        stderr_text = stderr or ""

        session_id = None
        responses: list[dict[str, object]] = []
        if handle.process.returncode == 0:
            session_id, responses = _parse_opencode_output(stdout_text)

        return RunResult(
            returncode=handle.process.returncode or 0,
            stdout=stdout_text,
            stderr=stderr_text,
            session_id=session_id,
            responses=responses,
        )

    def export_session(
        self,
        session_id: str,
        cwd: Path | None,
        start_timestamp: int | float | str | None = None,
    ) -> list[dict[str, object]]:
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
                raise RuntimeError(error_message)

            tmp.flush()
            tmp_path = Path(tmp.name)

            try:
                export_payload = _decode_json_file(tmp_path, session_id)
            except ValueError as exc:
                tmp.seek(0)
                preview = tmp.read(600)
                _log_invalid_export_file(session_id, preview, stderr_text.strip())
                raise exc

        messages = export_payload.get("messages") or []
        pruned_messages = _prune_export_payload({"messages": messages})["messages"]
        return _filter_export_messages(pruned_messages, normalized_start)

    def list_sessions(self, cwd: Path | None, limit: int) -> list[dict[str, str]]:
        result = subprocess.run(
            ["opencode", "session", "list"],
            capture_output=True,
            text=True,
            cwd=cwd,
        )
        stderr_text = str(result.stderr or "")
        if result.returncode != 0:
            error_message = stderr_text.strip() or "Failed to list sessions"
            raise RuntimeError(error_message)

        return _parse_session_table(result.stdout or "", limit)

    def list_agents(self) -> list[dict[str, object]]:
        result = subprocess.run(
            ["opencode", "agent", "list"],
            capture_output=True,
            text=True,
        )
        stderr_text = str(result.stderr or "")
        if result.returncode != 0:
            error_message = stderr_text.strip() or "Failed to list agents"
            raise RuntimeError(error_message)

        return _parse_agent_list(result.stdout or "")


def _preview_output(raw_text: str, limit: int = LOG_PREVIEW_LIMIT) -> str:
    stripped = (raw_text or "").strip()
    if len(stripped) <= limit:
        return stripped

    return stripped[: limit - 3] + "..."


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


def _extract_part_content(part: dict[str, object], part_type: str) -> str:
    if part_type in {"text"}:
        for key in ("text", "content", "value"):
            if part.get(key) is not None:
                return str(part.get(key) or "")
        return ""

    if part_type in {"tool_use", "tool"}:
        for key in ("tool", "name", "id"):
            if part.get(key):
                return str(part[key])
        return ""

    return ""


def _parse_session_table(output: str, limit: int) -> list[dict[str, str]]:
    sessions: list[dict[str, str]] = []
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
            {"id": session_id.strip(), "title": title.strip(), "updated": updated.strip()}
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


def _parse_opencode_output(
    stdout: str,
) -> tuple[str | None, list[dict[str, object]]]:
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

    responses: list[dict[str, str]] = []
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

        response: dict[str, object] = {
            "text": text_content,
            "timestamp": _format_timestamp(raw_timestamp),
            "type": message_type,
        }

        part_id = part.get("part_id")
        call_id = part.get("call_id")
        if part_id:
            response["partId"] = part_id
        if call_id:
            response["callId"] = call_id

        responses.append(response)

    return session_id, responses


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
) -> list[dict[str, object]]:
    history: list[dict[str, object]] = []

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

            entry: dict[str, object] = {
                "messageId": message_info.get("id"),
                "role": role,
                "type": part_type,
                "content": _extract_part_content(part, part_type),
                "timestamp": _format_timestamp_optional(part_timestamp),
            }

            content_value = str(entry.get("content") or "")
            if not content_value.strip():
                continue

            part_id = part.get("id")
            call_id = part.get("callID") or part.get("callId")
            if part_id:
                entry["partId"] = part_id
            if call_id:
                entry["callId"] = call_id

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

        for key in (
            "text",
            "content",
            "value",
            "tool",
            "name",
            "id",
            "timestamp",
            "callID",
            "callId",
        ):
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


def _decode_json_file(json_file: Path, session_id: str) -> dict[str, object]:
    """Parse clean JSON from a file."""
    try:
        with json_file.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        logger.error(
            "Invalid JSON export (session: %s): %s",
            session_id,
            exc,
        )
        raise ValueError("Invalid export data returned by opencode") from exc


def _log_invalid_export_file(
    session_id: str, stdout_preview: str, stderr_text: str
) -> None:
    logger.warning(
        (
            "Invalid export data while exporting chat history "
            "(session: %s). "
            "stdout sample: %r stderr first: %r stderr last: %r"
        ),
        session_id,
        stdout_preview,
        stderr_text[:300],
        stderr_text[-300:],
    )


def _parse_agent_list(output: str) -> list[dict[str, object]]:
    agents: list[dict[str, object]] = []
    current_agent: dict[str, object] | None = None

    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        match = AGENT_ROW_PATTERN.match(stripped)
        if match:
            current_agent = {
                "name": match.group("name"),
                "type": match.group("kind"),
                "details": [],
            }
            agents.append(current_agent)
            continue

        if current_agent is not None:
            details = current_agent.get("details")
            if isinstance(details, list):
                details.append(stripped)

    if not agents:
        logger.warning("No agents parsed from opencode output")
    return agents
