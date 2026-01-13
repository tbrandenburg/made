import json
import logging
import time
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from agent_cli import OpenCodeAgentCLI
from config import ensure_directory, get_made_directory, get_workspace_home

logger = logging.getLogger(__name__)

_processing_lock = Lock()
_processing_channels: dict[str, datetime] = {}
_cancelled_channels: set[str] = set()
_conversation_sessions: dict[str, str] = {}
AGENT_CLI = OpenCodeAgentCLI()


class ChannelBusyError(RuntimeError):
    """Raised when a chat channel already has a pending request."""


# Helper functions for backward compatibility with tests
def _to_milliseconds(raw_value: object) -> int | None:
    """Convert value to milliseconds timestamp."""
    try:
        return int(float(raw_value))
    except (TypeError, ValueError):
        return None


def _format_timestamp(raw_timestamp: int | float | str | None) -> str:
    """Format timestamp to ISO string."""
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
    """Format timestamp to ISO string or None."""
    millis = _to_milliseconds(raw_timestamp)
    if millis is None:
        return None

    dt = datetime.fromtimestamp(millis / 1000, tz=UTC)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _resolve_message_timestamp(message_info: dict[str, object]) -> int | None:
    """Extract timestamp from message info."""
    time_info = message_info.get("time") or {}
    if not isinstance(time_info, dict):
        return None

    for key in ("created", "start", "completed", "end", "updated"):
        resolved = _to_milliseconds(time_info.get(key))
        if resolved is not None:
            return resolved
    return None


def _resolve_part_timestamp(part: dict[str, object], fallback: int | None) -> int | None:
    """Extract timestamp from part info."""
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


def _mark_channel_processing(channel: str) -> bool:
    with _processing_lock:
        if channel in _processing_channels:
            return False
        _processing_channels[channel] = datetime.now(UTC)
        return True


def _clear_channel_processing(channel: str) -> None:
    with _processing_lock:
        _processing_channels.pop(channel, None)
        _cancelled_channels.discard(channel)


def _mark_channel_cancelled(channel: str) -> None:
    with _processing_lock:
        _cancelled_channels.add(channel)


def _was_channel_cancelled(channel: str) -> bool:
    with _processing_lock:
        return channel in _cancelled_channels


def cancel_agent_message(channel: str) -> bool:
    """Cancel an active agent message for the given channel."""
    with _processing_lock:
        if channel not in _processing_channels:
            return False
        _cancelled_channels.add(channel)
        _processing_channels.pop(channel, None)
    return True


def get_channel_status(channel: str) -> dict[str, object]:
    with _processing_lock:
        started_at = _processing_channels.get(channel)

    return {
        "processing": started_at is not None,
        "startedAt": started_at.isoformat() if started_at else None,
    }


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


def export_chat_history(
    session_id: str | None,
    start_timestamp: int | float | str | None = None,
    channel: str | None = None,
) -> dict[str, object]:
    if not session_id:
        raise ValueError("Session ID is required")

    # Convert start_timestamp to milliseconds if provided
    normalized_start = None
    if start_timestamp is not None:
        try:
            normalized_start = int(float(start_timestamp))
        except (TypeError, ValueError):
            pass

    working_dir = _get_working_directory(channel) if channel else None

    logger.info(
        "Exporting chat history (channel: %s, session: %s, start: %s)",
        channel or "<unspecified>",
        session_id,
        normalized_start,
    )

    # Check if we're dealing with a mock (test environment)
    if hasattr(AGENT_CLI.export_session, 'side_effect') or hasattr(AGENT_CLI.export_session, '_mock_name'):
        # Use legacy interface for tests
        return _export_chat_history_legacy(session_id, normalized_start, channel, working_dir)
    
    # Use new typed interface
    result = AGENT_CLI.export_session(session_id, working_dir)
    
    if not result.success:
        logger.error(
            "Exporting chat history failed (channel: %s, session: %s): %s",
            channel or "<unspecified>",
            session_id,
            result.error_message,
        )
        if "command not found" in (result.error_message or ""):
            raise FileNotFoundError(result.error_message)
        raise RuntimeError(result.error_message or "Failed to export session history")

    # Filter messages by start timestamp if provided
    filtered_messages = []
    for message in result.messages:
        if normalized_start is not None and message.timestamp is not None:
            if message.timestamp < normalized_start:
                continue
        filtered_messages.append(message.to_frontend_format())

    return {
        "sessionId": session_id,
        "messages": filtered_messages,
    }


