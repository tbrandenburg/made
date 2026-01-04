import json
import logging
import subprocess
import time
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from config import ensure_directory, get_made_directory, get_workspace_home

logger = logging.getLogger(__name__)

_processing_lock = Lock()
_processing_channels: dict[str, datetime] = {}
_conversation_sessions: dict[str, str] = {}


class ChannelBusyError(RuntimeError):
    """Raised when a chat channel already has a pending request."""


def _mark_channel_processing(channel: str) -> bool:
    with _processing_lock:
        if channel in _processing_channels:
            return False

        _processing_channels[channel] = datetime.now(UTC)
        return True


def _clear_channel_processing(channel: str) -> None:
    with _processing_lock:
        _processing_channels.pop(channel, None)


def get_channel_status(channel: str) -> dict[str, object]:
    with _processing_lock:
        started_at = _processing_channels.get(channel)

    return {
        "processing": started_at is not None,
        "startedAt": started_at.isoformat() if started_at else None,
    }


def _build_opencode_command(message: str, session_id: str | None) -> list[str]:
    """Build the opencode command based on conversation state."""
    command = ["opencode", "run"]
    if session_id:
        command.extend(["-s", session_id])
    command.extend(["--format", "json", message])
    return command


def _get_working_directory(channel: str) -> Path:
    """Determine the working directory based on the channel context."""
    # For repository chats, run opencode in the repository directory
    if not channel.startswith("knowledge:") and not channel.startswith("constitution:"):
        workspace = get_workspace_home()
        repo_path = workspace / channel
        if repo_path.exists() and repo_path.is_dir():
            return repo_path

        return Path(__file__).parent

    made_dir = get_made_directory()

    if channel.startswith("knowledge:"):
        return ensure_directory(made_dir / "knowledge")

    # For constitution chats, default to the constitutions directory inside .made
    return ensure_directory(made_dir / "constitutions")


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
        return str(part.get("text") or "")

    if part_type in {"tool_use", "tool"}:
        for key in ("tool", "name", "id"):
            if part.get(key):
                return str(part[key])
        return ""

    return ""


def _parse_opencode_output(stdout: str) -> tuple[str | None, list[dict[str, str]]]:
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

        if payload_type == "text":
            text = _extract_part_content(part, "text")
            if text:
                parts.append(
                    {"kind": "text", "content": text, "timestamp": payload_timestamp}
                )
        elif payload_type in {"tool_use", "tool"}:
            tool_name = _extract_part_content(part, payload_type)
            if tool_name:
                parts.append(
                    {
                        "kind": "tool",
                        "content": tool_name,
                        "timestamp": payload_timestamp,
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

        responses.append(
            {
                "text": text_content,
                "timestamp": _format_timestamp(raw_timestamp),
                "type": message_type,
            }
        )

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

            history.append(
                {
                    "messageId": message_info.get("id"),
                    "role": role,
                    "type": part_type,
                    "content": _extract_part_content(part, part_type),
                    "timestamp": _format_timestamp_optional(part_timestamp),
                }
            )

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

        for key in ("text", "tool", "name", "id", "timestamp"):
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


def export_chat_history(
    session_id: str | None,
    start_timestamp: int | float | str | None = None,
    channel: str | None = None,
) -> dict[str, object]:
    if not session_id:
        raise ValueError("Session ID is required")

    normalized_start = (
        _to_milliseconds(start_timestamp) if start_timestamp is not None else None
    )
    working_dir = _get_working_directory(channel) if channel else None

    logger.info(
        "Exporting chat history (channel: %s, session: %s, start: %s)",
        channel or "<unspecified>",
        session_id,
        normalized_start,
    )

    with tempfile.NamedTemporaryFile(mode="w+", encoding="utf-8", delete=True) as tmp:
        try:
            result = subprocess.run(
                ["opencode", "export", session_id],
                stdout=tmp,
                stderr=subprocess.PIPE,
                text=True,
                cwd=working_dir,
            )
        except FileNotFoundError:
            logger.error("Unable to export history: 'opencode' command not found")
            raise FileNotFoundError(
                "Error: 'opencode' command not found. Please ensure it is installed and in PATH."
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
        stdout_size = tmp_path.stat().st_size

        logger.debug(
            "Captured opencode export output (channel: %s, session: %s, stdout_bytes: %s, stderr_bytes: %s)",
            channel or "<unspecified>",
            session_id,
            stdout_size,
            len(stderr_text),
        )

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
    return {
        "sessionId": session_id,
        "messages": _filter_export_messages(pruned_messages, normalized_start),
    }


def send_agent_message(channel: str, message: str, session_id: str | None = None):
    if not _mark_channel_processing(channel):
        raise ChannelBusyError(
            "Agent is still processing a previous message for this chat."
        )

    working_dir = _get_working_directory(channel)
    active_session = session_id

    if session_id:
        _conversation_sessions[channel] = session_id
    else:
        _conversation_sessions.pop(channel, None)

    command = _build_opencode_command(message, active_session)

    logger.info(
        "Sending agent message (channel: %s, session: %s)", channel, active_session
    )

    try:
        # Run the opencode command with the message in the appropriate directory
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            cwd=working_dir,  # Run in the correct directory
        )

        if result.returncode == 0:
            session_id, parsed_responses = _parse_opencode_output(result.stdout)
            if session_id:
                _conversation_sessions[channel] = session_id
            response = (
                "\n\n".join(part["text"] for part in parsed_responses)
                if parsed_responses
                else result.stdout.strip()
            )
            logger.info(
                "Agent message processed (channel: %s, session: %s)",
                channel,
                _conversation_sessions.get(channel),
            )
        else:
            parsed_responses = []
            response = (
                f"Error: {result.stderr.strip()}"
                if result.stderr.strip()
                else "Command failed with no output"
            )
            command_preview = " ".join(command)[:200]
            logger.error(
                "Agent command failed (channel: %s, session: %s, command: %s): %s",
                channel,
                _conversation_sessions.get(channel),
                command_preview,
                response,
            )

    except FileNotFoundError:
        parsed_responses = []
        response = "Error: 'opencode' command not found. Please ensure it is installed and in PATH."
        logger.error("Agent command not found for channel %s", channel)
    except Exception as e:
        parsed_responses = []
        response = f"Error: {str(e)}"
        logger.exception("Unexpected error sending agent message on channel %s", channel)
    finally:
        _clear_channel_processing(channel)

    sent_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    return {
        "messageId": str(int(time.time() * 1000)),
        "sent": sent_at,
        "prompt": message,
        "response": response,
        "responses": parsed_responses,
        "sessionId": _conversation_sessions.get(channel),
    }
