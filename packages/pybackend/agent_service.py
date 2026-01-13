import logging
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from agent_cli import OpenCodeAgentCLI
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
    if not session_id:
        raise ValueError("Session ID is required")
    working_dir = _get_working_directory(channel) if channel else None

    logger.info(
        "Exporting chat history (channel: %s, session: %s, start: %s)",
        channel or "<unspecified>",
        session_id,
        start_timestamp,
    )

    try:
        messages = AGENT_CLI.export_session(
            session_id, working_dir, start_timestamp=start_timestamp
        )
    except FileNotFoundError:
        logger.error(
            "Unable to export history: '%s' command not found", AGENT_CLI.cli_name
        )
        raise FileNotFoundError(AGENT_CLI.missing_command_error())
    except RuntimeError as exc:
        logger.error(
            "Exporting chat history failed (channel: %s, session: %s): %s",
            channel or "<unspecified>",
            session_id,
            exc,
        )
        raise

    return {
        "sessionId": session_id,
        "messages": messages,
    }


def list_chat_sessions(channel: str | None = None, limit: int = 10) -> list[dict[str, str]]:
    working_dir = _get_working_directory(channel) if channel else None
    logger.info(
        "Listing chat sessions (channel: %s, limit: %s)",
        channel or "<unspecified>",
        limit,
    )

    try:
        sessions = AGENT_CLI.list_sessions(working_dir, limit=limit)
    except FileNotFoundError:
        logger.error(
            "Unable to list sessions: '%s' command not found", AGENT_CLI.cli_name
        )
        raise FileNotFoundError(AGENT_CLI.missing_command_error())
    except RuntimeError as exc:
        logger.error(
            "Listing chat sessions failed (channel: %s, cwd: %s): %s",
            channel or "<unspecified>",
            working_dir,
            exc,
        )
        raise

    logger.debug(
        "Listing chat sessions succeeded (channel: %s, cwd: %s, count: %s)",
        channel or "<unspecified>",
        working_dir,
        len(sessions),
    )

    return sessions


def list_agents() -> list[dict[str, object]]:
    logger.info("Listing available %s agents", AGENT_CLI.cli_name)
    try:
        agents = AGENT_CLI.list_agents()
    except FileNotFoundError:
        logger.error(
            "Unable to list agents: '%s' command not found", AGENT_CLI.cli_name
        )
        raise FileNotFoundError(AGENT_CLI.missing_command_error())
    except RuntimeError as exc:
        logger.error("Listing agents failed: %s", exc)
        raise

    logger.debug("Listing agents succeeded (count: %s)", len(agents))

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

    command = AGENT_CLI.build_run_command(active_session, agent)

    logger.info(
        "Sending agent message (channel: %s, session: %s)", channel, active_session
    )

    try:
        handle = AGENT_CLI.start_run(command, working_dir)
        _set_channel_process(channel, handle.process)
        run_result = AGENT_CLI.wait_for_run(handle, message)
        parsed_responses = run_result.responses

        if _was_channel_cancelled(channel):
            parsed_responses = []
            response = "Agent request cancelled."
        elif run_result.returncode == 0:
            if run_result.session_id:
                _conversation_sessions[channel] = run_result.session_id
            response = (
                "\n\n".join(part["text"] for part in parsed_responses)
                if parsed_responses
                else run_result.stdout.strip()
            )
            logger.info(
                "Agent message processed (channel: %s, session: %s)",
                channel,
                _conversation_sessions.get(channel),
            )
        else:
            parsed_responses = []
            response = (
                f"Error: {run_result.stderr.strip()}"
                if run_result.stderr.strip()
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
        response = AGENT_CLI.missing_command_error()
        logger.error("Agent command not found for channel %s", channel)
    except Exception as exc:
        parsed_responses = []
        response = f"Error: {str(exc)}"
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
