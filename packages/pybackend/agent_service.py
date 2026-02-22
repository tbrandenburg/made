import logging
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from threading import Event, Lock

from agent_cli import OpenCodeAgentCLI
from opencode_database_agent_cli import OpenCodeDatabaseAgentCLI
from copilot_agent_cli import CopilotAgentCLI
from kiro_agent_cli import KiroAgentCLI
from codex_agent_cli import CodexAgentCLI
from config import ensure_directory, get_made_directory, get_workspace_home
from settings_service import read_settings

logger = logging.getLogger(__name__)

_processing_lock = Lock()
_processing_channels: dict[str, datetime] = {}
_cancelled_channels: set[str] = set()
_active_processes: dict[str, subprocess.Popen[str]] = {}
_cancel_events: dict[str, Event] = {}
_conversation_sessions: dict[str, str] = {}


def get_agent_cli():
    """Get the appropriate AgentCLI implementation based on settings."""
    try:
        settings = read_settings()
        agent_cli_setting = settings.get("agentCli", "opencode")

        if agent_cli_setting == "kiro":
            return KiroAgentCLI()
        elif agent_cli_setting == "copilot":
            return CopilotAgentCLI()
        elif agent_cli_setting == "codex":
            return CodexAgentCLI()
        elif agent_cli_setting == "opencode":
            return OpenCodeDatabaseAgentCLI()
        elif agent_cli_setting == "opencode-legacy":
            return OpenCodeAgentCLI()
        else:
            # Default to hybrid OpenCode for any other value
            return OpenCodeDatabaseAgentCLI()
    except Exception:
        # Fallback to hybrid OpenCode if settings can't be read
        return OpenCodeDatabaseAgentCLI()


# Backward compatibility for tests
AGENT_CLI = get_agent_cli()


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


def _resolve_part_timestamp(
    part: dict[str, object], fallback: int | None
) -> int | None:
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
        _active_processes.pop(channel, None)
        _cancel_events.pop(channel, None)


def _mark_channel_cancelled(channel: str) -> None:
    with _processing_lock:
        _cancelled_channels.add(channel)


def _register_cancel_event(channel: str) -> Event:
    cancel_event = Event()
    with _processing_lock:
        _cancel_events[channel] = cancel_event
    return cancel_event


def _register_active_process(channel: str, process: subprocess.Popen[str]) -> None:
    with _processing_lock:
        _active_processes[channel] = process


def _was_channel_cancelled(channel: str) -> bool:
    with _processing_lock:
        return channel in _cancelled_channels


def cancel_agent_message(channel: str) -> bool:
    """Cancel an active agent message for the given channel."""
    with _processing_lock:
        if channel not in _processing_channels:
            return False
        _cancelled_channels.add(channel)
        cancel_event = _cancel_events.get(channel)
        process = _active_processes.get(channel)
        _processing_channels.pop(channel, None)

    if cancel_event:
        cancel_event.set()
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
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

    # Use typed interface
    agent_cli = get_agent_cli()
    start_time = time.monotonic()
    result = agent_cli.export_session(session_id, working_dir)
    duration_seconds = time.monotonic() - start_time
    logger.info(
        "Agent CLI export completed (channel: %s, session: %s, duration=%.3fs)",
        channel or "<unspecified>",
        session_id,
        duration_seconds,
    )

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


def list_chat_sessions(
    channel: str | None = None, limit: int = 10
) -> list[dict[str, str]]:
    working_dir = _get_working_directory(channel) if channel else None
    logger.info(
        "Listing chat sessions (channel: %s, limit: %s)",
        channel or "<unspecified>",
        limit,
    )

    agent_cli = get_agent_cli()
    start_time = time.monotonic()
    result = agent_cli.list_sessions(working_dir)
    duration_seconds = time.monotonic() - start_time
    logger.info(
        "Agent CLI list sessions completed (channel: %s, duration=%.3fs)",
        channel or "<unspecified>",
        duration_seconds,
    )

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


def list_agents() -> list[dict[str, object]]:
    logger.info("Listing available %s agents", AGENT_CLI.cli_name)

    agent_cli = get_agent_cli()
    start_time = time.monotonic()
    result = agent_cli.list_agents()
    duration_seconds = time.monotonic() - start_time
    logger.info("Agent CLI list agents completed (duration=%.3fs)", duration_seconds)

    if not result.success:
        logger.error("Listing agents failed: %s", result.error_message)
        if "command not found" in (result.error_message or ""):
            raise FileNotFoundError(result.error_message)
        raise RuntimeError(result.error_message or "Failed to list agents")

    return [agent.to_frontend_format() for agent in result.agents]


# Legacy parsing functions for backward compatibility with tests


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
    model: str | None = None,
):
    if not _mark_channel_processing(channel):
        raise ChannelBusyError(
            "Agent is still processing a previous message for this chat."
        )

    cancel_event = _register_cancel_event(channel)

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
            # Use typed interface
            agent_cli = get_agent_cli()
            start_time = time.monotonic()
            resolved_model = model if model and model != "default" else None
            result = agent_cli.run_agent(
                message,
                active_session,
                agent,
                resolved_model,
                working_dir,
                cancel_event=cancel_event,
                on_process=lambda process: _register_active_process(channel, process),
            )
            duration_seconds = time.monotonic() - start_time
            logger.info(
                "Agent CLI run completed (channel: %s, session: %s, duration=%.3fs)",
                channel,
                active_session,
                duration_seconds,
            )

            if result.success:
                # Update session if we got a new one
                if result.session_id:
                    _conversation_sessions[channel] = result.session_id

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
        response = get_agent_cli().missing_command_error()
        logger.error("Agent command not found for channel %s", channel)

        # Return error immediately - no process to poll
        sent_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        return {
            "messageId": str(int(time.time() * 1000)),
            "sent": sent_at,
            "prompt": message,
            "response": response,
            "sessionId": None,
            "processing": False,
        }
    except Exception as e:
        response = f"Error: {str(e)}"
        logger.exception(
            "Unexpected error sending agent message on channel %s", channel
        )

        # Return error immediately - no process to poll
        sent_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        return {
            "messageId": str(int(time.time() * 1000)),
            "sent": sent_at,
            "prompt": message,
            "response": response,
            "sessionId": _conversation_sessions.get(channel),
            "processing": False,
        }
    finally:
        _clear_channel_processing(channel)

    sent_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    return {
        "messageId": str(int(time.time() * 1000)),
        "sent": sent_at,
        "prompt": message,
        "response": "Processing...",  # Status message only
        "sessionId": _conversation_sessions.get(channel),
        "processing": True,  # Indicates polling needed
    }
