import json
import logging
import os
import re
import signal
import subprocess
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event, Lock

from agent_cli import AgentCLI
from agent_cli import OpenCodeAgentCLI
from opencode_database_agent_cli import OpenCodeDatabaseAgentCLI
from copilot_agent_cli import CopilotAgentCLI
from kiro_agent_cli import KiroAgentCLI
from codex_agent_cli import CodexAgentCLI
from ob1_agent_cli import OB1AgentCLI
from claude_agent_cli import ClaudeCodeAgentCLI
from pi_agent_cli import PiAgentCLI
from config import ensure_directory, get_made_directory, get_workspace_home
from settings_service import read_settings

logger = logging.getLogger(__name__)

_processing_lock = Lock()
_processing_channels: dict[str, datetime] = {}
_cancelled_channels: set[str] = set()
_active_processes: dict[str, subprocess.Popen[str]] = {}
_cancel_events: dict[str, Event] = {}
_conversation_sessions: dict[str, str] = {}

_PERSISTENT_STATE_PATH: Path | None = None


def _get_agent_state_path() -> Path:
    global _PERSISTENT_STATE_PATH
    if _PERSISTENT_STATE_PATH is None:
        _PERSISTENT_STATE_PATH = get_made_directory() / "agent_processing.json"
    return _PERSISTENT_STATE_PATH


def _dump_processing_state() -> None:
    path = _get_agent_state_path()
    try:
        with _processing_lock:
            snapshot = {k: v.isoformat() for k, v in _processing_channels.items()}
        path.write_text(json.dumps(snapshot))
    except Exception:
        logger.warning("Failed to persist agent processing state", exc_info=True)


# Persisted entries older than this are considered stale (e.g. after a backend restart
# with no live process) and are silently discarded on load.
_MAX_PROCESSING_AGE = timedelta(hours=1)


def _load_processing_state() -> dict[str, datetime]:
    path = _get_agent_state_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
        now = datetime.now(UTC)
        return {
            k: dt
            for k, v in data.items()
            if (dt := datetime.fromisoformat(v)) and now - dt < _MAX_PROCESSING_AGE
        }
    except Exception:
        logger.warning("Failed to load persisted agent processing state", exc_info=True)
        return {}


def _get_related_processing_keys(lock_key: str) -> set[str]:
    related = {lock_key}
    for k, v in list(_conversation_sessions.items()):
        if k == lock_key or v == lock_key:
            related.add(k)
            related.add(v)
    return related


_AGENTS_CACHE: dict[str, dict] = {}
_CACHE_TTL_SECONDS = 60
REGISTERED_AGENT_CLI_CLASSES: tuple[type[AgentCLI], ...] = (
    OpenCodeDatabaseAgentCLI,
    OpenCodeAgentCLI,
    KiroAgentCLI,
    CopilotAgentCLI,
    CodexAgentCLI,
    OB1AgentCLI,
    ClaudeCodeAgentCLI,
    PiAgentCLI,
)


def get_agent_cli(context_path: Path | None = None):
    """Get the appropriate AgentCLI implementation based on settings."""
    try:
        settings = read_settings(context_path)
        agent_cli_setting = settings.get("agentCli", "opencode")

        if agent_cli_setting == "kiro":
            return KiroAgentCLI()
        elif agent_cli_setting == "copilot":
            return CopilotAgentCLI()
        elif agent_cli_setting == "codex":
            return CodexAgentCLI()
        elif agent_cli_setting == "ob1":
            return OB1AgentCLI()
        elif agent_cli_setting == "claude":
            return ClaudeCodeAgentCLI()
        elif agent_cli_setting == "pi":
            return PiAgentCLI()
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
        return int(float(raw_value))  # type: ignore
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


