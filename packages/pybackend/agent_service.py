import subprocess
import time
from datetime import datetime, UTC
from pathlib import Path

from config import ensure_directory, get_made_directory, get_workspace_home

_active_conversations: set[str] = set()


def _build_opencode_command(message: str, is_continuation: bool) -> list[str]:
    """Build the opencode command based on conversation state."""
    command = ["opencode", "run"]
    if is_continuation:
        command.append("-c")
    command.append(message)
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


def send_agent_message(channel: str, message: str):
    working_dir = _get_working_directory(channel)
    continue_conversation = channel in _active_conversations
    command = _build_opencode_command(message, continue_conversation)

    try:
        # Run the opencode command with the message in the appropriate directory
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            cwd=working_dir,  # Run in the correct directory
        )

        if result.returncode == 0:
            response = result.stdout.strip()
            _active_conversations.add(channel)
        else:
            response = (
                f"Error: {result.stderr.strip()}"
                if result.stderr.strip()
                else "Command failed with no output"
            )

    except FileNotFoundError:
        response = "Error: 'opencode' command not found. Please ensure it is installed and in PATH."
    except Exception as e:
        response = f"Error: {str(e)}"

    return {
        "messageId": str(int(time.time() * 1000)),
        "sent": datetime.now(UTC).isoformat() + "Z",
        "prompt": message,
        "response": response,
    }
