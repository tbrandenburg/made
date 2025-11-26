import subprocess
import time
from datetime import datetime


def send_agent_message(_channel: str, message: str):
    try:
        # Run the opencode command with the message
        result = subprocess.run(
            ["opencode", "run", message],
            capture_output=True,
            text=True,
            timeout=30,  # 30 second timeout
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