def _is_missing_session_error(error_message: str | None) -> bool:
    if not error_message:
        return False

    normalized = error_message.lower()
    return (
        "session file not found" in normalized
        or "session not found" in normalized
        or "no such session" in normalized
        or bool(re.search(r"\bsession\b.*\bnot found\b", normalized))
    )


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
            process = _active_processes.get(channel)
            # Only replace if we can confirm the process has exited (stale entry)
            if process is None or process.poll() is None:
                return False  # Truly busy or in-flight; reject
            # Process confirmed exited: clean up stale entry and re-mark
            _processing_channels.pop(channel, None)
            _cancelled_channels.discard(channel)
            _active_processes.pop(channel, None)
            _cancel_events.pop(channel, None)
        _processing_channels[channel] = datetime.now(UTC)
    _dump_processing_state()
    return True


def _clear_channel_processing(channel: str) -> None:
    with _processing_lock:
        for key in _get_related_processing_keys(channel):
            _processing_channels.pop(key, None)
            _cancelled_channels.discard(key)
            _active_processes.pop(key, None)
            _cancel_events.pop(key, None)
    _dump_processing_state()


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


def cancel_agent_message(lock_key: str) -> bool:
    """Cancel an active agent message for the given lock key."""
    session_snapshot: list[tuple[str, str]] = []
    cancel_event = None
    process = None
    cleanup_key = lock_key
    started_at = None

    with _processing_lock:
        started_at = _processing_channels.get(lock_key)
        if started_at is None:
            # Fallback 1: reverse lookup via _conversation_sessions mapping.
            for ch, sid in list(_conversation_sessions.items()):
                if sid == lock_key:
                    started_at = _processing_channels.get(ch)
                    if started_at is not None:
                        _processing_channels[lock_key] = started_at
                    break

        if started_at is None:
            session_snapshot = list(_conversation_sessions.items())

    # Fallback 2: persisted state (survives backend restart) — outside the lock
    # to avoid blocking all threads on file I/O.
    if started_at is None:
        persisted = _load_processing_state()
        persisted_started = persisted.get(lock_key)
        if persisted_started is None:
            for ch, sid in session_snapshot:
                if sid == lock_key:
                    persisted_started = persisted.get(ch)
                    cleanup_key = ch
                    break
            if persisted_started is None and len(persisted) == 1:
                cleanup_key = next(iter(persisted))
                persisted_started = persisted[cleanup_key]
        else:
            cleanup_key = lock_key
        if persisted_started is None:
            return False
        with _processing_lock:
            _processing_channels[lock_key] = persisted_started
        started_at = persisted_started

    with _processing_lock:
        related = [cleanup_key, *_get_related_processing_keys(lock_key)]
        for key in dict.fromkeys(related):
            if cancel_event is None:
                cancel_event = _cancel_events.get(key)
            if process is None:
                process = _active_processes.get(key)

    if process is None or process.poll() is not None:
        _clear_channel_processing(cleanup_key)
        if cleanup_key != lock_key:
            _clear_channel_processing(lock_key)
        return False

    with _processing_lock:
        related = [cleanup_key, *_get_related_processing_keys(lock_key)]
        for key in dict.fromkeys(related):
            _cancelled_channels.add(key)
            _processing_channels.pop(key, None)
            _cancel_events.pop(key, None)
            _active_processes.pop(key, None)

    _dump_processing_state()

    if cancel_event:
        cancel_event.set()
    process.terminate()
    try:
        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        process.kill()
    return True


