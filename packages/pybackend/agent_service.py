import logging
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from agent_cli import OpenCodeAgentCLI, ExportResult, RunResult
from config import ensure_directory, get_made_directory, get_workspace_home

logger = logging.getLogger(__name__)

_processing_lock = Lock()
_processing_channels: dict[str, datetime] = {}
_processing_processes: dict[str, subprocess.Popen] = {}
_cancelled_channels: set[str] = set()
_conversation_sessions: dict[str, str] = {}
AGENT_CLI = OpenCodeAgentCLI()


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
        _processing_processes.pop(channel, None)
        _cancelled_channels.discard(channel)


def _set_channel_process(channel: str, process: subprocess.Popen) -> None:
    with _processing_lock:
        _processing_processes[channel] = process


def _mark_channel_cancelled(channel: str) -> None:
    with _processing_lock:
        _cancelled_channels.add(channel)


def _was_channel_cancelled(channel: str) -> bool:
    with _processing_lock:
        return channel in _cancelled_channels


def cancel_agent_message(channel: str) -> bool:
    with _processing_lock:
        process = _processing_processes.get(channel)
        if process is None:
            return False
        _cancelled_channels.add(channel)

    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()

    with _processing_lock:
        _processing_channels.pop(channel, None)
        _processing_processes.pop(channel, None)
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
    working_dir = _get_working_directory(channel) if channel else None

    logger.info(
        "Exporting chat history (channel: %s, session: %s, start: %s)",
        channel or "<unspecified>",
        session_id,
        start_timestamp,
    )

    if not session_id:
        raise ValueError("Session ID is required")

    try:
        export_result = AGENT_CLI.export_session(
            session_id,
            working_dir,
            start_timestamp=start_timestamp,
            channel=channel,
        )
    except FileNotFoundError:
        logger.error(
            "Unable to export history: '%s' command not found", AGENT_CLI.cli_name
        )
        raise FileNotFoundError(AGENT_CLI.missing_command_error())

    return _export_result_to_payload(export_result)


def list_chat_sessions(channel: str | None = None, limit: int = 10) -> list[dict[str, str]]:
    working_dir = _get_working_directory(channel) if channel else None
    logger.info(
        "Listing chat sessions (channel: %s, limit: %s)",
        channel or "<unspecified>",
        limit,
    )

    try:
        sessions = AGENT_CLI.list_sessions(working_dir, limit)
    except FileNotFoundError:
        logger.error(
            "Unable to list sessions: '%s' command not found", AGENT_CLI.cli_name
        )
        raise FileNotFoundError(AGENT_CLI.missing_command_error())
    return [session.to_dict() for session in sessions]


def list_agents() -> list[dict[str, object]]:
    logger.info("Listing available %s agents", AGENT_CLI.cli_name)
    try:
        agents = AGENT_CLI.list_agents()
    except FileNotFoundError:
        logger.error(
            "Unable to list agents: '%s' command not found", AGENT_CLI.cli_name
        )
        raise FileNotFoundError(AGENT_CLI.missing_command_error())
    return [agent.to_dict() for agent in agents]


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
        run_result = AGENT_CLI.run_message(
            message,
            working_dir,
            active_session,
            agent,
            on_start=lambda process: _set_channel_process(channel, process),
        )
        parsed_responses = _run_result_responses(run_result)

        if _was_channel_cancelled(channel):
            parsed_responses = []
            response = "Agent request cancelled."
        elif run_result.success:
            if run_result.session_id:
                _conversation_sessions[channel] = run_result.session_id
            response = run_result.response
            logger.info(
                "Agent message processed (channel: %s, session: %s)",
                channel,
                _conversation_sessions.get(channel),
            )
        else:
            response = (
                f"Error: {run_result.error}"
                if run_result.error
                else "Command failed with no output"
            )
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


def _run_result_responses(run_result: RunResult) -> list[dict[str, object]]:
    return [part.to_dict() for part in run_result.responses]


def _export_result_to_payload(export_result: ExportResult) -> dict[str, object]:
    return {
        "sessionId": export_result.session_id,
        "messages": [message.to_dict() for message in export_result.messages],
    }
