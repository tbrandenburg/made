import subprocess
import time
from datetime import datetime
from pathlib import Path

from config import get_workspace_home


def _get_working_directory(channel: str) -> Path:
    """Determine the working directory based on the channel context."""
    # For repository chats, run opencode in the repository directory
    if not channel.startswith("knowledge:") and not channel.startswith("constitution:"):
        workspace = get_workspace_home()
        repo_path = workspace / channel
        if repo_path.exists() and repo_path.is_dir():
            return repo_path

    # For knowledge/constitution chats or if repository doesn't exist,
    # run in the backend directory (current behavior)
    return Path(__file__).parent


def send_agent_message(channel: str, message: str):
    working_dir = _get_working_directory(channel)

    try:
        # Run the opencode command with the message in the appropriate directory
        result = subprocess.run(
            ["opencode", "run", message],
            capture_output=True,
            text=True,
            timeout=30,  # 30 second timeout
            cwd=working_dir,  # Run in the correct directory
        )

        if result.returncode == 0:
            response = result.stdout.strip()
        else:
            response = (
                f"Error: {result.stderr.strip()}"
                if result.stderr.strip()
                else "Command failed with no output"
            )

    except subprocess.TimeoutExpired:
        response = "Error: Command timed out after 30 seconds"
    except FileNotFoundError:
        response = "Error: 'opencode' command not found. Please ensure it is installed and in PATH."
    except Exception as e:
        response = f"Error: {str(e)}"

    return {
        "messageId": str(int(time.time() * 1000)),
        "sent": datetime.utcnow().isoformat() + "Z",
        "prompt": message,
        "response": response,
    }