def get_channel_status(lock_key: str) -> dict[str, object]:
    needs_dump = False
    session_id = lock_key

    with _processing_lock:
        started_at = _processing_channels.get(lock_key)

        # Fallback 1: reverse lookup via _conversation_sessions mapping.
        # Handles the case where lock_key is a session_id but processing was
        # stored under the channel name (first-message key mismatch).
        if started_at is None:
            for ch, sid in list(_conversation_sessions.items()):
                if sid == lock_key:
                    started_at = _processing_channels.get(ch)
                    if started_at is not None:
                        # Propagate so future lookups are direct
                        _processing_channels[lock_key] = started_at
                    break

        if lock_key in _conversation_sessions:
            session_id = _conversation_sessions[lock_key]

        # Snapshot the session map so we can do disk I/O outside the lock below.
        needs_disk_fallback = started_at is None
        session_snapshot = (
            list(_conversation_sessions.items()) if needs_disk_fallback else []
        )

        if started_at is not None:
            process = _active_processes.get(lock_key)
            # Only clean up if we can confirm the process has exited
            if process is not None and process.poll() is not None:
                for key in _get_related_processing_keys(lock_key):
                    _processing_channels.pop(key, None)
                    _cancelled_channels.discard(key)
                    _active_processes.pop(key, None)
                    _cancel_events.pop(key, None)
                needs_dump = True
                started_at = None

    # Fallback 2: persisted state (survives backend restart) — outside the lock
    # to avoid blocking all threads on file I/O.
    if needs_disk_fallback and started_at is None:
        persisted = _load_processing_state()
        persisted_started = persisted.get(lock_key)
        if persisted_started is None:
            # Also try reverse lookup in persisted state via session map snapshot
            for ch, sid in session_snapshot:
                if sid == lock_key:
                    persisted_started = persisted.get(ch)
                    session_id = sid
                    break
        if persisted_started is not None:
            with _processing_lock:
                _processing_channels[lock_key] = persisted_started
            started_at = persisted_started

    if started_at is not None:
        try:
            processes = _read_running_agent_processes()
        except (OSError, subprocess.SubprocessError) as exc:
            logger.warning("Failed to inspect process table for status: %s", exc)
        else:
            if not _is_process_running_for_session(session_id, processes=processes):
                with _processing_lock:
                    for key in _get_related_processing_keys(lock_key):
                        _processing_channels.pop(key, None)
                        _cancelled_channels.discard(key)
                        _active_processes.pop(key, None)
                        _cancel_events.pop(key, None)
                needs_dump = True
                started_at = None

    if needs_dump:
        _dump_processing_state()

    return {
        "processing": started_at is not None,
        "startedAt": started_at.isoformat() if started_at else None,
    }


def _get_registered_agent_executables() -> set[str]:
    executable_names = {
        cli_cls.main_executable_name().strip()
        for cli_cls in REGISTERED_AGENT_CLI_CLASSES
        if cli_cls.main_executable_name().strip()
    }
    return executable_names


def _read_running_agent_processes() -> list[dict[str, object]]:
    executable_names = _get_registered_agent_executables()
    if not executable_names:
        return []

    ps_output = subprocess.check_output(
        ["ps", "-eo", "pid=,ppid=,comm=,args="],
        text=True,
    )

    processes: list[dict[str, object]] = []
    for raw_line in ps_output.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        parts = line.split(maxsplit=3)
        if len(parts) < 4:
            continue

        try:
            pid = int(parts[0])
            ppid = int(parts[1])
        except ValueError:
            continue

        executable = os.path.basename(parts[2])
        args = parts[3]
        if executable not in executable_names:
            continue

        working_directory: str | None = None
        try:
            working_directory = os.readlink(f"/proc/{pid}/cwd")
        except OSError:
            working_directory = None

        processes.append(
            {
                "pid": pid,
                "ppid": ppid,
                "executable": executable,
                "command": args,
                "workingDirectory": working_directory,
            }
        )

    return sorted(processes, key=lambda item: int(item["pid"]))


def list_running_agent_processes() -> list[dict[str, object]]:
    """List currently running agent CLI processes from the OS process table."""
    try:
        return _read_running_agent_processes()
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Failed to inspect process table: %s", exc)
        return []


def _is_process_running_for_session(
    session_id: str,
    *,
    processes: list[dict[str, object]] | None = None,
) -> bool:
    """Check whether an agent CLI process with the given session_id is running."""
    running_processes = (
        processes if processes is not None else list_running_agent_processes()
    )
    for proc in running_processes:
        command = proc.get("command", "")
        if isinstance(command, str) and session_id in command:
            return True
    return False


