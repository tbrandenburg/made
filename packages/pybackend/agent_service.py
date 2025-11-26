import time
from datetime import datetime

FIXED_RESPONSE = (
    "A2A Protocol Mock Response:\n\n"
    "Your request has been received. For full protocol specification visit https://a2a-protocol.org/latest/.\n\n"
    "Next Steps:\n1. Review repository context\n2. Plan coordinated agent actions\n3. Execute and report status"
)


def send_agent_message(_channel: str, message: str):
    return {
        "messageId": str(int(time.time() * 1000)),
        "sent": datetime.utcnow().isoformat() + "Z",
        "prompt": message,
        "response": FIXED_RESPONSE,
    }