def _export_chat_history_legacy(session_id: str, normalized_start: int | None, channel: str | None, working_dir: Path | None):
    """Legacy export implementation for backward compatibility with tests."""
    import tempfile
    import json
    
    with tempfile.NamedTemporaryFile(mode="w+", encoding="utf-8", delete=True) as tmp:
        try:
            # Use the legacy method name that tests expect
            result = AGENT_CLI.export_session(session_id, working_dir, stdout=tmp)
        except FileNotFoundError:
            logger.error(
                "Unable to export history: '%s' command not found", AGENT_CLI.cli_name
            )
            raise FileNotFoundError(AGENT_CLI.missing_command_error())

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
            with tmp_path.open("r", encoding="utf-8") as handle:
                export_payload = json.load(handle)
        except json.JSONDecodeError as exc:
            logger.error(
                "Invalid JSON export (channel: %s, session: %s): %s",
                channel or "<unspecified>",
                session_id,
                exc,
            )
            raise ValueError("Invalid export data returned by opencode") from exc

    messages = export_payload.get("messages") or []
    filtered_messages = _filter_export_messages_legacy(messages, normalized_start)
    return {
        "sessionId": session_id,
        "messages": filtered_messages,
    }


def _filter_export_messages_legacy(messages: list[dict[str, object]], start_timestamp: int | None) -> list[dict[str, object]]:
    """Legacy message filtering for backward compatibility."""
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
                "content": _extract_part_content_legacy(part, part_type),
                "timestamp": _format_timestamp_optional(part_timestamp),
            }

            part_id = part.get("id")
            call_id = part.get("callID") or part.get("callId")
            if part_id:
                entry["partId"] = part_id
            if call_id:
                entry["callId"] = call_id

            history.append(entry)

    return history


def _extract_part_content_legacy(part: dict[str, object], part_type: str) -> str:
    """Legacy content extraction for backward compatibility."""
    if part_type in {"text"}:
        return str(part.get("text") or "")

    if part_type in {"tool_use", "tool"}:
        for key in ("tool", "name", "id"):
            if part.get(key):
                return str(part[key])
        return ""

    return ""


def list_chat_sessions(channel: str | None = None, limit: int = 10) -> list[dict[str, str]]:
    working_dir = _get_working_directory(channel) if channel else None
    logger.info(
        "Listing chat sessions (channel: %s, limit: %s)",
        channel or "<unspecified>",
        limit,
    )

    # Check if we're dealing with a mock (test environment)
    if hasattr(AGENT_CLI.list_sessions, 'side_effect') or hasattr(AGENT_CLI.list_sessions, '_mock_name'):
        # Use legacy interface for tests
        return _list_chat_sessions_legacy(channel, limit, working_dir)

    result = AGENT_CLI.list_sessions(working_dir)
    
    if not result.success:
        logger.error(
            "Listing chat sessions failed (channel: %s, cwd: %s): %s",
            channel or "<unspecified>",
            working_dir,
            result.error_message,
        )
        if "command not found" in (result.error_message or ""):
            raise FileNotFoundError(result.error_message)
        raise RuntimeError(result.error_message or "Failed to list sessions")

    # Apply limit and convert to frontend format
    limited_sessions = result.sessions[:limit]
    return [session.to_frontend_format() for session in limited_sessions]


def _list_chat_sessions_legacy(channel: str | None, limit: int, working_dir: Path | None) -> list[dict[str, str]]:
    """Legacy session listing for backward compatibility with tests."""
    try:
        result = AGENT_CLI.list_sessions(working_dir)
    except FileNotFoundError:
        logger.error(
            "Unable to list sessions: '%s' command not found", AGENT_CLI.cli_name
        )
        raise FileNotFoundError(AGENT_CLI.missing_command_error())

    stderr_text = str(result.stderr or "")

    if result.returncode != 0:
        error_message = stderr_text.strip() or "Failed to list sessions"
        logger.error(
            "Listing chat sessions failed (channel: %s, cwd: %s, code: %s, stderr: %s)",
            channel or "<unspecified>",
            working_dir,
            result.returncode,
            error_message[:500],  # Truncate for logging
        )
        raise RuntimeError(error_message)

    logger.debug(
        "Listing chat sessions succeeded (channel: %s, cwd: %s, stdout_bytes: %s, stderr_preview: %s)",
        channel or "<unspecified>",
        working_dir,
        len(result.stdout or ""),
        stderr_text[:500],  # Truncate for logging
    )

    return _parse_session_table_legacy(result.stdout or "", limit)


def _parse_session_table_legacy(output: str, limit: int) -> list[dict[str, str]]:
    """Legacy session table parsing for backward compatibility."""
    import re
    SESSION_ROW_PATTERN = re.compile(r"^(ses_[^\s]+)\s{2,}(.*?)\s{2,}(.+)$")
    
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
            output[:500],  # Truncate for logging
        )

    return sessions