def terminate_agent_process(pid: int) -> bool:
    """Terminate a running agent process by PID."""
    running_processes = {proc["pid"] for proc in list_running_agent_processes()}
    if pid not in running_processes:
        return False

    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return False
    return True


def _get_working_directory(channel: str) -> Path:
    """Determine the working directory based on the channel context."""
    # For repository chats, run opencode in the repository directory
    if not channel.startswith("knowledge:") and not channel.startswith("constitution:"):
        workspace = get_workspace_home()
        repo_path = workspace / channel
        if repo_path.exists() and repo_path.is_dir():
            logger.info(
                "Resolved agent working directory to repository path (channel: %s, cwd: %s)",
                channel,
                repo_path,
            )
            return repo_path
        logger.warning(
            "Repository channel did not resolve to an existing directory; falling back to backend directory (channel: %s, candidate: %s, cwd: %s)",
            channel,
            repo_path,
            Path(__file__).parent,
        )
        return Path(__file__).parent

    made_dir = get_made_directory()

    if channel.startswith("knowledge:"):
        knowledge_dir = ensure_directory(made_dir / "knowledge")
        logger.info(
            "Resolved agent working directory to knowledge directory (channel: %s, cwd: %s)",
            channel,
            knowledge_dir,
        )
        return knowledge_dir

    # For constitution chats, default to the constitutions directory inside .made
    constitutions_dir = ensure_directory(made_dir / "constitutions")
    logger.info(
        "Resolved agent working directory to constitutions directory (channel: %s, cwd: %s)",
        channel,
        constitutions_dir,
    )
    return constitutions_dir


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
    agent_cli = get_agent_cli(working_dir)
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
        if _is_missing_session_error(result.error_message):
            logger.warning(
                "Chat history requested for unknown session (channel: %s, session: %s); returning empty history",
                channel or "<unspecified>",
                session_id,
            )
            response: dict[str, object] = {"sessionId": session_id, "messages": []}
            if channel:
                lock_key = session_id if session_id else channel
                status = get_channel_status(lock_key)
                response["processing"] = status["processing"]
                response["startedAt"] = status.get("startedAt")
            return response

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

    response: dict[str, object] = {
        "sessionId": session_id,
        "messages": filtered_messages,
    }
    if channel:
        lock_key = session_id if session_id else channel
        status = get_channel_status(lock_key)
        response["processing"] = status["processing"]
        response["startedAt"] = status.get("startedAt")
    return response


def list_chat_sessions(
    channel: str | None = None, limit: int = 10
) -> list[dict[str, object]]:
    working_dir = _get_working_directory(channel) if channel else None
    logger.info(
        "Listing chat sessions (channel: %s, limit: %s)",
        channel or "<unspecified>",
        limit,
    )

    agent_cli = get_agent_cli(working_dir)
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


def list_agents(repository_name: str | None = None) -> list[dict[str, object]]:
    """List available agents with in-memory caching (60s TTL)."""
    cache_key = repository_name or "__workspace__"
    now = time.monotonic()

    if cache_key in _AGENTS_CACHE:
        entry = _AGENTS_CACHE[cache_key]
        if now - entry["timestamp"] < _CACHE_TTL_SECONDS:
            logger.debug("Returning cached agents for '%s'", cache_key)
            return entry["data"]

    result = _list_agents_uncached(repository_name)
    _AGENTS_CACHE[cache_key] = {"data": result, "timestamp": now}
    return result


def _list_agents_uncached(
    repository_name: str | None = None,
) -> list[dict[str, object]]:
    logger.info(
        "Listing available %s agents (repository: %s)",
        AGENT_CLI.cli_name,
        repository_name or "<workspace>",
    )

    workspace_home = get_workspace_home()
    if repository_name:
        repository_path = workspace_home / repository_name
        if not repository_path.exists() or not repository_path.is_dir():
            raise FileNotFoundError(f"Repository '{repository_name}' not found")
        list_cwd = repository_path
    else:
        list_cwd = (
            workspace_home
            if workspace_home.exists() and workspace_home.is_dir()
            else None
        )

    agent_cli = get_agent_cli(list_cwd)
    start_time = time.monotonic()
    result = agent_cli.list_agents(cwd=list_cwd)
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
    lock_key = session_id if session_id else channel
    if not _mark_channel_processing(lock_key):
        raise ChannelBusyError(
            "Agent is still processing a previous message for this chat."
        )

    cancel_event = _register_cancel_event(lock_key)

    working_dir = _get_working_directory(channel)
    active_session = session_id
    logger.info(
        "Selected agent working directory for message dispatch (channel: %s, cwd: %s)",
        channel,
        working_dir,
    )

    if session_id:
        _conversation_sessions[lock_key] = session_id
    else:
        _conversation_sessions.pop(lock_key, None)

    logger.info(
        "Sending agent message (channel: %s, session: %s)", channel, active_session
    )

    try:
        # Check if cancelled before running
        if _was_channel_cancelled(lock_key):
            _clear_channel_processing(lock_key)
            sent_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
            return {
                "messageId": str(int(time.time() * 1000)),
                "sent": sent_at,
                "prompt": message,
                "response": "Agent request cancelled.",
                "sessionId": _conversation_sessions.get(lock_key),
                "processing": False,
            }
        else:
            # Use typed interface
            agent_cli = get_agent_cli(working_dir)
            start_time = time.monotonic()
            resolved_model = model if model and model != "default" else None
            result = agent_cli.run_agent(
                message,
                active_session,
                agent,
                resolved_model,
                working_dir,
                cancel_event=cancel_event,
                on_process=lambda process: _register_active_process(lock_key, process),
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
                    _conversation_sessions[lock_key] = result.session_id
                    # Propagate processing state from channel key → session_id key
                    # so status-polling with session_id finds the active process.
                    if result.session_id != lock_key:
                        with _processing_lock:
                            started_at = _processing_channels.get(lock_key)
                            if started_at:
                                _processing_channels[result.session_id] = started_at
                                proc = _active_processes.get(lock_key)
                                if proc:
                                    _active_processes[result.session_id] = proc
                                ev = _cancel_events.get(lock_key)
                                if ev:
                                    _cancel_events[result.session_id] = ev
                                if lock_key in _cancelled_channels:
                                    _cancelled_channels.add(result.session_id)
                        _dump_processing_state()

                logger.info(
                    "Agent message processed (channel: %s, session: %s)",
                    channel,
                    _conversation_sessions.get(lock_key),
                )
            else:
                response = result.error_message or "Command failed with no output"

                logger.error(
                    "Agent command failed (channel: %s, session: %s): %s",
                    channel,
                    _conversation_sessions.get(lock_key),
                    response,
                )
                _clear_channel_processing(lock_key)
                sent_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
                return {
                    "messageId": str(int(time.time() * 1000)),
                    "sent": sent_at,
                    "prompt": message,
                    "response": response,
                    "sessionId": _conversation_sessions.get(lock_key),
                    "processing": False,
                }

    except FileNotFoundError:
        response = get_agent_cli(working_dir).missing_command_error()
        logger.error("Agent command not found for channel %s", channel)
        _clear_channel_processing(lock_key)

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
        _clear_channel_processing(lock_key)

        # Return error immediately - no process to poll
        sent_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        return {
            "messageId": str(int(time.time() * 1000)),
            "sent": sent_at,
            "prompt": message,
            "response": response,
            "sessionId": _conversation_sessions.get(lock_key),
            "processing": False,
        }

    sent_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    return {
        "messageId": str(int(time.time() * 1000)),
        "sent": sent_at,
        "prompt": message,
        "response": "Processing...",  # Status message only
        "sessionId": _conversation_sessions.get(lock_key),
        "processing": True,  # Indicates polling needed
    }