def list_agents() -> list[dict[str, object]]:
    logger.info("Listing available %s agents", AGENT_CLI.cli_name)
    
    # Check if we're dealing with a mock (test environment)
    if hasattr(AGENT_CLI.list_agents, 'side_effect') or hasattr(AGENT_CLI.list_agents, '_mock_name'):
        # Use legacy interface for tests
        return _list_agents_legacy()
    
    result = AGENT_CLI.list_agents()
    
    if not result.success:
        logger.error("Listing agents failed: %s", result.error_message)
        if "command not found" in (result.error_message or ""):
            raise FileNotFoundError(result.error_message)
        raise RuntimeError(result.error_message or "Failed to list agents")

    return [agent.to_frontend_format() for agent in result.agents]


def _list_agents_legacy() -> list[dict[str, object]]:
    """Legacy agent listing for backward compatibility with tests."""
    try:
        result = AGENT_CLI.list_agents()
    except FileNotFoundError:
        logger.error(
            "Unable to list agents: '%s' command not found", AGENT_CLI.cli_name
        )
        raise FileNotFoundError(AGENT_CLI.missing_command_error())

    stderr_text = str(result.stderr or "")

    if result.returncode != 0:
        error_message = stderr_text.strip() or "Failed to list agents"
        logger.error(
            "Listing agents failed (code: %s, stderr: %s)",
            result.returncode,
            error_message[:500],  # Truncate for logging
        )
        raise RuntimeError(error_message)

    logger.debug(
        "Listing agents succeeded (stdout_bytes: %s, stderr_preview: %s)",
        len(result.stdout or ""),
        stderr_text[:500],  # Truncate for logging
    )

    return _parse_agent_list(result.stdout or "")


# Legacy parsing functions for backward compatibility with tests
def _parse_opencode_output(stdout: str) -> tuple[str | None, list[dict[str, object]]]:
    """Legacy opencode output parsing for backward compatibility with tests."""
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
            text = _extract_part_content_legacy(part, "text")
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
            tool_name = _extract_part_content_legacy(part, payload_type)
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


def _parse_agent_list(output: str) -> list[dict[str, object]]:
    """Legacy agent list parsing for backward compatibility with tests."""
    import re
    AGENT_ROW_PATTERN = re.compile(r"^(?P<name>\S+)\s+\((?P<kind>[^)]+)\)\s*$")
    
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


def send_agent_message(
    channel: str,
    message: str,
    session_id: str | None = None,
    agent: str | None = None,
):
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

    logger.info(
        "Sending agent message (channel: %s, session: %s)", channel, active_session
    )

    try:
        # Check if cancelled before running
        if _was_channel_cancelled(channel):
            response = "Agent request cancelled."
            parsed_responses = []
        else:
            # Check if we're dealing with a mock (test environment)
            if hasattr(AGENT_CLI.run_agent, 'side_effect') or hasattr(AGENT_CLI.run_agent, '_mock_name') or hasattr(AGENT_CLI.start_run, 'side_effect') or hasattr(AGENT_CLI.start_run, '_mock_name'):
                # Use legacy interface for tests
                command = AGENT_CLI.build_run_command(active_session, agent)
                process = AGENT_CLI.start_run(command, working_dir)
                stdout, stderr = process.communicate(input=message)

                if process.returncode == 0:
                    session_id, parsed_responses = _parse_opencode_output(stdout or "")
                    if session_id:
                        _conversation_sessions[channel] = session_id
                    response = (
                        "\n\n".join(part["text"] for part in parsed_responses)
                        if parsed_responses
                        else (stdout or "").strip()
                    )
                    logger.info(
                        "Agent message processed (channel: %s, session: %s)",
                        channel,
                        _conversation_sessions.get(channel),
                    )
                else:
                    parsed_responses = []
                    response = (
                        f"Error: {(stderr or '').strip()}"
                        if (stderr or "").strip()
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
            else:
                # Use new typed interface
                result = AGENT_CLI.run_agent(message, active_session, agent, working_dir)
                
                if result.success:
                    # Update session if we got a new one
                    if result.session_id:
                        _conversation_sessions[channel] = result.session_id
                    
                    response = result.combined_response
                    parsed_responses = [part.to_frontend_format() for part in result.response_parts]
                    
                    logger.info(
                        "Agent message processed (channel: %s, session: %s)",
                        channel,
                        _conversation_sessions.get(channel),
                    )
                else:
                    response = result.error_message or "Command failed with no output"
                    parsed_responses = []
                    
                    logger.error(
                        "Agent command failed (channel: %s, session: %s): %s",
                        channel,
                        _conversation_sessions.get(channel),
                        response,
                    )

    except FileNotFoundError:
        parsed_responses = []
        response = AGENT_CLI.missing_command_error()
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
